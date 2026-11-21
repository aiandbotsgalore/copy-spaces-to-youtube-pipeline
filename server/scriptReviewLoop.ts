/**
 * THE PAPER TRAIL review loop (text only).
 *
 * Starting from the existing manuscript, two reviewers (Gemini and ChatGPT) independently review and score
 * the same complete draft in parallel; the body is revised from both reviews (ChatGPT gpt-6.2-sol for full rewrites,
 * Claude only for small fixes that see just the paragraphs involved); the loop repeats until
 * both reviewers score the same revised draft 90 or more with no unresolved blocker, the locked intro matches
 * byte for byte, and changed quotes, attributions and claims check out against source text. Mercury 3 (scene
 * orders) and Cohere Rerank (source material) run only on demand. A spending limit ends the run as UNFINISHED
 * with the strongest draft saved. The threshold never changes and an unfinished draft is never marked complete.
 *
 * Pure orchestration over injected providers and research functions, so every path is testable with mocks.
 */
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Role } from '../utils/scriptTypes';
import type { Budget, CompleteResult, ProviderAdapter } from './scriptProviders';
import type { Prompt } from './scriptPrompts';
import * as RP from './scriptReviewPrompts';

/* ---------------------------------------------------------------------------------------------- */
/* Constants and types                                                                              */
/* ---------------------------------------------------------------------------------------------- */

/** The finish line. Not configurable, by design. */
export const PASS_SCORE = 90;
/** An edit that replaces or writes at least this many characters is a major rewrite and gets a blind A/B. */
export const MAJOR_EDIT_CHARS = 700;
/** After this many unsuccessful rounds in a row, the recurring problem gets a different tactic. */
export const TACTIC_AFTER_FAILS = 3;
const CALL_TIMEOUT_MS = 15 * 60_000;
/** Prefix of final-check issues that mean the check itself could not run (nothing for Claude to fix). */
const CHECK_DOWN = 'CHECK UNAVAILABLE: ';
const PAUSE_CODES = new Set(['USAGE_LIMIT', 'RATE_LIMIT', 'NOT_SIGNED_IN', 'NOT_INSTALLED', 'NO_KEY', 'NOT_ALLOWED']);
/** Cohere Rerank is billed per search; a conservative list price per call for the spending limit. */
export const RERANK_COST_USD = 0.003;
/** A targeted fix handles at most this many findings; more than that is a full rewrite. */
export const TARGETED_MAX_FINDINGS = 8;
/** The excerpts sent for a targeted fix stay under this share of the body (or 4,000 characters for a short body). */
export const TARGETED_MAX_SHARE = 0.3;
/** A focused review is used only while the changed scenes stay under this share of the body; above it, a full review. */
export const FOCUSED_MAX_SHARE = 0.5;
/** Word-overlap needed to repair a reviewer's slightly misquoted passage to the exact script text. */
export const QUOTE_REPAIR_MIN = 0.8;

export type ReviewerId = 'gemini' | 'chatgpt';
export const REVIEWERS: ReviewerId[] = ['gemini', 'chatgpt'];

export interface ReviewLoopConfig {
  reviewers: Record<ReviewerId, string>;
  /** Full rewrites of the body (sees the whole script). */
  reviser: string;
  /** Small fixes on a few paragraphs: sees only those paragraphs and their neighbours, never the whole script. '' turns it off. */
  targetedReviser: string;
  structure: string;
  rerankModel: string;
  /** Paid API dollars (Mercury, Cohere): the run stops UNFINISHED before a call that could pass this. */
  maxUsd: number;
  /** Subscription model calls (Claude, ChatGPT, Gemini): the run stops UNFINISHED before passing this. */
  maxCalls: number;
  /** A safety net on rounds; reaching it also ends the run UNFINISHED. */
  maxRounds: number;
}

/** Keeps the current Studio provider and model selections. */
export const DEFAULT_CONFIG: ReviewLoopConfig = {
  reviewers: { gemini: 'agy_cli:gemini-3.8-flash-high', chatgpt: 'codex_cli' },
  // Logan, 2026-11-20: ChatGPT gpt-6.2-sol at high effort does full rewrites; Claude Pro only does small passage fixes.
  reviser: 'codex_cli:gpt-6.2-sol:high',
  targetedReviser: 'claude_cli:sonnet',
  structure: 'inception:mercury-3',
  rerankModel: 'rerank-v5.0-fast',
  maxUsd: 1,
  maxCalls: 40,
  maxRounds: 12,
};

export interface IntroLock {
  /** The intro exactly as stored: everything before the body's first line. */
  text: string;
  sha256: string;
  length: number;
  /** The exact line where the body starts. Chosen explicitly, never guessed by a model. */
  bodyStartLine: string;
  sourceFile: string;
  setAt: number;
  reference?: { file: string; paragraphs: number; matched: number; missing: string[] };
}

export interface Finding {
  passage: string; missingConnection: string; problem: string; effectOnListener: string; proposedChange: string;
  criterion: string; blocker: boolean; structural: boolean; needsMaterial: string;
  /** The scene heading that holds the passage (or "missing connection"). */
  sceneKey: string;
  /** The passage is in the locked intro; the fix has to come from the body. */
  inIntro?: boolean;
  /** The reviewer's quote was slightly off and was matched to the exact script text (no extra model call). */
  quoteRepaired?: boolean;
}

export interface Review {
  reviewer: ReviewerId; provider: string; model: string; draftHash: string;
  score: number; summary: string; works: { passage: string; why: string }[]; findings: Finding[];
  ending: { verdict: 'answers' | 'explains_why_open' | 'fails'; openingQuestions: string[]; note: string };
}

export type ReviewOutcome = { ok: true; review: Review } | { ok: false; reviewer: ReviewerId; code: string; message: string };

export interface RoundRecord {
  n: number;
  draftHash: string;
  draftNumber: number;
  startedAt: number;
  reviews: Partial<Record<ReviewerId, ReviewOutcome>>;
  passed: boolean;
  passBlockers: string[];
  /** full = both reviewers read the whole script; focused = changed scenes in full, the rest as an outline. Only a full review can lead to delivery. */
  scope?: 'full' | 'focused';
  revision?: {
    tactic: string; tacticName: string; recurring?: string;
    applied: number; rejected: { find: string; reason: string }[];
    major: { pair: number; kept: 'new' | 'old'; votes: string[] }[];
    structure?: { problem: string; options: unknown[] } | { problem: string; error: string };
    material?: { queries: string[]; hits: number; reranked: boolean; note?: string };
    resolutions?: unknown[]; summary?: string; newHash?: string; error?: string;
    /** A rewrite kept on disk but never compared, because the limit ran out first. It is not the current draft. */
    unjudgedHash?: string;
    /** targeted = a small fix on excerpts only; full = a rewrite that saw the whole script. */
    mode?: 'targeted' | 'full'; by?: string; excerptChars?: number; note?: string;
  };
  finalCheck?: FinalCheck;
}

export interface FinalCheck {
  ok: boolean; introExact: boolean; changedParagraphs: number;
  quotes: { quote: string; speaker?: string; status: 'verified' | 'not_found' | 'attribution_mismatch'; ref?: string; note?: string }[];
  claims: { claim: string; label: string; note: string }[];
  issues: string[]; unavailable?: string;
}

export interface DraftRecord { hash: string; n: number; file: string; createdAt: number; parentHash?: string; origin: 'start' | 'revision' | 'source_fix' | 'unjudged' }

export type ReviewRunStatus = 'running' | 'complete' | 'unfinished' | 'cancelled' | 'failed';

export interface ReviewRun {
  id: string; projectId: string; createdAt: number; updatedAt: number;
  status: ReviewRunStatus; stopReason?: string; message?: string;
  config: ReviewLoopConfig; threshold: number;
  source: { file?: string; fromRunId?: string; startHash: string };
  intro: { sha256: string; length: number; bodyStartLine: string };
  spentUsd: number; calls: number;
  /** Tokens each service reported, by provider (claude_cli, codex_cli, agy_cli, inception). A CLI that reports nothing adds calls only. */
  usage?: Record<string, { calls: number; inTok: number; outTok: number; cachedTok?: number; toolCalls?: number }>;
  round: number; consecutiveFails: number; reviewFailStreak: number; tacticIndex: number;
  drafts: DraftRecord[]; currentHash: string; bestHash: string;
  rounds: RoundRecord[];
  structureAsked: Record<string, number>;
  result?: { file: string; hash: string; label: string; versionId?: string; importError?: string; scores?: Partial<Record<ReviewerId, number>> };
}

export interface SourceHit { ref: string; text: string; speaker?: string; recording?: string }
export interface ResearchDeps {
  search(query: string, limit: number): Promise<{ ok: true; items: SourceHit[] } | { ok: false; reason: string }>;
  rerank?(query: string, hits: SourceHit[], topN: number, model: string): Promise<{ ok: true; items: SourceHit[] } | { ok: false; reason: string }>;
}

export interface ReviewLoopDeps {
  /** The Studio data folder (.spacepipe-studio). */
  base: string;
  registry: { adapterFor(spec: string, budget: Budget): ProviderAdapter | null };
  research: ResearchDeps;
  /** Editorial brief and supporting text for a project (the same for both reviewers). */
  context(projectId: string): { brief: string; supporting: string };
  /** Saves a finished or unfinished result as a Studio version; returns its id. Optional. */
  saveResult?(projectId: string, text: string, label: string): string | undefined;
  appendLog?(runId: string, entry: Record<string, unknown>): void;
  now?: () => number;
  random?: () => number;
}

/* ---------------------------------------------------------------------------------------------- */
/* Pure helpers                                                                                     */
/* ---------------------------------------------------------------------------------------------- */

export const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/** Loose form for locating quoted passages: one space, straight quotes and dashes, lower case. */
export function loose(s: string): string {
  return String(s || '')
    .replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...')
    .replace(/\*\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Every line where the body could start, so Logan can pick one explicitly. */
export function boundaryCandidates(text: string): { line: string; lineNumber: number; introChars: number }[] {
  const out: { line: string; lineNumber: number; introChars: number }[] = [];
  let offset = 0;
  const lines = text.split('\n');
  lines.forEach((l, i) => {
    if (/^#{1,4}\s+\S/.test(l)) out.push({ line: l.replace(/\r$/, ''), lineNumber: i + 1, introChars: offset });
    offset += l.length + 1;
  });
  return out;
}

/**
 * The intro is everything before the one line that exactly equals `bodyStartLine`. The line must occur exactly
 * once, so the boundary is explicit and never inferred.
 */
export function makeIntroLock(text: string, bodyStartLine: string, sourceFile: string, now: number): IntroLock {
  const want = String(bodyStartLine || '').replace(/\r$/, '');
  if (!want.trim()) throw new Error('The line where the body starts is required.');
  let offset = 0;
  const hits: number[] = [];
  for (const l of text.split('\n')) {
    if (l.replace(/\r$/, '') === want) hits.push(offset);
    offset += l.length + 1;
  }
  if (hits.length !== 1) throw new Error(hits.length ? `The line "${want}" appears ${hits.length} times; pick a line that appears once.` : `The line "${want}" is not in ${sourceFile}.`);
  const intro = text.slice(0, hits[0]);
  if (!intro.trim()) throw new Error('The intro would be empty: pick a later line as the start of the body.');
  return { text: intro, sha256: sha256(intro), length: intro.length, bodyStartLine: want, sourceFile, setAt: now };
}

/** Checks Logan's verbatim reference against the stored intro, paragraph by paragraph. Report only. */
export function compareReference(intro: string, reference: string): { paragraphs: number; matched: number; missing: string[] } {
  const hay = loose(intro);
  const paras = reference.split(/\r?\n\s*\r?\n/).map(p => p.trim()).filter(Boolean);
  const missing = paras.filter(p => !hay.includes(loose(p).replace(/^[\w .'-]{1,30}\s?:\s*/, ''))).map(p => (p.length > 90 ? `${p.slice(0, 90)}…` : p));
  return { paragraphs: paras.length, matched: paras.length - missing.length, missing };
}

/** Splits a full script into the locked intro and the body, verifying the intro byte for byte. */
export function splitScript(full: string, lock: Pick<IntroLock, 'text' | 'sha256' | 'length'>): { ok: true; intro: string; body: string } | { ok: false; reason: string } {
  const head = full.slice(0, lock.length);
  if (head !== lock.text || sha256(head) !== lock.sha256) {
    let i = 0;
    while (i < lock.length && full[i] === lock.text[i]) i++;
    return { ok: false, reason: `The intro does not match the locked intro (first difference at character ${i}).` };
  }
  return { ok: true, intro: head, body: full.slice(lock.length) };
}

/** Puts the stored intro back in front of a body and verifies the result before it can be accepted. */
export function reassemble(lock: Pick<IntroLock, 'text' | 'sha256' | 'length'>, body: string): { ok: true; text: string } | { ok: false; reason: string } {
  const text = lock.text + body;
  const check = splitScript(text, lock);
  return check.ok ? { ok: true, text } : check;
}

/** A regex for `find` that tolerates whitespace runs, straight or curly quotes and markdown bold markers. */
function findPattern(find: string): RegExp {
  const parts = find.trim().split(/\s+/).map(w => w
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/["“”]/g, '["“”]')
    .replace(/['‘’]/g, "['‘’]")
    .replace(/(\\\*\\\*)/g, '(?:\\*\\*)?'));
  return new RegExp(parts.join('\\s+'), 'g');
}

export interface BodyEdit { find: string; replace: string; why?: string }
export interface AppliedEdit { index: number; find: string; replace: string; before: string; start: number; end: number; major: boolean }

/** Applies find/replace edits to the body only. Each find must match exactly one place. */
export function applyBodyEdits(body: string, edits: BodyEdit[], skip: Set<number> = new Set()): { body: string; applied: AppliedEdit[]; rejected: { index: number; find: string; reason: string }[] } {
  let out = body;
  const applied: AppliedEdit[] = [];
  const rejected: { index: number; find: string; reason: string }[] = [];
  edits.forEach((e, index) => {
    if (skip.has(index)) return;
    const find = String(e?.find ?? '');
    const replace = String(e?.replace ?? '');
    if (find.trim().split(/\s+/).length < 3) { rejected.push({ index, find, reason: 'find is too short to locate safely' }); return; }
    const re = findPattern(find);
    const matches = [...out.matchAll(re)];
    if (matches.length !== 1) { rejected.push({ index, find: find.slice(0, 160), reason: matches.length ? `matches ${matches.length} places` : 'not found in the body' }); return; }
    const m = matches[0];
    const start = m.index!;
    const end = start + m[0].length;
    const before = out.slice(start, end);
    out = out.slice(0, start) + replace + out.slice(end);
    applied.push({ index, find, replace, before, start, end: start + replace.length, major: Math.max(before.length, replace.length) >= MAJOR_EDIT_CHARS });
  });
  return { body: out, applied, rejected };
}

/** The heading of the scene that holds position `index` of the text. */
export function sceneAt(text: string, index: number): string {
  const before = text.slice(0, Math.max(0, index));
  const m = [...before.matchAll(/^#{2,4}\s+(.+)$/gm)];
  return m.length ? m[m.length - 1][1].trim() : '(opening of the body)';
}

const wordKey = (w: string) => loose(w).replace(/[^a-z0-9']/g, '');

/**
 * Matches a slightly misquoted passage (a word added, dropped or changed) to the exact text in the script, so a
 * reviewer's near-miss does not cost a whole new review. Returns the exact script text, or null if nothing is
 * at least QUOTE_REPAIR_MIN similar.
 */
export function repairPassage(passage: string, text: string): string | null {
  const pw = passage.split(/\s+/).map(wordKey).filter(Boolean);
  if (pw.length < 4) return null;
  const toks: { k: string; start: number; end: number }[] = [];
  for (const m of text.matchAll(/\S+/g)) { const k = wordKey(m[0]); if (k) toks.push({ k, start: m.index!, end: m.index! + m[0].length }); }
  const firsts = new Set(pw.slice(0, 3));
  const lasts = new Set(pw.slice(-3));
  let best: { score: number; a: number; b: number } | null = null;
  for (let i = 0; i < toks.length; i++) {
    if (!firsts.has(toks[i].k)) continue;
    // Try window lengths around the passage length; score = longest common subsequence / passage length.
    for (let len = Math.max(1, pw.length - 3); len <= pw.length + 3 && i + len <= toks.length; len++) {
      if (!lasts.has(toks[i + len - 1].k)) continue;
      const win = toks.slice(i, i + len).map(t => t.k);
      const dp = new Array(win.length + 1).fill(0);
      for (let x = 1; x <= pw.length; x++) {
        let prev = 0;
        for (let y = 1; y <= win.length; y++) {
          const tmp = dp[y];
          dp[y] = pw[x - 1] === win[y - 1] ? prev + 1 : Math.max(dp[y], dp[y - 1]);
          prev = tmp;
        }
      }
      const score = dp[win.length] / Math.max(pw.length, win.length);
      if (!best || score > best.score) best = { score, a: i, b: i + len - 1 };
    }
  }
  if (!best || best.score < QUOTE_REPAIR_MIN) return null;
  return text.slice(toks[best.a].start, toks[best.b].end);
}

/** The body split at its headings (#, ##, ### or ####): one block per scene or act heading, in order. */
export function sceneBlocks(body: string): { heading: string; text: string }[] {
  const out: { heading: string; text: string }[] = [];
  const re = /^#{1,4}\s+.+$/gm;
  const marks = [...body.matchAll(re)].map(m => m.index!);
  if (!marks.length || marks[0] > 0) marks.unshift(0);
  marks.forEach((at, i) => {
    const text = body.slice(at, marks[i + 1] ?? body.length);
    const heading = /^#{1,4}\s+(.+)$/m.exec(text)?.[1]?.trim() ?? '(opening)';
    out.push({ heading, text });
  });
  return out;
}

const sentences = (t: string) => t.replace(/^#{1,4}\s+.+$/gm, '').split(/(?<=[.!?]["”’)]?)\s+/).map(x => x.trim()).filter(x => x.split(/\s+/).length >= 4);

/**
 * The script for a focused review: the locked intro, then each body block either in full (changed since the last
 * reviewed draft, or one of the last two blocks, which carry the ending) or as an outline. Returns null when the
 * changed text is too large for a focused review to save anything.
 */
export function focusedView(intro: string, body: string, prevBody: string): { script: string; changedChars: number } | null {
  const prev = new Set(sceneBlocks(prevBody).map(b => b.text.trim()));
  const blocks = sceneBlocks(body);
  let changedChars = 0;
  let outlined = 0;
  const parts = blocks.map((b, i) => {
    const keep = !prev.has(b.text.trim());
    if (keep) changedChars += b.text.length;
    if (keep || i >= blocks.length - 2) return b.text;
    outlined++;
    const ss = sentences(b.text);
    const words = b.text.split(/\s+/).length;
    const headingLine = /^#{1,4}\s+.+$/m.exec(b.text)?.[0] ?? '';
    return `${headingLine}\n[UNCHANGED since the last review, about ${words} words. Opens: "${ss[0] ?? ''}" ... Closes: "${ss[ss.length - 1] ?? ''}"]\n\n`;
  });
  if (!changedChars || !outlined || changedChars > body.length * FOCUSED_MAX_SHARE) return null;
  return { script: intro + parts.join(''), changedChars };
}

/** Caps for the review loop's fact sheet (characters). The final source check pulls exact passages itself. */
export const FACT_SHEET_MAX = { claims: 3000, sources: 2500, docs: 2500 };

/**
 * A compact fact sheet for reviews and rewrites, in place of raw claims JSON, full excerpts and long background
 * documents: one line per claim with its status, one line per pinned source, and each document's name and opening.
 */
export function factSheet(x: {
  claims?: { text: string; status: string; supportRefs?: string[] }[];
  sources?: { id: string; label: string; excerpt: string }[];
  docs?: { name: string; content: string }[];
}): string {
  const cap = (lines: string[], max: number) => {
    const out: string[] = []; let n = 0;
    for (const l of lines) { if (n + l.length > max) { out.push(`[... ${lines.length - out.length} more not shown]`); break; } out.push(l); n += l.length + 1; }
    return out.join('\n');
  };
  const one = (t: string, n: number) => { const c = t.replace(/\s+/g, ' ').trim(); return c.length > n ? `${c.slice(0, n)}...` : c; };
  const parts: string[] = [];
  if (x.claims?.length) parts.push(`CLAIMS ON THE EVIDENCE BOARD (status in brackets)\n${cap(x.claims.map(c => `- [${c.status}] ${one(c.text, 220)}${c.supportRefs?.length ? ` (sources: ${c.supportRefs.slice(0, 3).join(', ')})` : ''}`), FACT_SHEET_MAX.claims)}`);
  if (x.sources?.length) parts.push(`PINNED SOURCES\n${cap(x.sources.map(s => `- [${s.id}] ${one(s.label, 80)}: "${one(s.excerpt, 160)}"`), FACT_SHEET_MAX.sources)}`);
  const docs = (x.docs || []).filter(d => d.content?.trim());
  if (docs.length) parts.push(`BACKGROUND DOCUMENTS (openings only)\n${cap(docs.map(d => `- ${one(d.name, 80)}: ${one(d.content, 300)}`), FACT_SHEET_MAX.docs)}`);
  return parts.join('\n\n');
}

export interface Excerpt { scene: string; text: string }

/**
 * The paragraphs that hold each passage, plus one paragraph either side, merged where they touch.
 * Used for targeted fixes, so the model sees only what it needs to change.
 */
export function passageExcerpts(body: string, passages: string[]): { excerpts: Excerpt[]; missing: string[] } {
  const paras: { text: string; at: number }[] = [];
  const sep = /\n[ \t]*\n+/g;
  let last = 0;
  for (let m = sep.exec(body); m; m = sep.exec(body)) { paras.push({ text: body.slice(last, m.index), at: last }); last = m.index + m[0].length; }
  paras.push({ text: body.slice(last), at: last });
  const lp = paras.map(p => loose(p.text));
  const starts: number[] = [];
  lp.forEach((t, i) => starts.push(i === 0 ? 0 : starts[i - 1] + lp[i - 1].length + 1));
  const joined = lp.join(' ');
  const ranges: [number, number][] = [];
  const missing: string[] = [];
  for (const passage of passages) {
    const p = loose(passage);
    const at = p ? joined.indexOf(p) : -1;
    if (at < 0) { missing.push(passage); continue; }
    const end = at + p.length;
    let first = 0, lastIdx = 0;
    starts.forEach((st, i) => { if (st <= at) first = i; if (st < end) lastIdx = i; });
    ranges.push([Math.max(0, first - 1), Math.min(paras.length - 1, lastIdx + 1)]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const m = merged[merged.length - 1];
    if (m && r[0] <= m[1] + 1) m[1] = Math.max(m[1], r[1]); else merged.push([...r]);
  }
  const excerpts = merged.map(([a, b]) => ({
    scene: sceneAt(body, paras[a].at + 1),
    text: paras.slice(a, b + 1).map(p => p.text).join('\n\n').trim(),
  })).filter(e => e.text);
  return { excerpts, missing };
}

/** Where a reviewer's passage sits: in the body (scene key), only in the intro, or nowhere. */
export function locatePassage(passage: string, intro: string, body: string): { where: 'body' | 'intro' | 'none'; sceneKey: string } {
  const p = loose(passage);
  if (!p) return { where: 'none', sceneKey: '' };
  const lb = loose(body);
  const at = lb.indexOf(p);
  if (at >= 0) {
    // Map the loose index back approximately through the ratio of lengths; good enough for a scene heading.
    const approx = Math.floor((at / Math.max(1, lb.length)) * body.length);
    return { where: 'body', sceneKey: sceneAt(body, approx + 1) };
  }
  if (loose(intro).includes(p)) return { where: 'intro', sceneKey: 'locked intro' };
  return { where: 'none', sceneKey: '' };
}

/**
 * Validates and normalises a reviewer's JSON. A blocker, or a finding behind a score below 90, must identify the
 * passage (verbatim from the script) or the missing connection, and its effect on the listener.
 */
export function parseReview(json: any, reviewer: ReviewerId, meta: { provider: string; model: string }, draftHash: string, intro: string, body: string): { ok: true; review: Review } | { ok: false; reason: string } {
  const score = Number(json?.score);
  if (!Number.isFinite(score) || score < 0 || score > 100) return { ok: false, reason: 'score missing or outside 0-100' };
  const findings: Finding[] = [];
  for (const f of Array.isArray(json?.findings) ? json.findings : []) {
    let passage = String(f?.passage || '').trim();
    const missing = String(f?.missingConnection || '').trim();
    const effect = String(f?.effectOnListener || '').trim();
    let loc = passage ? locatePassage(passage, intro, body) : { where: 'none' as const, sceneKey: '' };
    let quoteRepaired = false;
    if (passage && loc.where === 'none') {
      const fixed = repairPassage(passage, body) ?? repairPassage(passage, intro);
      if (fixed) { passage = fixed; loc = locatePassage(fixed, intro, body); quoteRepaired = loc.where !== 'none'; }
    }
    const blocker = f?.blocker === true;
    if (blocker || score < PASS_SCORE) {
      if (blocker && !effect) return { ok: false, reason: 'a blocker does not explain its effect on the listener' };
      if (blocker && !missing && loc.where === 'none') return { ok: false, reason: `a blocker's passage is not in the script: "${passage.slice(0, 80)}"` };
    }
    findings.push({
      passage, missingConnection: missing, problem: String(f?.problem || ''), effectOnListener: effect,
      proposedChange: String(f?.proposedChange || ''), criterion: String(f?.criterion || ''), blocker,
      structural: f?.structural === true, needsMaterial: String(f?.needsMaterial || '').trim(),
      sceneKey: loc.where === 'none' ? (missing ? 'missing connection' : 'unlocated') : loc.sceneKey,
      ...(loc.where === 'intro' ? { inIntro: true } : {}),
      ...(quoteRepaired ? { quoteRepaired: true } : {}),
    });
  }
  if (score < PASS_SCORE && !findings.some(f => (f.passage && f.sceneKey !== 'unlocated') || f.missingConnection) ) {
    return { ok: false, reason: `score ${score} is below ${PASS_SCORE} but no finding identifies a passage or missing connection` };
  }
  const verdict = ['answers', 'explains_why_open', 'fails'].includes(json?.ending?.verdict) ? json.ending.verdict : 'fails';
  return {
    ok: true,
    review: {
      reviewer, provider: meta.provider, model: meta.model, draftHash, score: Math.round(score), summary: String(json?.summary || ''),
      works: (Array.isArray(json?.works) ? json.works : []).map((w: any) => ({ passage: String(w?.passage || ''), why: String(w?.why || '') })),
      findings,
      ending: { verdict, openingQuestions: (json?.ending?.openingQuestions || []).map(String), note: String(json?.ending?.note || '') },
    },
  };
}

/** Why a set of reviews does not pass (empty = passes). A failed or missing review never passes. */
export function passProblems(reviews: Partial<Record<ReviewerId, ReviewOutcome>>, draftHash: string): string[] {
  const out: string[] = [];
  for (const id of REVIEWERS) {
    const r = reviews[id];
    if (!r) { out.push(`${id} review is missing`); continue; }
    if (!r.ok) { out.push(`${id} review failed (${r.code})`); continue; }
    if (r.review.draftHash !== draftHash) out.push(`${id} reviewed a different draft`);
    if (r.review.score < PASS_SCORE) out.push(`${id} scored ${r.review.score}`);
    const blockers = r.review.findings.filter(f => f.blocker);
    if (blockers.length) out.push(`${id} reported ${blockers.length} blocker(s)`);
    if (r.review.ending.verdict === 'fails') out.push(`${id}: the ending does not answer the opening or explain why it stays open`);
  }
  return out;
}

/** Paragraphs of the body that are new or changed compared with the starting body (spoken text only). */
export function changedParagraphs(startBody: string, body: string): string[] {
  const split = (t: string) => t.split(/\r?\n\s*\r?\n/).map(p => p.trim()).filter(Boolean);
  const before = new Set(split(startBody).map(loose));
  return split(body).filter(p => !before.has(loose(p)) && !/^#{1,4}\s/.test(p) && !/^\[NON-SPOKEN/i.test(p) && p !== '---');
}

/** Quotes in a paragraph, with the speaker the script credits them to when it says. */
export function extractQuotes(paragraph: string): { quote: string; speaker?: string }[] {
  const out: { quote: string; speaker?: string }[] = [];
  const speakerLine = /^\s*\*\*([^*:]{1,40})(?:\s*[-—–][^*:]*)?:\*\*/.exec(paragraph) || /^\s*\[(?:CLIP|ARCHIVE)[^|\]]*\|\s*([^|\]]{1,40})/i.exec(paragraph);
  const speaker = speakerLine ? speakerLine[1].trim() : undefined;
  for (const m of paragraph.matchAll(/["“]([^"”]{12,})["”]/g)) {
    const q = m[1].trim();
    if (q.split(/\s+/).length >= 4) out.push({ quote: q, speaker });
  }
  return out;
}

/** True when the words of `quote` (pieces split at ellipses) all appear in `text`. */
export function quoteInText(quote: string, text: string): boolean {
  const hay = loose(text).replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ');
  const pieces = loose(quote).split(/\.\.\.|…/).map(p => p.replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim()).filter(p => p.split(' ').length >= 3);
  return pieces.length > 0 && pieces.every(p => hay.includes(p));
}

const GENERIC_SPEAKER = /^(speaker\s*\w*|unknown|narrator|host|\?+)$/i;
export function attributionMatches(scriptSpeaker: string | undefined, sourceSpeaker: string | undefined): boolean | null {
  if (!scriptSpeaker || !sourceSpeaker || GENERIC_SPEAKER.test(sourceSpeaker.trim())) return null;
  const a = loose(scriptSpeaker).split(/[\s—-]+/)[0];
  return !!a && loose(sourceSpeaker).includes(a);
}

/** The scene key behind the most findings over the given rounds (blockers count double). */
export function recurringProblem(rounds: RoundRecord[]): { sceneKey: string; problem: string; structural: boolean } | null {
  const tally = new Map<string, { n: number; problem: string; structural: boolean }>();
  for (const r of rounds) {
    const seen = new Set<string>();
    for (const o of Object.values(r.reviews)) {
      if (!o || !o.ok) continue;
      for (const f of o.review.findings) {
        const k = f.sceneKey || 'unlocated';
        if (seen.has(k)) continue;
        seen.add(k);
        const t = tally.get(k) || { n: 0, problem: f.problem, structural: false };
        t.n += f.blocker ? 2 : 1;
        if (f.structural) t.structural = true;
        if (f.blocker) t.problem = f.problem;
        tally.set(k, t);
      }
    }
  }
  const best = [...tally.entries()].sort((a, b) => b[1].n - a[1].n)[0];
  return best ? { sceneKey: best[0], problem: best[1].problem, structural: best[1].structural } : null;
}

/** A structural problem in the same scene flagged in two different rounds. */
export function persistentStructural(rounds: RoundRecord[]): { sceneKey: string; problem: string } | null {
  const byKey = new Map<string, { rounds: Set<number>; problem: string }>();
  for (const r of rounds) for (const o of Object.values(r.reviews)) {
    if (!o || !o.ok) continue;
    for (const f of o.review.findings) if (f.structural && f.sceneKey && f.sceneKey !== 'unlocated') {
      const e = byKey.get(f.sceneKey) || { rounds: new Set<number>(), problem: f.problem };
      e.rounds.add(r.n);
      byKey.set(f.sceneKey, e);
    }
  }
  for (const [k, v] of byKey) if (v.rounds.size >= 2) return { sceneKey: k, problem: v.problem };
  return null;
}

export const TACTICS: { name: string; text: string }[] = [
  { name: 'restructure', text: 'The same problem has survived three rewrites, so stop rewording it. Change the structure of this stretch: the order of scenes or where the key fact is revealed. Use the scene-order options given.' },
  { name: 'new_material', text: 'The same problem has survived three rewrites, so stop rewording it. Let the sources carry it: bring in the source material provided so the listener hears it instead of being told.' },
  { name: 'cut_compress', text: 'The same problem has survived three rewrites, so stop rewording it. Cut or compress this stretch; remove what repeats a point the listener already has.' },
  { name: 'reframe', text: 'The same problem has survived three rewrites, so stop rewording it. Reframe the stretch through Logan\'s narration: say plainly what is known, what is alleged and what remains open.' },
];
const BASE_TACTIC = 'Fix every blocker and the problems that cost points. Preserve the passages either reviewer said work.';

/** The strongest reviewed draft: highest lower score, then fewer blockers, then later. */
export function strongestDraft(rounds: RoundRecord[], fallback: string): string {
  let best = { hash: fallback, min: -1, blockers: Infinity, n: -1 };
  for (const r of rounds) {
    const ok = REVIEWERS.map(id => r.reviews[id]).filter((o): o is Extract<ReviewOutcome, { ok: true }> => !!o && o.ok);
    if (ok.length < REVIEWERS.length) continue;
    const min = Math.min(...ok.map(o => o.review.score));
    const blockers = ok.reduce((n, o) => n + o.review.findings.filter(f => f.blocker).length, 0);
    if (min > best.min || (min === best.min && (blockers < best.blockers || (blockers === best.blockers && r.n > best.n)))) best = { hash: r.draftHash, min, blockers, n: r.n };
  }
  return best.hash;
}

function reviewsForReviser(reviews: Partial<Record<ReviewerId, ReviewOutcome>>): string {
  return REVIEWERS.map((id, i) => {
    const o = reviews[id];
    if (!o) return `REVIEW ${i + 1} (${id}): missing`;
    if (!o.ok) return `REVIEW ${i + 1} (${id}): failed (${o.code}: ${o.message})`;
    const r = o.review;
    return [`REVIEW ${i + 1} (${id}) score ${r.score}/100`, `Summary: ${r.summary}`,
      `Works (keep): ${r.works.map(w => `"${w.passage}" (${w.why})`).join('; ') || 'none listed'}`,
      `Ending: ${r.ending.verdict}. ${r.ending.note} Opening questions: ${r.ending.openingQuestions.join(' | ')}`,
      ...r.findings.map((f, j) => `Finding ${i + 1}.${j + 1}${f.blocker ? ' [BLOCKER]' : ''}${f.structural ? ' [STRUCTURE]' : ''} (${f.criterion}; scene: ${f.sceneKey}${f.inIntro ? '; points into the locked intro, fix it in the body' : ''})\n  Where: ${f.passage ? `"${f.passage}"` : f.missingConnection}\n  Problem: ${f.problem}\n  Effect on listener: ${f.effectOnListener}\n  Proposed: ${f.proposedChange}${f.needsMaterial ? `\n  Needs material: ${f.needsMaterial}` : ''}`),
    ].join('\n');
  }).join('\n\n');
}

/* ---------------------------------------------------------------------------------------------- */
/* Engine                                                                                           */
/* ---------------------------------------------------------------------------------------------- */

class Stop extends Error { constructor(public status: ReviewRunStatus, public reason: string, message: string) { super(message); } }

export function createReviewLoop(deps: ReviewLoopDeps) {
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const controllers = new Map<string, AbortController>();
  const dir = (projectId: string) => path.join(deps.base, 'projects', projectId, 'review');
  const runDir = (projectId: string, runId: string) => path.join(dir(projectId), 'runs', runId);
  const runFile = (projectId: string, runId: string) => path.join(dir(projectId), 'runs', `${runId}.json`);

  function writeAtomic(file: string, text: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${randomUUID().slice(0, 8)}.tmp`;
    fs.writeFileSync(tmp, text, 'utf8');
    try { fs.renameSync(tmp, file); } catch { fs.copyFileSync(tmp, file); fs.rmSync(tmp, { force: true }); }
  }
  const readJson = <T,>(file: string): T | null => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return null; } };

  /* Intro lock ------------------------------------------------------------------------------------ */
  const lockFile = (projectId: string) => path.join(dir(projectId), 'intro-lock.json');
  function getIntroLock(projectId: string): IntroLock | null { return readJson<IntroLock>(lockFile(projectId)); }
  function setIntroLock(projectId: string, text: string, bodyStartLine: string, sourceFile: string, reference?: { file: string; text: string }): IntroLock {
    const lock = makeIntroLock(text, bodyStartLine, sourceFile, now());
    if (reference) lock.reference = { file: reference.file, ...compareReference(lock.text, reference.text) };
    writeAtomic(lockFile(projectId), JSON.stringify(lock, null, 2));
    return lock;
  }

  /* Runs ------------------------------------------------------------------------------------------ */
  function save(run: ReviewRun) { run.updatedAt = now(); writeAtomic(runFile(run.projectId, run.id), JSON.stringify(run, null, 2)); }
  function getRun(projectId: string, runId: string): ReviewRun | null {
    if (!/^[\w-]{3,80}$/.test(runId)) return null;
    return readJson<ReviewRun>(runFile(projectId, runId));
  }
  function listRuns(projectId: string): ReviewRun[] {
    const d = path.join(dir(projectId), 'runs');
    if (!fs.existsSync(d)) return [];
    return fs.readdirSync(d).filter(f => f.endsWith('.json')).map(f => readJson<ReviewRun>(path.join(d, f))).filter((r): r is ReviewRun => !!r).sort((a, b) => b.createdAt - a.createdAt);
  }
  function draftText(run: ReviewRun, hash: string): string {
    const d = run.drafts.find(x => x.hash === hash);
    if (!d) throw new Error(`Draft ${hash.slice(0, 12)} is not in run ${run.id}.`);
    return fs.readFileSync(path.join(runDir(run.projectId, run.id), d.file), 'utf8');
  }
  function addDraft(run: ReviewRun, text: string, origin: DraftRecord['origin'], parentHash?: string): DraftRecord {
    const hash = sha256(text);
    const existing = run.drafts.find(d => d.hash === hash);
    if (existing) return existing;
    const n = run.drafts.length;
    const rec: DraftRecord = { hash, n, file: `draft-${String(n).padStart(3, '0')}.md`, createdAt: now(), parentHash, origin };
    writeAtomic(path.join(runDir(run.projectId, run.id), rec.file), text);
    run.drafts.push(rec);
    return rec;
  }

  function createRun(projectId: string, startText: string, opts: Partial<ReviewLoopConfig> & { file?: string; fromRunId?: string } = {}): ReviewRun {
    const lock = getIntroLock(projectId);
    if (!lock) throw new Error('Set the intro boundary first: pick the line where the body starts.');
    const split = splitScript(startText, lock);
    if (split.ok === false) throw new Error(`${split.reason} Re-set the intro boundary if the intro itself changed.`);
    if (listRuns(projectId).some(r => r.status === 'running' && controllers.has(r.id))) throw new Error('A review run is already in progress for this project.');
    const config: ReviewLoopConfig = {
      ...DEFAULT_CONFIG, ...Object.fromEntries(Object.entries(opts).filter(([k, v]) => k in DEFAULT_CONFIG && v !== undefined)),
      reviewers: { ...DEFAULT_CONFIG.reviewers, ...(opts.reviewers || {}) },
    } as ReviewLoopConfig;
    config.maxUsd = Math.max(0, Number(config.maxUsd) || 0);
    config.maxCalls = Math.max(1, Math.floor(Number(config.maxCalls) || DEFAULT_CONFIG.maxCalls));
    config.maxRounds = Math.max(1, Math.floor(Number(config.maxRounds) || DEFAULT_CONFIG.maxRounds));
    const id = `rv_${now().toString(36)}${randomUUID().replace(/-/g, '').slice(0, 6)}`;
    const startHash = sha256(startText);
    const run: ReviewRun = {
      id, projectId, createdAt: now(), updatedAt: now(), status: 'running', config, threshold: PASS_SCORE,
      source: { file: opts.file, fromRunId: opts.fromRunId, startHash },
      intro: { sha256: lock.sha256, length: lock.length, bodyStartLine: lock.bodyStartLine },
      spentUsd: 0, calls: 0, round: 0, consecutiveFails: 0, reviewFailStreak: 0, tacticIndex: 0,
      drafts: [], currentHash: startHash, bestHash: startHash, rounds: [], structureAsked: {},
    };
    addDraft(run, startText, 'start');
    save(run);
    return run;
  }

  /* Model calls ----------------------------------------------------------------------------------- */
  async function call(run: ReviewRun, budget: Budget, spec: string, role: Role, prompt: Prompt, label: string, signal: AbortSignal, paid = false): Promise<CompleteResult> {
    const adapter = deps.registry.adapterFor(spec, budget);
    if (!adapter) return { ok: false, code: 'NOT_ALLOWED', message: `Unknown provider "${spec}".`, rawOutput: '', durationMs: 0, provider: 'claude_cli', model: spec } as CompleteResult;
    if (!paid) {
      if (run.calls + 1 > run.config.maxCalls) throw new Stop('unfinished', 'spending_limit', `Reached the limit of ${run.config.maxCalls} model calls.`);
      run.calls++;
    }
    const r = await adapter.complete({ role, system: prompt.system, user: prompt.user, schema: prompt.schema, schemaName: prompt.schemaName, maxTokens: prompt.maxTokens, timeoutMs: CALL_TIMEOUT_MS, signal });
    run.spentUsd = budget.spentUsd;
    const u = ((run.usage ??= {})[r.provider] ??= { calls: 0, inTok: 0, outTok: 0 });
    u.calls++;
    if (r.ok && r.usage) { u.inTok += r.usage.inTok || 0; u.outTok += r.usage.outTok || 0; u.cachedTok = (u.cachedTok || 0) + (r.usage.cachedTok || 0); if (r.usage.toolCalls) u.toolCalls = (u.toolCalls || 0) + r.usage.toolCalls; }
    deps.appendLog?.(run.id, {
      at: now(), role, label, provider: r.provider, model: r.model, promptVersion: prompt.version, ok: r.ok, code: r.ok ? undefined : r.code,
      durationMs: r.durationMs, inTok: r.ok ? r.usage?.inTok : undefined, outTok: r.ok ? r.usage?.outTok : undefined, cachedTok: r.ok ? r.usage?.cachedTok : undefined, toolCalls: r.ok ? r.usage?.toolCalls : undefined, costUsd: r.ok ? r.usage?.costUsd : undefined,
      message: r.ok ? undefined : r.message,
    });
    if (!r.ok && r.code === 'ABORTED') throw new Stop('cancelled', 'cancelled', 'Cancelled.');
    if (!r.ok && r.code === 'BUDGET_EXCEEDED') throw new Stop('unfinished', 'spending_limit', `Reached the $${run.config.maxUsd.toFixed(2)} spending limit: ${r.message}`);
    return r;
  }

  /** Both reviewers, in parallel, on one prompt object built once. Each failed review is retried once. */
  async function reviewBoth(run: ReviewRun, budget: Budget, full: string, intro: string, body: string, signal: AbortSignal, view?: string): Promise<Partial<Record<ReviewerId, ReviewOutcome>>> {
    const ctx = deps.context(run.projectId);
    const prompt = RP.reviewPrompt({ script: view ?? full, bodyStart: run.intro.bodyStartLine, brief: ctx.brief, supporting: ctx.supporting, focused: !!view });
    const draftHash = sha256(full);
    if (run.calls + REVIEWERS.length > run.config.maxCalls) throw new Stop('unfinished', 'spending_limit', `Reached the limit of ${run.config.maxCalls} model calls before the next review.`);
    const one = async (id: ReviewerId): Promise<ReviewOutcome> => {
      let last: ReviewOutcome = { ok: false, reviewer: id, code: 'NOT_RUN', message: 'not run' };
      let rejected = '';
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0 && run.calls + 1 > run.config.maxCalls) break;
        // A retry after a rejected answer tells this reviewer what to correct (its own output only; nothing from the other reviewer).
        const p = rejected ? { ...prompt, user: `${prompt.user}\n\nYOUR PREVIOUS ANSWER COULD NOT BE ACCEPTED: ${rejected}\nReview the same script again and follow the rules exactly; copy every passage word for word from the script.` } : prompt;
        const r = await call(run, budget, run.config.reviewers[id], id === 'chatgpt' ? 'judge' : 'critic', p, `${id} review (draft ${draftHash.slice(0, 8)})${rejected ? ' retry' : ''}`, signal);
        if (!r.ok) {
          last = { ok: false, reviewer: id, code: r.code, message: r.message };
          if (PAUSE_CODES.has(r.code)) break;
          continue;
        }
        const parsed = parseReview(r.json, id, { provider: r.provider, model: r.model }, draftHash, intro, body);
        if (parsed.ok) return parsed;
        last = { ok: false, reviewer: id, code: 'INVALID_REVIEW', message: parsed.reason };
        rejected = parsed.reason;
        deps.appendLog?.(run.id, { at: now(), role: 'review_rejected', label: `${id} review not accepted`, ok: false, code: 'INVALID_REVIEW', message: parsed.reason });
      }
      return last;
    };
    const [g, c] = await Promise.all([one('gemini'), one('chatgpt')]);
    return { gemini: g, chatgpt: c };
  }

  async function findMaterial(run: ReviewRun, budget: Budget, queries: string[]): Promise<{ text: string; record: NonNullable<RoundRecord['revision']>['material'] }> {
    const parts: string[] = [];
    let hits = 0;
    let reranked = false;
    const notes: string[] = [];
    for (const q of queries.slice(0, 2)) {
      const s = await deps.research.search(q, 25);
      if (s.ok === false) { notes.push(`search failed: ${s.reason}`); continue; }
      let items = s.items;
      if (deps.research.rerank && items.length > 1) {
        if (budget.spentUsd + RERANK_COST_USD > budget.maxUsd + 1e-12) notes.push('rerank skipped: spending limit');
        else {
          const rr = await deps.research.rerank(q, items, 6, run.config.rerankModel);
          if (rr.ok) { budget.spentUsd += RERANK_COST_USD; run.spentUsd = budget.spentUsd; items = rr.items; reranked = true; }
          else notes.push(`rerank unavailable: ${rr.reason}`);
        }
      }
      items = items.slice(0, 6);
      hits += items.length;
      parts.push(`Search: ${q}\n${items.map(i => `[${i.ref}${i.speaker ? ` | ${i.speaker}` : ''}${i.recording ? ` | ${i.recording}` : ''}] ${i.text}`).join('\n')}`);
    }
    return { text: parts.join('\n\n'), record: { queries: queries.slice(0, 2), hits, reranked, ...(notes.length ? { note: notes.join('; ') } : {}) } };
  }

  async function structureOptions(run: ReviewRun, budget: Budget, body: string, problem: { sceneKey: string; problem: string }, signal: AbortSignal) {
    const scenes = [...body.matchAll(/^###\s+(.+)$/gm)].map((m, i, all) => ({ heading: m[0].trim(), key: m[1].trim(), start: m.index!, end: i + 1 < all.length ? all[i + 1].index! : body.length }));
    const at = Math.max(0, scenes.findIndex(s => s.key === problem.sceneKey));
    const stretch = scenes.slice(Math.max(0, at - 1), at + 2).map(s => ({ heading: s.heading, text: body.slice(s.start, s.end).slice(0, 9000) }));
    if (!stretch.length) return { problem: problem.problem, error: 'no scenes found around the problem' };
    const r = await call(run, budget, run.config.structure, 'critic', RP.structurePrompt({ problem: `${problem.problem} (scene: ${problem.sceneKey})`, scenes: stretch }), `structure options (${problem.sceneKey})`, signal, true);
    if (!r.ok) return { problem: problem.problem, error: `${r.code}: ${r.message}` };
    return { problem: problem.problem, options: ((r.json as any)?.options || []).slice(0, 3) };
  }

  /** Blind A/B of major rewrites by both reviewers. Returns the edit indexes to revert. */
  async function judgeMajor(run: ReviewRun, budget: Budget, oldBody: string, applied: AppliedEdit[], newBody: string, signal: AbortSignal): Promise<{ revert: Set<number>; record: { pair: number; kept: 'new' | 'old'; votes: string[] }[] }> {
    const major = applied.filter(a => a.major);
    if (!major.length) return { revert: new Set(), record: [] };
    if (run.calls + REVIEWERS.length > run.config.maxCalls) throw new Stop('unfinished', 'spending_limit', `Reached the limit of ${run.config.maxCalls} model calls before comparing a major rewrite.`);
    const brief = deps.context(run.projectId).brief;
    const flips = major.map(() => random() < 0.5);
    const pairs = major.map((m, i) => {
      const oldStart = oldBody.indexOf(m.before);
      const before = oldStart >= 0 ? oldBody.slice(Math.max(0, oldStart - 700), oldStart) : '';
      const after = oldStart >= 0 ? oldBody.slice(oldStart + m.before.length, oldStart + m.before.length + 700) : '';
      return { pair: i + 1, before, after, a: flips[i] ? m.replace : m.before, b: flips[i] ? m.before : m.replace };
    });
    const prompt = RP.comparePrompt(pairs, brief);
    const results = await Promise.all(REVIEWERS.map(id => call(run, budget, run.config.reviewers[id], 'judge', prompt, `${id} blind compare`, signal)));
    const revert = new Set<number>();
    const record = major.map((m, i) => {
      const votes: { pick: 'new' | 'old'; clear: boolean }[] = [];
      results.forEach(r => {
        if (!r.ok) return;
        const row = ((r.json as any)?.pairs || []).find((p: any) => Number(p?.pair) === i + 1);
        if (!row || (row.stronger !== 'A' && row.stronger !== 'B')) return;
        const pickedA = row.stronger === 'A';
        votes.push({ pick: pickedA === flips[i] ? 'new' : 'old', clear: row.confidence === 'clear' });
      });
      const nNew = votes.filter(v => v.pick === 'new').length;
      const nOld = votes.length - nNew;
      let kept: 'new' | 'old';
      if (votes.length < 2) kept = 'old'; // a missing comparison keeps what both reviewers already saw
      else if (nNew !== nOld) kept = nNew > nOld ? 'new' : 'old';
      else kept = votes.find(v => v.clear && !votes.find(w => w !== v && w.clear))?.pick ?? 'old';
      if (kept === 'old') revert.add(m.index);
      return { pair: i + 1, kept, votes: votes.map(v => `${v.pick}${v.clear ? '' : ' (slight)'}`) };
    });
    void newBody;
    return { revert, record };
  }

  /** Final check of the draft both reviewers passed: intro byte for byte, then changed quotes and claims. */
  async function finalCheck(run: ReviewRun, budget: Budget, full: string, signal: AbortSignal): Promise<FinalCheck> {
    const lock = getIntroLock(run.projectId);
    const split = lock && lock.sha256 === run.intro.sha256 ? splitScript(full, lock) : { ok: false as const, reason: 'The intro lock changed during the run.' };
    if (split.ok === false) return { ok: false, introExact: false, changedParagraphs: 0, quotes: [], claims: [], issues: [split.reason] };
    const startSplit = splitScript(draftText(run, run.source.startHash), lock!);
    const startBody = startSplit.ok ? startSplit.body : '';
    const startLoose = loose(draftText(run, run.source.startHash));
    const paras = changedParagraphs(startBody, split.body);
    const check: FinalCheck = { ok: true, introExact: true, changedParagraphs: paras.length, quotes: [], claims: [], issues: [] };
    if (!paras.length) return check;
    const sourcesFor: string[] = [];
    for (const p of paras) {
      const excerpts: string[] = [];
      for (const q of extractQuotes(p)) {
        if (startLoose.includes(loose(q.quote))) continue; // unchanged quote, already in the approved starting script
        const s = await deps.research.search(q.quote.slice(0, 300), 10);
        if (s.ok === false) { check.unavailable = s.reason; check.issues.push(`${CHECK_DOWN}could not check the quote "${q.quote.slice(0, 80)}": ${s.reason}`); continue; }
        const hit = s.items.find(i => quoteInText(q.quote, i.text));
        if (!hit) { check.quotes.push({ quote: q.quote, speaker: q.speaker, status: 'not_found' }); check.issues.push(`Quote not found in the sources: "${q.quote.slice(0, 120)}"`); continue; }
        const attr = attributionMatches(q.speaker, hit.speaker);
        if (attr === false) { check.quotes.push({ quote: q.quote, speaker: q.speaker, status: 'attribution_mismatch', ref: hit.ref, note: `source speaker: ${hit.speaker}` }); check.issues.push(`Quote credited to ${q.speaker} but the source has ${hit.speaker}: "${q.quote.slice(0, 100)}"`); continue; }
        check.quotes.push({ quote: q.quote, speaker: q.speaker, status: 'verified', ref: hit.ref, ...(attr === null ? { note: 'speaker label in the source is generic' } : {}) });
        excerpts.push(`[${hit.ref}${hit.speaker ? ` | ${hit.speaker}` : ''}] ${hit.text}`);
      }
      const s = await deps.research.search(p.replace(/[*_#>\[\]]/g, ' ').slice(0, 300), 4);
      if (s.ok) excerpts.push(...s.items.map(i => `[${i.ref}${i.speaker ? ` | ${i.speaker}` : ''}] ${i.text}`));
      else check.unavailable = s.reason;
      sourcesFor.push(excerpts.join('\n').slice(0, 4000));
    }
    if (check.unavailable && !sourcesFor.some(Boolean)) {
      check.ok = false;
      check.issues.push(`${CHECK_DOWN}source text is not available, so changed claims could not be checked: ${check.unavailable}`);
      return check;
    }
    const items = paras.map((p, index) => ({ index, paragraph: p, sources: sourcesFor[index] }));
    for (let i = 0; i < items.length; i += 12) {
      const chunk = items.slice(i, i + 12);
      const r = await call(run, budget, run.config.reviewers.chatgpt, 'factcheck', RP.factcheckPrompt(chunk), `source check ${i / 12 + 1}`, signal);
      if (!r.ok) { check.ok = false; check.issues.push(`${CHECK_DOWN}the source check could not run: ${r.code}: ${r.message}`); if (PAUSE_CODES.has(r.code)) throw new Stop('unfinished', `provider_${r.code.toLowerCase()}`, `The source check stopped: ${r.message}`); return check; }
      for (const c of (r.json as any)?.claims || []) {
        const row = { claim: String(c?.claim || ''), label: String(c?.label || ''), note: String(c?.note || '') };
        check.claims.push(row);
        if (row.label !== 'supported') check.issues.push(`${row.label}: "${row.claim.slice(0, 140)}" ${row.note}`);
      }
    }
    check.ok = check.issues.length === 0;
    return check;
  }

  /**
   * Excerpts for a targeted fix, or null when the round needs a full rewrite: too many findings, a finding
   * with no passage in the body (a missing connection, or one that points into the intro), a structural
   * finding, an ending that fails, or excerpts too large to be called targeted.
   */
  function targetedExcerpts(run: ReviewRun, round: RoundRecord, body: string, sourceIssues: string): Excerpt[] | null {
    if (!run.config.targetedReviser) return null;
    let passages: string[];
    if (sourceIssues) {
      passages = [...sourceIssues.matchAll(/"([^"]{12,})"/g)].map(m => m[1]);
      const lock = getIntroLock(run.projectId);
      const start = lock ? splitScript(draftText(run, run.source.startHash), lock) : null;
      const changed = changedParagraphs(start && start.ok ? start.body : '', body);
      if (passageExcerpts(body, passages).missing.length || !passages.length) {
        if (changed.length > TARGETED_MAX_FINDINGS) return null;
        passages = [...passages, ...changed];
      }
    } else {
      const reviews = REVIEWERS.map(id => round.reviews[id]).filter((o): o is Extract<ReviewOutcome, { ok: true }> => !!o?.ok).map(o => o.review);
      if (reviews.some(r => r.ending.verdict === 'fails')) return null;
      const findings = reviews.flatMap(r => r.findings);
      if (!findings.length || findings.length > TARGETED_MAX_FINDINGS) return null;
      if (findings.some(f => f.structural || !f.passage || f.inIntro)) return null;
      passages = findings.map(f => f.passage);
    }
    const { excerpts, missing } = passageExcerpts(body, passages);
    if (!excerpts.length || (missing.length && !sourceIssues)) return null;
    const chars = excerpts.reduce((a, e) => a + e.text.length, 0);
    if (chars > Math.max(4000, body.length * TARGETED_MAX_SHARE)) return null;
    return excerpts;
  }

  /* The loop ------------------------------------------------------------------------------------- */
  function finish(run: ReviewRun, status: ReviewRunStatus, reason: string, message: string) {
    run.status = status;
    run.stopReason = reason;
    run.message = message;
    const hash = status === 'complete' ? run.currentHash : (run.bestHash = strongestDraft(run.rounds, run.bestHash));
    try {
      const text = draftText(run, hash);
      const round = [...run.rounds].reverse().find(r => r.draftHash === hash);
      const scores: Partial<Record<ReviewerId, number>> = {};
      for (const id of REVIEWERS) { const o = round?.reviews[id]; if (o?.ok) scores[id] = o.review.score; }
      const label = status === 'complete'
        ? `Review loop COMPLETE: Gemini ${scores.gemini}, ChatGPT ${scores.chatgpt}`
        : `Review loop UNFINISHED (${reason}): strongest draft${Object.keys(scores).length ? `, Gemini ${scores.gemini ?? '-'}, ChatGPT ${scores.chatgpt ?? '-'}` : ''}`;
      const file = path.join(runDir(run.projectId, run.id), status === 'complete' ? 'FINAL-COMPLETE.md' : 'FINAL-UNFINISHED.md');
      writeAtomic(file, text);
      run.result = { file, hash, label, scores };
      if (status === 'complete' || status === 'unfinished') {
        try { run.result.versionId = deps.saveResult?.(run.projectId, text, label); }
        catch (e: any) { run.result.importError = e?.message || String(e); }
      }
    } catch (e: any) { run.result = { file: '', hash, label: `result not saved: ${e?.message || e}` }; }
    save(run);
  }

  async function loop(runId: string, projectId: string) {
    const run = getRun(projectId, runId);
    if (!run) return;
    const lock = getIntroLock(projectId);
    const ctl = new AbortController();
    controllers.set(run.id, ctl);
    const budget: Budget = { maxUsd: run.config.maxUsd, spentUsd: run.spentUsd };
    run.status = 'running';
    run.stopReason = undefined;
    run.message = undefined;
    save(run);
    try {
      if (!lock || lock.sha256 !== run.intro.sha256) throw new Stop('failed', 'intro_changed', 'The intro lock changed since this run started.');
      let pendingSourceIssues = '';
      let rejectedLastRound = '';
      for (;;) {
        if (ctl.signal.aborted) throw new Stop('cancelled', 'cancelled', 'Cancelled.');
        if (run.round >= run.config.maxRounds) throw new Stop('unfinished', 'round_limit', `Reached the safety limit of ${run.config.maxRounds} rounds.`);
        const full = draftText(run, run.currentHash);
        const split = splitScript(full, lock);
        if (split.ok === false) throw new Stop('failed', 'intro_mismatch', split.reason);
        const draft = run.drafts.find(d => d.hash === run.currentHash)!;

        // REVIEW. The latest reviews are reused only when the draft did not change (no edit could be applied).
        const last = run.rounds[run.rounds.length - 1];
        const reuse = !!last && last.draftHash === run.currentHash && REVIEWERS.every(id => last.reviews[id]?.ok) && (!last.passed || !!pendingSourceIssues);
        const round: RoundRecord = reuse ? last : { n: run.rounds.length + 1, draftHash: run.currentHash, draftNumber: draft.n, startedAt: now(), reviews: {}, passed: false, passBlockers: [] };
        if (!reuse) {
          // After a reviewed draft, review only what changed (changed scenes in full, the rest as an outline),
          // unless a focused review just passed: delivery always needs a full review of the same draft by both.
          const prevReviewed = [...run.rounds].reverse().find(r => r.draftHash !== run.currentHash && REVIEWERS.every(id => r.reviews[id]?.ok));
          const lastRound = run.rounds[run.rounds.length - 1];
          const confirmFull = !!lastRound && lastRound.draftHash === run.currentHash && lastRound.scope === 'focused' && lastRound.passed;
          let view: string | undefined;
          if (prevReviewed && !confirmFull) {
            const prevSplit = splitScript(draftText(run, prevReviewed.draftHash), lock);
            const fv = prevSplit.ok ? focusedView(split.intro, split.body, prevSplit.body) : null;
            if (fv) view = fv.script;
          }
          round.scope = view ? 'focused' : 'full';
          run.rounds.push(round);
          round.reviews = await reviewBoth(run, budget, full, split.intro, split.body, ctl.signal, view);
          const paused = Object.values(round.reviews).find(o => o && !o.ok && PAUSE_CODES.has(o.code)) as Extract<ReviewOutcome, { ok: false }> | undefined;
          round.passBlockers = passProblems(round.reviews, run.currentHash);
          round.passed = round.passBlockers.length === 0;
          run.bestHash = strongestDraft(run.rounds, run.bestHash);
          save(run);
          if (paused) throw new Stop('unfinished', `provider_${paused.code.toLowerCase()}`, `${paused.reviewer} could not review: ${paused.message}`);
          const okCount = REVIEWERS.filter(id => round.reviews[id]?.ok).length;
          run.reviewFailStreak = okCount === 0 ? run.reviewFailStreak + 1 : 0;
          if (run.reviewFailStreak >= 3) throw new Stop('unfinished', 'reviews_failing', 'Both reviews failed three rounds in a row.');
          if (okCount === 0) { run.round++; save(run); continue; }
          if (round.passed) run.consecutiveFails = 0;
          else if (draft.origin !== 'start') run.consecutiveFails++;

          // A focused pass is not enough to deliver: the same draft gets a full review by both next.
          if (round.passed && round.scope === 'focused') { run.round++; save(run); continue; }

          // FINISH LINE: both pass a full review of a revised draft, then the final check.
          if (round.passed && draft.origin !== 'start') {
            const fc = await finalCheck(run, budget, full, ctl.signal);
            round.finalCheck = fc;
            save(run);
            if (fc.ok) {
              finish(run, 'complete', 'passed', `Both reviewers scored this draft ${PASS_SCORE}+ with no blockers, the intro matches exactly, and changed quotes and claims check out.`);
              return;
            }
            if (fc.issues.every(i => i.startsWith(CHECK_DOWN))) throw new Stop('unfinished', 'source_check_unavailable', `Passed both reviews, but the source check could not run. ${fc.issues.join(' ')}`);
            pendingSourceIssues = fc.issues.filter(i => !i.startsWith(CHECK_DOWN)).map(i => `- ${i}`).join('\n');
          }
        }

        // REVISE (Claude, body only). Mercury and Cohere only when needed.
        const recentFails = run.rounds.slice(-TACTIC_AFTER_FAILS);
        const changeTactic = !pendingSourceIssues && run.consecutiveFails >= TACTIC_AFTER_FAILS && run.consecutiveFails % TACTIC_AFTER_FAILS === 0;
        let tacticText = pendingSourceIssues ? 'Fix only the source-check problems listed; change nothing else.' : BASE_TACTIC;
        let tacticName = pendingSourceIssues ? 'source_fix' : 'revise';
        let recurring: ReturnType<typeof recurringProblem> = null;
        if (changeTactic) {
          recurring = recurringProblem(recentFails);
          const t = TACTICS[run.tacticIndex % TACTICS.length];
          run.tacticIndex++;
          tacticName = t.name;
          tacticText = `${t.text}\nThe recurring problem (flagged across the last ${TACTIC_AFTER_FAILS} rounds): ${recurring ? `${recurring.problem} (scene: ${recurring.sceneKey})` : 'see the findings'}.\n${BASE_TACTIC}`;
        }
        const revision: NonNullable<RoundRecord['revision']> = { tactic: tacticText, tacticName, ...(recurring ? { recurring: `${recurring.sceneKey}: ${recurring.problem}` } : {}), applied: 0, rejected: [], major: [] };
        round.revision = revision;

        let structureText = '';
        const persistent = pendingSourceIssues ? null : (tacticName === 'restructure' && recurring ? recurring : persistentStructural(run.rounds));
        if (persistent && (run.structureAsked[persistent.sceneKey] ?? -99) < round.n - 1) {
          run.structureAsked[persistent.sceneKey] = round.n;
          revision.structure = await structureOptions(run, budget, split.body, persistent, ctl.signal);
          if ('options' in revision.structure) structureText = JSON.stringify(revision.structure.options, null, 2);
        }
        let materialText = '';
        const wants = pendingSourceIssues ? [] : [...new Set(REVIEWERS.flatMap(id => { const o = round.reviews[id]; return o?.ok ? o.review.findings.map(f => f.needsMaterial).filter(Boolean) : []; }))];
        if (!pendingSourceIssues && tacticName === 'new_material' && recurring) wants.unshift(recurring.problem);
        if (wants.length) {
          const m = await findMaterial(run, budget, wants);
          revision.material = m.record;
          materialText = m.text;
        }

        const ctx = deps.context(run.projectId);
        // A small, local problem goes to the targeted reviser with only the paragraphs involved; anything
        // that spans the script (structure, a missing connection, new material, a changed tactic) is a full rewrite.
        const excerpts = !changeTactic && !persistent && !wants.length ? targetedExcerpts(run, round, split.body, pendingSourceIssues) : null;
        let rev: CompleteResult | null = null;
        if (excerpts) {
          const tp = RP.targetedRevisePrompt({
            brief: ctx.brief, reviews: reviewsForReviser(round.reviews), tactic: tacticText, excerpts,
            sourceIssues: pendingSourceIssues || undefined, rejectedEdits: rejectedLastRound || undefined,
          });
          revision.excerptChars = excerpts.reduce((a, e) => a + e.text.length, 0);
          const t = await call(run, budget, run.config.targetedReviser, 'reviser', tp, `targeted fix (round ${round.n})`, ctl.signal);
          if (t.ok) { rev = t; revision.mode = 'targeted'; revision.by = run.config.targetedReviser; }
          else revision.note = `Targeted fix unavailable (${t.code}); used a full rewrite instead.`;
        }
        if (!rev) {
          // A full rewrite is usually major, so it needs room for its blind comparison too. Stop before paying for one that couldn't be judged.
          if (!pendingSourceIssues && run.calls + 1 + REVIEWERS.length > run.config.maxCalls) {
            throw new Stop('unfinished', 'spending_limit', `Stopped before a full rewrite: it needs ${1 + REVIEWERS.length} model calls (the rewrite and its blind comparison), and the limit of ${run.config.maxCalls} leaves ${Math.max(0, run.config.maxCalls - run.calls)}.`);
          }
          const prompt = RP.revisePrompt({
            intro: split.intro, body: split.body, brief: ctx.brief, supporting: ctx.supporting, reviews: reviewsForReviser(round.reviews),
            tactic: tacticText, structureOptions: structureText || undefined, material: materialText || undefined,
            sourceIssues: pendingSourceIssues || undefined, rejectedEdits: rejectedLastRound || undefined,
          });
          revision.mode = 'full';
          revision.by = run.config.reviser;
          rev = await call(run, budget, run.config.reviser, 'reviser', prompt, `revise body (round ${round.n})`, ctl.signal);
        }
        if (!rev.ok) {
          revision.error = `${rev.code}: ${rev.message}`;
          save(run);
          if (PAUSE_CODES.has(rev.code)) throw new Stop('unfinished', `provider_${rev.code.toLowerCase()}`, `The rewrite could not run: ${rev.message}`);
          run.round++;
          save(run);
          continue;
        }
        let edits: BodyEdit[] = ((rev.json as any)?.edits || []).map((e: any) => ({ find: String(e?.find ?? ''), replace: String(e?.replace ?? ''), why: String(e?.why ?? '') }));
        const outside: { find: string; reason: string }[] = [];
        if (revision.mode === 'targeted' && excerpts) {
          const allowed = excerpts.map(e => loose(e.text));
          edits = edits.filter(e => {
            if (allowed.some(t => t.includes(loose(e.find)))) return true;
            outside.push({ find: e.find, reason: 'outside the passages sent for a targeted fix' });
            return false;
          });
        }
        revision.resolutions = (rev.json as any)?.resolutions || [];
        revision.summary = String((rev.json as any)?.summary || '');
        let result = applyBodyEdits(split.body, edits);
        let judged: Awaited<ReturnType<typeof judgeMajor>>;
        try {
          judged = pendingSourceIssues ? { revert: new Set<number>(), record: [] } : await judgeMajor(run, budget, split.body, result.applied, result.body, ctl.signal);
        } catch (e) {
          // Keep the paid-for rewrite on disk instead of discarding it; it stays out of the current draft until judged.
          const kept = e instanceof Stop ? reassemble(lock, result.body) : null;
          if (kept && kept.ok) {
            revision.unjudgedHash = addDraft(run, kept.text, 'unjudged', run.currentHash).hash;
            revision.applied = result.applied.length;
            save(run);
            throw new Stop((e as Stop).status, (e as Stop).reason, `${(e as Stop).message} The rewrite was saved unjudged as a separate draft; the current draft is unchanged.`);
          }
          throw e;
        }
        revision.major = judged.record;
        if (judged.revert.size) result = applyBodyEdits(split.body, edits, judged.revert);
        revision.applied = result.applied.length;
        revision.rejected = [...outside, ...result.rejected.map(r => ({ find: r.find, reason: r.reason }))];
        rejectedLastRound = revision.rejected.map(r => `- "${r.find.slice(0, 160)}": ${r.reason}`).join('\n');
        const assembled = reassemble(lock, result.body);
        if (assembled.ok === false) throw new Stop('failed', 'intro_mismatch', `A revision would have changed the intro; it was not accepted. ${assembled.reason}`);
        const rec = addDraft(run, assembled.text, pendingSourceIssues ? 'source_fix' : 'revision', run.currentHash);
        revision.newHash = rec.hash;
        // Any edit after a pass invalidates that pass: the new draft goes back through both reviews.
        if (rec.hash !== run.currentHash) pendingSourceIssues = '';
        run.currentHash = rec.hash;
        run.round++;
        save(run);
      }
    } catch (e: any) {
      run.spentUsd = budget.spentUsd;
      if (e instanceof Stop) finish(run, e.status, e.reason, e.message);
      else finish(run, 'failed', 'error', e?.message || String(e));
    } finally {
      controllers.delete(run.id);
    }
  }

  return {
    getIntroLock, setIntroLock, createRun, getRun, listRuns, draftText,
    start(run: ReviewRun) { void loop(run.id, run.projectId); },
    /** For tests: run to the end. */
    runToEnd: (run: ReviewRun) => loop(run.id, run.projectId),
    isActive: (runId: string) => controllers.has(runId),
    cancel(projectId: string, runId: string): boolean {
      const c = controllers.get(runId);
      if (c) { c.abort(); return true; }
      return false;
    },
    /** Continues an unfinished run (for example with a higher limit). The threshold never changes. */
    resume(projectId: string, runId: string, limits: { maxUsd?: number; maxCalls?: number; maxRounds?: number } = {}): ReviewRun {
      const run = getRun(projectId, runId);
      if (!run) throw new Error('Run not found.');
      if (run.status !== 'unfinished') throw new Error(`Only an unfinished run can be resumed (this one is ${run.status}).`);
      if (controllers.has(run.id)) throw new Error('That run is already running.');
      if (limits.maxUsd !== undefined) run.config.maxUsd = Math.max(run.config.maxUsd, Number(limits.maxUsd) || 0);
      if (limits.maxCalls !== undefined) run.config.maxCalls = Math.max(run.config.maxCalls, Math.floor(Number(limits.maxCalls) || 0));
      if (limits.maxRounds !== undefined) run.config.maxRounds = Math.max(run.config.maxRounds, Math.floor(Number(limits.maxRounds) || 0));
      run.status = 'running';
      run.result = undefined;
      save(run);
      return run;
    },
    /** On server start: a run left running by a restart is saved as unfinished, with its strongest draft. */
    markInterrupted(projectIds: string[]) {
      for (const pid of projectIds) for (const r of listRuns(pid)) if (r.status === 'running' && !controllers.has(r.id)) finish(r, 'unfinished', 'interrupted', 'Interrupted by a server restart. Resume continues from the saved draft.');
    },
  };
}
export type ReviewLoop = ReturnType<typeof createReviewLoop>;
