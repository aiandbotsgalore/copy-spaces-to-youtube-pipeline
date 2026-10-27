/**
 * Logan's style card, built automatically from the whole archive: every segment Logan speaks in
 * public/transcripts/episodes plus his written narration in speaker_samples/Logan/narration_examples.
 * Logan never picks episodes.
 *
 * - Code measures ALL of Logan's speech: words, speaking time, turn and sentence length, questions,
 *   openers, fillers and the phrases he uses far more than the other speakers in his Spaces.
 * - A deterministic sample of his longer turns, spread evenly over every recording date, is read by
 *   the analyst role in batches (map); one more call merges the batch notes with his narration examples
 *   into a card with a "live" and a "polished" section (reduce).
 * - Every example the model quotes is checked in code against the passages it was given (or the
 *   narration files) and dropped when it is not there.
 * - The card records honest coverage (all segments measured in code; N turns from M recordings read
 *   by the model) and a source hash, so it is rebuilt when the archive or the examples change.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { StyleCard, StyleTrait } from '../utils/scriptTypes';
import { dateOfTag } from '../utils/scriptFormats';
import * as P from './scriptPrompts';
import type { CompleteResult } from './scriptProviders';
import type { ScriptStore } from './scriptStore';

export const STYLE_CARD_FILE = 'style-card.json';
const BATCH_CHARS = 30_000;
const MAX_BATCHES = 6;
const TURN_MIN_WORDS = 40;
const TURN_MAX_WORDS = 220;
const TURN_GAP_SEC = 3;
const REBUILD_GROWTH = 0.05;

const STOP = new Set('the a an and or but of to in on at for with is it that this i you he she we they be was were are am so if as do not no just like um uh'.split(' '));

export type StyleCall = (role: 'analyst', prompt: P.Prompt, label: string) => Promise<CompleteResult>;
export type Renames = Record<string, Record<string, string>>; // releaseTag -> raw label -> display name

/* ------------------------------------------------------------------------------------------------ */
/* Who is Logan                                                                                     */
/* ------------------------------------------------------------------------------------------------ */

export function loganNames(root: string): string[] {
  const names = new Set<string>(['Logan']);
  try {
    const vp = JSON.parse(fs.readFileSync(path.join(root, 'public', 'voice_profiles.json'), 'utf8'));
    for (const [k, v] of Object.entries<any>(vp?.profiles || {})) if (/^logan\b/i.test(k) || /^logan\b/i.test(String(v?.name || ''))) names.add(String(v?.name || k));
  } catch { /* no profiles file */ }
  return [...names];
}

/** Logan is the voice-profile name and its aliases ("Logan", "Logan Black"), after Logan's own renames. */
export function isLogan(label: string, known: string[]): boolean {
  const l = label.trim();
  return known.some(n => n.toLowerCase() === l.toLowerCase()) || /^logan\b/i.test(l);
}

/* ------------------------------------------------------------------------------------------------ */
/* Corpus scan and statistics (code, over every segment)                                            */
/* ------------------------------------------------------------------------------------------------ */

export interface LoganTurn { tag: string; date: string | null; start: number; text: string; words: number }
export interface StyleStats {
  recordingsScanned: number; recordingsWithLogan: number; segments: number; words: number; speakingMinutes: number;
  shareOfSpeech: number; wordsPerMinute: number; turns: number; meanTurnWords: number; medianTurnWords: number;
  meanSentenceWords: number; shortSentenceShare: number; questionShare: number;
  fillersPer100Words: Record<string, number>; topOpeners: { opener: string; share: number }[];
  signaturePhrases: { phrase: string; per10kWords: number; ratio: number }[];
  firstDate: string | null; lastDate: string | null;
}
export interface CorpusScan { stats: StyleStats; turnsByTag: Map<string, LoganTurn[]>; sourceHash: string; recordingTags: string[] }

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
const FILLERS: Record<string, RegExp> = { um: /\bu+m+\b/gi, uh: /\bu+h+\b/gi, 'you know': /\byou know\b/gi, 'i mean': /\bi mean\b/gi, 'kind of': /\bkind of\b|\bkinda\b/gi };
const PHRASE_CANDIDATES = 300;

function transcriptFiles(root: string): { dir: string; files: string[] } {
  const dir = path.join(root, 'public', 'transcripts', 'episodes');
  return { dir, files: fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.endsWith('.embeddings.json')).sort() : [] };
}
function readSegs(file: string): any[] | null {
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(j) ? j : Array.isArray(j?.segments) ? j.segments : []; } catch { return null; }
}

/** Quick pass: which recordings have Logan speaking (for the card's freshness check). */
export function loganRecordingTags(root: string, renames: Renames = {}): string[] {
  const { dir, files } = transcriptFiles(root);
  const known = loganNames(root);
  const out: string[] = [];
  for (const f of files) {
    const tag = f.slice(0, -5);
    const segs = readSegs(path.join(dir, f));
    const names = renames[tag] || {};
    if (segs?.some(s => { const raw = String(s?.speaker ?? '').trim(); return String(s?.text ?? '').trim() && isLogan(names[raw] || raw, known); })) out.push(tag);
  }
  return out;
}

/** Adds the 3- and 4-word phrases of ws to counts (skipping phrases made only of stop words). */
function countPhrases(ws: string[], counts: Map<string, number>) {
  for (let i = 0; i < ws.length; i++) {
    let g = ws[i];
    let allStop = STOP.has(ws[i]);
    for (let n = 2; n <= 4 && i + n - 1 < ws.length; n++) {
      const w = ws[i + n - 1];
      g += ` ${w}`;
      allStop = allStop && STOP.has(w);
      if (n >= 3 && !allStop) counts.set(g, (counts.get(g) || 0) + 1);
    }
  }
}

/** Counts only the candidate phrases, checking their two-word prefix first. */
function countCandidates(ws: string[], counts: Map<string, number>, candidates: Map<string, number>, prefixes: Set<string>) {
  for (let i = 0; i + 2 < ws.length; i++) {
    const p2 = `${ws[i]} ${ws[i + 1]}`;
    if (!prefixes.has(p2)) continue;
    const g3 = `${p2} ${ws[i + 2]}`;
    if (candidates.has(g3)) counts.set(g3, (counts.get(g3) || 0) + 1);
    if (i + 3 < ws.length) { const g4 = `${g3} ${ws[i + 3]}`; if (candidates.has(g4)) counts.set(g4, (counts.get(g4) || 0) + 1); }
  }
}

const yieldLoop = () => new Promise<void>(r => setImmediate(r));

/** Measures every Logan segment (two passes over the archive; yields to the event loop between recordings). */
export async function scanCorpus(root: string, renames: Renames = {}): Promise<CorpusScan> {
  const { dir, files } = transcriptFiles(root);
  const known = loganNames(root);
  const turnsByTag = new Map<string, LoganTurn[]>();
  const hash = createHash('sha256');
  let segments = 0, totalWords = 0, speakingSec = 0, roomSpeechSec = 0, otherWords = 0;
  const fillerCounts: Record<string, number> = Object.fromEntries(Object.keys(FILLERS).map(k => [k, 0]));
  let loganGrams = new Map<string, number>();
  let scanned = 0;
  // Pass 1: every Logan segment (stats, turns, his phrases).
  for (const f of files) {
    const tag = f.slice(0, -5);
    if (scanned % 5 === 4) await yieldLoop();
    const segs = readSegs(path.join(dir, f));
    if (!segs) continue;
    scanned++;
    const names = renames[tag] || {};
    const turns: LoganTurn[] = [];
    let cur: LoganTurn | null = null;
    let lastEnd = -1, loganHere = 0, roomHere = 0;
    for (const s of segs) {
      const text = String(s?.text ?? '').trim();
      const start = Number(s?.start), end = Number(s?.end);
      if (!text || !Number.isFinite(start)) continue;
      const dur = Number.isFinite(end) && end > start ? end - start : 0;
      roomHere += dur;
      const raw = String(s?.speaker ?? '').trim();
      if (!isLogan(names[raw] || raw, known)) { if (cur) { turns.push(cur); cur = null; } continue; }
      const ws = words(text);
      loganHere++; segments++; totalWords += ws.length; speakingSec += dur;
      for (const [k, re] of Object.entries(FILLERS)) fillerCounts[k] += (text.match(re) || []).length;
      countPhrases(ws, loganGrams);
      if (cur && start - lastEnd <= TURN_GAP_SEC) { cur.text += ` ${text}`; cur.words += ws.length; }
      else { if (cur) turns.push(cur); cur = { tag, date: dateOfTag(tag), start, text, words: ws.length }; }
      lastEnd = Number.isFinite(end) ? end : start;
    }
    if (cur) turns.push(cur);
    if (loganHere) {
      turnsByTag.set(tag, turns);
      roomSpeechSec += roomHere;
      hash.update(`${tag}:${loganHere}:${segs.length}\n`);
    }
    if (scanned % 25 === 0 && loganGrams.size > 400_000) loganGrams = new Map([...loganGrams].filter(([, n]) => n >= 3));
  }
  // Pass 2: how often the other speakers in the same recordings use Logan's most frequent phrases.
  const candidates = new Map([...loganGrams].sort((a, b) => b[1] - a[1]).slice(0, PHRASE_CANDIDATES));
  loganGrams = new Map();
  const otherCounts = new Map<string, number>();
  const prefixes = new Set([...candidates.keys()].map(k => k.split(' ').slice(0, 2).join(' ')));
  let pass2 = 0;
  for (const tag of turnsByTag.keys()) {
    if (pass2++ % 5 === 4) await yieldLoop();
    const segs = readSegs(path.join(dir, `${tag}.json`)) || [];
    const names = renames[tag] || {};
    for (const s of segs) {
      const raw = String(s?.speaker ?? '').trim();
      const text = String(s?.text ?? '').trim();
      if (!text || isLogan(names[raw] || raw, known)) continue;
      const ws = words(text);
      otherWords += ws.length;
      countCandidates(ws, otherCounts, candidates, prefixes);
    }
  }
  const per10k = (n: number, w: number) => (w ? (10_000 * n) / w : 0);
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const sig = [...candidates.entries()]
    .map(([phrase, n]) => ({ phrase, per10kWords: r1(per10k(n, totalWords)), ratio: r1(per10k(n, totalWords) / Math.max(per10k(otherCounts.get(phrase) || 0, otherWords), per10k(1, otherWords))) }))
    .filter(x => x.ratio >= 1.5)
    .sort((a, b) => b.per10kWords * Math.log(b.ratio) - a.per10kWords * Math.log(a.ratio))
    .filter((x, i, arr) => !arr.slice(0, i).some(y => y.phrase.includes(x.phrase) || x.phrase.includes(y.phrase)))
    .slice(0, 20);

  const allTurns = [...turnsByTag.values()].flat();
  const turnWords = allTurns.map(t => t.words).sort((a, b) => a - b);
  let sentences = 0, sentenceWords = 0, short = 0, questions = 0;
  const openers = new Map<string, number>();
  for (const t of allTurns) {
    for (const sRaw of t.text.split(/(?<=[.!?])\s+/)) {
      const n = words(sRaw).length;
      if (!n) continue;
      sentences++; sentenceWords += n;
      if (n <= 6) short++;
      if (/\?\s*$/.test(sRaw)) questions++;
    }
    const op = words(t.text).slice(0, 2).join(' ');
    if (op) openers.set(op, (openers.get(op) || 0) + 1);
  }
  const dates = [...turnsByTag.keys()].map(dateOfTag).filter((d): d is string => !!d).sort();
  const stats: StyleStats = {
    recordingsScanned: scanned, recordingsWithLogan: turnsByTag.size, segments, words: totalWords, speakingMinutes: Math.round(speakingSec / 60),
    shareOfSpeech: r1(roomSpeechSec ? (100 * speakingSec) / roomSpeechSec : 0), wordsPerMinute: Math.round(speakingSec ? totalWords / (speakingSec / 60) : 0),
    turns: allTurns.length, meanTurnWords: r1(allTurns.length ? totalWords / allTurns.length : 0), medianTurnWords: turnWords.length ? turnWords[Math.floor(turnWords.length / 2)] : 0,
    meanSentenceWords: r1(sentences ? sentenceWords / sentences : 0), shortSentenceShare: r1(sentences ? (100 * short) / sentences : 0), questionShare: r1(sentences ? (100 * questions) / sentences : 0),
    fillersPer100Words: Object.fromEntries(Object.entries(fillerCounts).map(([k, v]) => [k, Math.round((totalWords ? (100 * v) / totalWords : 0) * 100) / 100])),
    topOpeners: [...openers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([opener, n]) => ({ opener, share: r1((100 * n) / Math.max(1, allTurns.length)) })),
    signaturePhrases: sig, firstDate: dates[0] || null, lastDate: dates[dates.length - 1] || null,
  };
  return { stats, turnsByTag, sourceHash: hash.digest('hex'), recordingTags: [...turnsByTag.keys()] };
}

export function statsText(s: StyleStats): string {
  return [
    `Measured in code over all ${s.segments.toLocaleString('en-US')} segments (${s.words.toLocaleString('en-US')} words, ${s.speakingMinutes.toLocaleString('en-US')} minutes) Logan speaks in ${s.recordingsWithLogan} of ${s.recordingsScanned} recordings, ${s.firstDate || '?'} to ${s.lastDate || '?'}.`,
    `Logan's share of the speech in the recordings he is in: ${s.shareOfSpeech}%. Speaking rate: ${s.wordsPerMinute} words per minute.`,
    `Turns: ${s.turns.toLocaleString('en-US')}, mean ${s.meanTurnWords} words, median ${s.medianTurnWords}. Sentences: mean ${s.meanSentenceWords} words; ${s.shortSentenceShare}% are 6 words or fewer; ${s.questionShare}% are questions.`,
    `Fillers per 100 words: ${Object.entries(s.fillersPer100Words).map(([k, v]) => `${k} ${v}`).join(', ')}.`,
    `Most common turn openers: ${s.topOpeners.map(o => `"${o.opener}" ${o.share}%`).join(', ')}.`,
    `Phrases Logan uses more than the other speakers in the same recordings (uses per 10,000 of his words; times the others' rate): ${s.signaturePhrases.map(p => `"${p.phrase}" ${p.per10kWords}, x${p.ratio}`).join('; ') || '(none stand out)'}.`,
  ].join('\n');
}

/* ------------------------------------------------------------------------------------------------ */
/* Deterministic sample                                                                             */
/* ------------------------------------------------------------------------------------------------ */

const h32 = (s: string) => parseInt(createHash('sha1').update(s).digest('hex').slice(0, 8), 16);

/** Longer turns, spread evenly over recording dates: one turn per recording (chosen by hash), as many recordings as fit. */
export function sampleTurns(turnsByTag: Map<string, LoganTurn[]>, maxChars = BATCH_CHARS * MAX_BATCHES): LoganTurn[] {
  const tags = [...turnsByTag.keys()].sort();
  const pick = (tag: string, round: number) => {
    const ok = (turnsByTag.get(tag) || []).filter(t => t.words >= TURN_MIN_WORDS && t.words <= TURN_MAX_WORDS);
    if (ok.length <= round) return null;
    return [...ok].sort((a, b) => h32(`${tag}|${a.start}`) - h32(`${tag}|${b.start}`))[round];
  };
  const out: LoganTurn[] = [];
  let chars = 0;
  for (let round = 0; round < 3; round++) {
    const cands = tags.map(t => pick(t, round)).filter((x): x is LoganTurn => !!x);
    const room = Math.max(0, maxChars - chars);
    const avg = cands.length ? cands.reduce((s, t) => s + t.text.length + 16, 0) / cands.length : 1;
    const fit = Math.min(cands.length, Math.floor(room / avg));
    if (fit <= 0) break;
    const step = cands.length / fit;
    for (let i = 0; i < fit; i++) {
      const t = cands[Math.floor(i * step)];
      if (chars + t.text.length + 16 > maxChars) break;
      out.push(t); chars += t.text.length + 16;
    }
    if (fit < cands.length) break;
  }
  return out.sort((a, b) => a.tag.localeCompare(b.tag) || a.start - b.start);
}

export function batchTurns(turns: LoganTurn[], batchChars = BATCH_CHARS): string[] {
  const batches: string[] = [];
  let cur: string[] = [], size = 0;
  for (const t of turns) {
    const line = `[${t.date || 'undated'}] ${t.text}`;
    if (size + line.length > batchChars && cur.length) { batches.push(cur.join('\n\n')); cur = []; size = 0; }
    cur.push(line); size += line.length + 2;
  }
  if (cur.length) batches.push(cur.join('\n\n'));
  return batches;
}

/* ------------------------------------------------------------------------------------------------ */
/* Narration examples                                                                               */
/* ------------------------------------------------------------------------------------------------ */

export function readNarrationExamples(root: string): { files: string[]; text: string; hash: string } {
  const dir = path.join(root, 'speaker_samples', 'Logan', 'narration_examples');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.txt')).sort() : [];
  const parts = files.map(f => `## ${f}\n${fs.readFileSync(path.join(dir, f), 'utf8').replace(/^Logan:\s*/, '').trim()}`);
  const text = parts.join('\n\n');
  return { files, text, hash: createHash('sha256').update(text).digest('hex') };
}

/* ------------------------------------------------------------------------------------------------ */
/* Example verification and the card                                                                */
/* ------------------------------------------------------------------------------------------------ */

const norm = (s: string) => s.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Keeps only examples found verbatim (ignoring case and punctuation) in the source text. */
export function verifyTraits(traits: any[], source: string, max: number): { traits: StyleTrait[]; dropped: number } {
  const src = norm(source);
  let dropped = 0;
  const out: StyleTrait[] = [];
  for (const t of Array.isArray(traits) ? traits : []) {
    const trait = String(t?.trait || '').trim();
    if (!trait) continue;
    const examples: string[] = [];
    for (const e of Array.isArray(t?.examples) ? t.examples : []) {
      const n = norm(String(e || ''));
      if (n.split(' ').length >= 2 && src.includes(n)) examples.push(String(e).trim()); else dropped++;
    }
    out.push({ trait, examples: examples.slice(0, 3) });
    if (out.length >= max) break;
  }
  return { traits: out, dropped };
}

export function cardText(c: StyleCard): string {
  const tr = (ts: StyleTrait[]) => ts.map(t => `- ${t.trait}${t.examples.length ? ` e.g. ${t.examples.map(e => `"${e}"`).join(' / ')}` : ''}`).join('\n');
  const cov = c.coverage;
  return [
    `Logan's style card (built ${new Date(c.createdAt).toISOString().slice(0, 10)}; ${cov.segmentsMeasured.toLocaleString('en-US')} segments from ${cov.recordingsWithLogan} recordings measured in code; ${cov.turnsRead} of his turns from ${cov.recordingsRead} recordings read by the model; narration examples: ${cov.narrationFiles.join(', ') || 'none'}).`,
    `LIVE (how Logan talks in his Spaces): ${c.live.summary}`,
    tr(c.live.traits),
    `Measured: ${c.stats.meanSentenceWords} words per sentence on average, ${c.stats.shortSentenceShare}% short sentences, ${c.stats.questionShare}% questions, ${c.stats.wordsPerMinute} words per minute. Typical openers: ${c.stats.topOpeners.slice(0, 5).map(o => `"${o.opener}"`).join(', ')}. Signature phrases: ${c.stats.signaturePhrases.slice(0, 8).map(p => `"${p.phrase}"`).join(', ') || '(none stand out)'}.`,
    `POLISHED (Logan's written documentary narration): ${c.polished.summary}`,
    tr(c.polished.traits),
    c.avoid.length ? `AVOID:\n${c.avoid.map(a => `- ${a}`).join('\n')}` : '',
  ].filter(Boolean).join('\n');
}

export function readCard(store: ScriptStore): StyleCard | null {
  const c = store.readJson<StyleCard>(path.join(store.base, STYLE_CARD_FILE));
  return c && c.promptVersion === P.PROMPT_VERSIONS.styleCard && c.live ? c : null;
}

/** Whether the saved card still describes the archive: missing, older prompt, changed examples, or 5% more recordings. */
export function cardFreshness(card: StyleCard | null, scan: { recordingTags: string[] }, narrationHash: string): { fresh: boolean; reason: string; newRecordings: number } {
  if (!card) return { fresh: false, reason: 'No style card yet.', newRecordings: scan.recordingTags.length };
  const had = new Set(card.coverage.recordingTags || []);
  const added = scan.recordingTags.filter(t => !had.has(t)).length;
  if (card.narrationHash !== narrationHash) return { fresh: false, reason: 'The narration examples changed.', newRecordings: added };
  if (added > Math.max(1, had.size * REBUILD_GROWTH)) return { fresh: false, reason: `${added} recordings with Logan were added since the card was built.`, newRecordings: added };
  return { fresh: true, reason: added ? `${added} newer recordings are not in the card yet (rebuilt automatically after ${Math.ceil(had.size * REBUILD_GROWTH)}).` : 'Up to date.', newRecordings: added };
}

export async function buildStyleCard(args: { root: string; store: ScriptStore; call: StyleCall; scan: CorpusScan; now?: () => number; onProgress?: (msg: string) => void; batchChars?: number }): Promise<StyleCard> {
  const { scan } = args;
  const now = args.now ?? Date.now;
  if (!scan.turnsByTag.size) throw Object.assign(new Error('No segment in the transcripts is labelled as Logan, so there is nothing to build a style card from.'), { code: 'NO_LOGAN_SPEECH' });
  const narration = readNarrationExamples(args.root);
  const stats = statsText(scan.stats);
  const turns = sampleTurns(scan.turnsByTag);
  const batches = batchTurns(turns, args.batchChars);
  const batchNotes: { traits: StyleTrait[]; avoid: string[] }[] = [];
  let provider = '', model = '', dropped = 0;
  const failed: string[] = [];
  const okIdx: number[] = [];
  for (let i = 0; i < batches.length; i++) {
    args.onProgress?.(`Reading Logan's turns, batch ${i + 1} of ${batches.length}`);
    const r = await args.call('analyst', P.styleTraitsPrompt({ batch: i + 1, batches: batches.length, stats, passages: batches[i] }), `style traits ${i + 1}/${batches.length}`);
    if (!r.ok) { failed.push(`batch ${i + 1}: ${r.code}: ${r.message}`); if (r.code !== 'BAD_OUTPUT' && r.code !== 'TIMEOUT') break; continue; }
    provider = r.provider; model = r.model;
    const v = verifyTraits((r.json as any)?.traits, batches[i], 10);
    dropped += v.dropped;
    batchNotes.push({ traits: v.traits, avoid: ((r.json as any)?.avoid || []).map(String).slice(0, 8) });
    okIdx.push(i);
  }
  if (!batchNotes.length) throw Object.assign(new Error(`The style card could not be built: ${failed.join('; ')}`), { code: 'STYLE_FAILED' });
  args.onProgress?.('Writing the style card');
  const readOk = okIdx.map(i => batches[i]).join('\n\n');
  const r = await args.call('analyst', P.styleCardPrompt({ stats, traits: JSON.stringify(batchNotes), narration: narration.text || '(no narration examples)' }), 'style card');
  if (!r.ok) throw Object.assign(new Error(`The style card could not be written: ${r.code}: ${r.message}`), { code: r.code });
  const j: any = r.json;
  const live = verifyTraits(j?.live?.traits, readOk, 10);
  const polished = verifyTraits(j?.polished?.traits, narration.text, 8);
  dropped += live.dropped + polished.dropped;
  const readTurns = turns.filter(t => readOk.includes(t.text));
  const readTags = new Set(readTurns.map(t => t.tag));
  const card: StyleCard = {
    promptVersion: P.PROMPT_VERSIONS.styleCard, traitsPromptVersion: P.PROMPT_VERSIONS.styleTraits, createdAt: now(), provider: r.provider, model: r.model,
    batchProvider: provider, batchModel: model,
    live: { summary: String(j?.live?.summary || ''), traits: live.traits },
    polished: { summary: String(j?.polished?.summary || ''), traits: narration.text ? polished.traits : [] },
    avoid: (Array.isArray(j?.avoid) ? j.avoid : []).map(String).slice(0, 8),
    stats: scan.stats, sourceHash: scan.sourceHash, narrationHash: narration.hash,
    coverage: {
      segmentsMeasured: scan.stats.segments, recordingsWithLogan: scan.stats.recordingsWithLogan, recordingsScanned: scan.stats.recordingsScanned,
      turnsRead: readTurns.length, recordingsRead: readTags.size, batches: batches.length, batchesFailed: failed,
      narrationFiles: narration.files, examplesDropped: dropped, recordingTags: scan.recordingTags,
    },
    text: '',
  };
  card.text = cardText(card);
  args.store.writeJson(path.join(args.store.base, STYLE_CARD_FILE), card);
  return card;
}

/** Style inputs for the draft: the card, an excerpt of his narration, and his most recent approved passages. */
export function draftStyle(store: ScriptStore, root: string): { styleCard: string; approvedPassages: string } {
  const mem = store.getMemory();
  const approved = mem.approvedPassages.slice(-3).map(p => `- ${p.text}`).join('\n');
  const card = readCard(store);
  const ex = readNarrationExamples(root).text.slice(0, 3000);
  const styleCard = [card?.text, ex ? `Excerpt of Logan's written narration:\n${ex}` : ''].filter(Boolean).join('\n\n');
  return { styleCard, approvedPassages: approved };
}

/** The short voice description the critic weighs for authenticity. */
export function voiceSummary(store: ScriptStore): string {
  const c = readCard(store);
  if (!c) return '';
  return [`Live: ${c.live.summary}`, `Polished: ${c.polished.summary}`, c.avoid.length ? `Avoid: ${c.avoid.join('; ')}` : ''].filter(Boolean).join('\n');
}
