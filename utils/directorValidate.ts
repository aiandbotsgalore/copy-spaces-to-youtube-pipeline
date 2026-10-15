/**
 * Validation and deterministic application of Director output.
 * The LLM is never trusted: every id, excerpt, number and phrase is checked here.
 */
import type {
  ClipLike,
  CutId,
  DirectorCandidate,
  DirectorCurrentItem,
  DirectorCutResponse,
  DirectorOp,
  DirectorPick,
  DirectorProvenance,
  DirectorRefineResponse,
} from './directorTypes';
import {
  ARCHETYPES,
  DIRECTOR_MAX_OPS,
  GAP_MAX_SEC,
  GAP_MIN_SEC,
  NOTE_MAX_CHARS,
  RUNTIME_TOLERANCE,
  findBannedLanguage,
} from './directorProfile';

export interface ValidationResult<T> {
  errors: string[];
  warnings: string[];
  value?: T;
}

/* ---------------------------------------------------------------------------------------------- */
/* Text helpers                                                                                    */
/* ---------------------------------------------------------------------------------------------- */

/** Lowercase, drop apostrophes, collapse everything non-alphanumeric to single spaces. */
export function normalizeText(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[‘’'`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Position of `kept` inside `full` in normalised coordinates, or null when it is not a contiguous excerpt. */
export function findExcerpt(full: string, kept: string): { start: number; end: number; length: number } | null {
  const f = normalizeText(full);
  const k = normalizeText(kept);
  if (!k || !f) return null;
  const at = f.indexOf(k);
  if (at < 0) return null;
  return { start: at, end: at + k.length, length: f.length };
}

/** Extract the first balanced JSON object from model text (tolerates ```json fences and prose around it). */
export function parseJsonLoose(text: string): unknown {
  if (typeof text !== 'string') return null;
  let t = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1].trim();
  try {
    return JSON.parse(t);
  } catch {
    /* fall through to brace scan */
  }
  const startIdx = t.indexOf('{');
  if (startIdx < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = startIdx; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(t.slice(startIdx, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const isStr = (v: unknown): v is string => typeof v === 'string';
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function lint(field: string, text: string, errors: string[]) {
  const hit = findBannedLanguage(text);
  if (hit) errors.push(`${field} uses loaded language ("${hit}"). Use neutral, descriptive wording.`);
}

/* ---------------------------------------------------------------------------------------------- */
/* Runtime estimation                                                                              */
/* ---------------------------------------------------------------------------------------------- */

export function estimatePickDuration(pick: DirectorPick, cand: DirectorCandidate): number {
  if (pick.keptText && cand.text && !cand.textTruncated) {
    const full = normalizeText(cand.text).length;
    const kept = normalizeText(pick.keptText).length;
    if (full > 0) return cand.durationSec * clamp(kept / full, 0.05, 1);
  }
  return cand.durationSec;
}

export function estimateRuntime(picks: DirectorPick[], byId: Record<string, DirectorCandidate>): number {
  let total = 0;
  picks.forEach((p, i) => {
    const c = byId[p.clipId];
    if (!c) return;
    total += estimatePickDuration(p, c);
    if (i < picks.length - 1) total += p.gapAfterSec;
  });
  return total;
}

export function runtimeCheck(estimated: number, target: number) {
  const lo = target * (1 - RUNTIME_TOLERANCE);
  const hi = target * (1 + RUNTIME_TOLERANCE);
  return { ok: estimated >= lo && estimated <= hi, lo, hi, over: estimated > hi, under: estimated < lo, delta: estimated - target };
}

/** Deterministic fix when over: drop the lowest-tension pick that is not first or last, until within +10%. */
export function enforceRuntimeDrop(
  picks: DirectorPick[],
  byId: Record<string, DirectorCandidate>,
  target: number
): { picks: DirectorPick[]; dropped: string[] } {
  const out = picks.map(p => ({ ...p }));
  const dropped: string[] = [];
  const hi = target * (1 + RUNTIME_TOLERANCE);
  while (out.length > 2 && estimateRuntime(out, byId) > hi) {
    let best = -1;
    for (let i = 1; i < out.length - 1; i++) {
      if (best < 0) best = i;
      else {
        const a = out[i];
        const b = out[best];
        const da = byId[a.clipId]?.durationSec ?? 0;
        const db = byId[b.clipId]?.durationSec ?? 0;
        if (a.tensionScore < b.tensionScore || (a.tensionScore === b.tensionScore && da > db)) best = i;
      }
    }
    if (best < 0) break;
    dropped.push(out[best].clipId);
    out.splice(best, 1);
  }
  if (out.length) out[out.length - 1].gapAfterSec = 0;
  return { picks: out, dropped };
}

/* ---------------------------------------------------------------------------------------------- */
/* Generate validation                                                                             */
/* ---------------------------------------------------------------------------------------------- */

export interface GenerateContext {
  cutId: CutId;
  candidatesById: Record<string, DirectorCandidate>;
}

export function validateGenerate(raw: unknown, ctx: GenerateContext): ValidationResult<DirectorCutResponse> {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!raw || typeof raw !== 'object') return { errors: ['Output is not a JSON object.'], warnings };
  const r = raw as Record<string, unknown>;

  let title = isStr(r.title) ? r.title.trim() : '';
  let tagline = isStr(r.tagline) ? r.tagline.trim() : '';
  if (!title) {
    title = ARCHETYPES[ctx.cutId].title;
    warnings.push('Missing title; used the default cut name.');
  }
  if (!tagline) tagline = '';
  lint('title', title, errors);
  if (tagline) lint('tagline', tagline, errors);

  if (!Array.isArray(r.picks) || r.picks.length === 0) {
    errors.push('"picks" must be a non-empty array.');
    return { errors, warnings };
  }

  const seen = new Set<string>();
  const picks: DirectorPick[] = [];
  (r.picks as unknown[]).forEach((p, i) => {
    const label = `pick ${i + 1}`;
    if (!p || typeof p !== 'object') {
      errors.push(`${label}: not an object.`);
      return;
    }
    const o = p as Record<string, unknown>;
    const clipId = isStr(o.clipId) ? o.clipId : '';
    const cand = ctx.candidatesById[clipId];
    if (!cand) {
      errors.push(`${label}: unknown clipId "${clipId}". Only use ids from "candidates".`);
      return;
    }
    if (seen.has(clipId)) {
      errors.push(`${label}: clipId "${clipId}" is used more than once.`);
      return;
    }
    seen.add(clipId);

    const gap = num(o.gapAfterSec);
    const tension = num(o.tensionScore);
    let note = isStr(o.note) ? o.note.trim() : '';
    if (note.length > NOTE_MAX_CHARS) note = note.slice(0, NOTE_MAX_CHARS - 1).trimEnd() + '…';
    if (note) lint(`${label} note`, note, errors);

    let keptText: string | undefined;
    if (isStr(o.keptText) && o.keptText.trim()) {
      if (cand.textTruncated) {
        warnings.push(`${label}: trim ignored because the candidate text was truncated.`);
      } else {
        const ex = findExcerpt(cand.text, o.keptText);
        if (!ex) {
          errors.push(`${label}: keptText is not a contiguous excerpt of the clip text. Copy it exactly or use null.`);
        } else if (ex.end - ex.start >= ex.length - 1) {
          keptText = undefined; // keeps everything: no trim
        } else {
          keptText = o.keptText.trim();
        }
      }
    }

    picks.push({
      clipId,
      keptText,
      gapAfterSec: clamp(gap ?? 0.35, GAP_MIN_SEC, GAP_MAX_SEC),
      tensionScore: Math.round(clamp(tension ?? 5, 1, 10)),
      note,
    });
  });

  if (errors.length) return { errors, warnings };
  if (picks.length) picks[picks.length - 1].gapAfterSec = 0;

  // Soft check: long same-speaker runs when the picks contain 2+ speakers.
  const speakers = new Set(picks.map(p => ctx.candidatesById[p.clipId].speaker));
  if (speakers.size >= 2) {
    let run = 1;
    for (let i = 1; i < picks.length; i++) {
      const same = ctx.candidatesById[picks[i].clipId].speaker === ctx.candidatesById[picks[i - 1].clipId].speaker;
      run = same ? run + 1 : 1;
      if (run === 3) {
        warnings.push(`Three or more consecutive clips from ${ctx.candidatesById[picks[i].clipId].speaker} (around pick ${i + 1}).`);
      }
    }
  }

  return { errors, warnings, value: { cutId: ctx.cutId, title, tagline, picks } };
}

/* ---------------------------------------------------------------------------------------------- */
/* Refine validation                                                                               */
/* ---------------------------------------------------------------------------------------------- */

export interface RefineContext {
  current: DirectorCurrentItem[];
  candidatesById: Record<string, DirectorCandidate>;
}

const OPS = new Set(['drop', 'move', 'trim', 'setGap', 'insert', 'replace', 'setNote']);

export function validateRefine(raw: unknown, ctx: RefineContext): ValidationResult<DirectorRefineResponse> {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!raw || typeof raw !== 'object') return { errors: ['Output is not a JSON object.'], warnings };
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.ops)) return { errors: ['"ops" must be an array.'], warnings };

  const currentById = new Map(ctx.current.map(c => [c.clipId, c]));
  let rawOps = r.ops as unknown[];
  if (rawOps.length > DIRECTOR_MAX_OPS) {
    warnings.push(`Only the first ${DIRECTOR_MAX_OPS} of ${rawOps.length} operations were kept.`);
    rawOps = rawOps.slice(0, DIRECTOR_MAX_OPS);
  }

  const ops: DirectorOp[] = [];
  rawOps.forEach((entry, i) => {
    const label = `op ${i + 1}`;
    if (!entry || typeof entry !== 'object') {
      errors.push(`${label}: not an object.`);
      return;
    }
    const o = entry as Record<string, unknown>;
    const kind = isStr(o.op) ? o.op : '';
    if (!OPS.has(kind)) {
      errors.push(`${label}: unknown op "${kind}".`);
      return;
    }
    const clipId = isStr(o.clipId) ? o.clipId : '';
    const cur = currentById.get(clipId);
    const needsCurrent = kind !== 'insert';
    if (needsCurrent) {
      if (!cur) {
        errors.push(`${label}: clipId "${clipId}" is not in the current timeline.`);
        return;
      }
      if (cur.locked) {
        errors.push(`${label}: clip "${clipId}" is locked and must not be changed.`);
        return;
      }
    }

    switch (kind) {
      case 'drop':
        ops.push({ op: 'drop', clipId });
        break;
      case 'move': {
        const to = num(o.toIndex);
        if (to === null) {
          errors.push(`${label}: move needs an integer toIndex.`);
          return;
        }
        ops.push({ op: 'move', clipId, toIndex: clamp(Math.round(to), 0, Math.max(0, ctx.current.length - 1)) });
        break;
      }
      case 'trim': {
        const kept = isStr(o.keptText) ? o.keptText : '';
        if (!kept.trim()) {
          errors.push(`${label}: trim needs keptText.`);
          return;
        }
        if (cur && cur.textTruncated) {
          warnings.push(`${label}: trim skipped because the clip text was truncated.`);
          return;
        }
        if (cur && !findExcerpt(cur.text, kept)) {
          errors.push(`${label}: keptText is not a contiguous excerpt of the clip text.`);
          return;
        }
        ops.push({ op: 'trim', clipId, keptText: kept.trim() });
        break;
      }
      case 'setGap': {
        const g = num(o.gapAfterSec);
        if (g === null) {
          errors.push(`${label}: setGap needs gapAfterSec.`);
          return;
        }
        ops.push({ op: 'setGap', clipId, gapAfterSec: clamp(g, GAP_MIN_SEC, GAP_MAX_SEC) });
        break;
      }
      case 'insert': {
        if (!ctx.candidatesById[clipId]) {
          errors.push(`${label}: insert clipId "${clipId}" is not a candidate.`);
          return;
        }
        if (currentById.has(clipId)) {
          errors.push(`${label}: clip "${clipId}" is already in the timeline.`);
          return;
        }
        const at = num(o.atIndex);
        const g = num(o.gapAfterSec);
        const note = isStr(o.note) ? o.note.trim().slice(0, NOTE_MAX_CHARS) : undefined;
        if (note) lint(`${label} note`, note, errors);
        ops.push({
          op: 'insert',
          clipId,
          atIndex: clamp(Math.round(at ?? ctx.current.length), 0, ctx.current.length),
          gapAfterSec: g === null ? undefined : clamp(g, GAP_MIN_SEC, GAP_MAX_SEC),
          note: note || undefined,
        });
        break;
      }
      case 'replace': {
        const withId = isStr(o.withClipId) ? o.withClipId : '';
        if (!ctx.candidatesById[withId]) {
          errors.push(`${label}: withClipId "${withId}" is not a candidate.`);
          return;
        }
        if (currentById.has(withId)) {
          errors.push(`${label}: clip "${withId}" is already in the timeline.`);
          return;
        }
        ops.push({ op: 'replace', clipId, withClipId: withId });
        break;
      }
      case 'setNote': {
        const note = isStr(o.note) ? o.note.trim().slice(0, NOTE_MAX_CHARS) : '';
        if (!note) {
          errors.push(`${label}: setNote needs note.`);
          return;
        }
        lint(`${label} note`, note, errors);
        ops.push({ op: 'setNote', clipId, note });
        break;
      }
    }
  });

  let summary = isStr(r.summary) ? r.summary.trim() : '';
  if (!summary) summary = ops.length ? `Applied ${ops.length} edit${ops.length === 1 ? '' : 's'}.` : 'No changes.';
  lint('summary', summary, errors);

  if (errors.length) return { errors, warnings };
  return { errors, warnings, value: { ops, summary } };
}

/* ---------------------------------------------------------------------------------------------- */
/* Deterministic application                                                                       */
/* ---------------------------------------------------------------------------------------------- */

export interface ApplyContext<T extends ClipLike> {
  byId: Record<string, T>;
  provenance?: DirectorProvenance;
}

export interface ApplyResult<T extends ClipLike> {
  clips: T[];
  changelog: string[];
  pendingTrims: { clipId: string; keptText: string }[];
  rejected: string[];
}

const label = (c: ClipLike) => (c.quoteId ? c.quoteId : c.title || c.id);

export function applyOps<T extends ClipLike>(clips: T[], ops: DirectorOp[], ctx: ApplyContext<T>): ApplyResult<T> {
  let list = clips.map(c => ({ ...c }));
  const changelog: string[] = [];
  const rejected: string[] = [];
  const pendingTrims: { clipId: string; keptText: string }[] = [];
  const indexOf = (id: string) => list.findIndex(c => c.id === id);

  for (const op of ops) {
    if (op.op === 'insert') {
      const base = ctx.byId[op.clipId];
      if (!base) {
        rejected.push(`Insert skipped: unknown clip ${op.clipId}.`);
        continue;
      }
      if (indexOf(op.clipId) >= 0) {
        rejected.push(`Insert skipped: ${label(base)} is already in the timeline.`);
        continue;
      }
      const at = clamp(op.atIndex, 0, list.length);
      const inserted = {
        ...base,
        gapAfterSec: op.gapAfterSec ?? base.gapAfterSec,
        directorNote: op.note ?? base.directorNote,
        director: ctx.provenance ?? base.director,
      } as T;
      list.splice(at, 0, inserted);
      changelog.push(`Inserted ${label(base)} at #${at + 1}`);
      continue;
    }

    const idx = indexOf(op.clipId);
    if (idx < 0) {
      rejected.push(`Skipped ${op.op}: clip ${op.clipId} is not in the timeline.`);
      continue;
    }
    const target = list[idx];
    if (target.locked) {
      rejected.push(`Skipped ${op.op}: #${idx + 1} (${label(target)}) is locked.`);
      continue;
    }

    switch (op.op) {
      case 'drop':
        list.splice(idx, 1);
        changelog.push(`Dropped #${idx + 1} (${label(target)})`);
        break;
      case 'move': {
        const to = clamp(op.toIndex, 0, list.length - 1);
        const [item] = list.splice(idx, 1);
        list.splice(to, 0, item);
        changelog.push(`Moved #${idx + 1} to #${to + 1}`);
        break;
      }
      case 'trim':
        pendingTrims.push({ clipId: op.clipId, keptText: op.keptText });
        changelog.push(`Trimmed #${idx + 1} (${label(target)})`);
        break;
      case 'setGap':
        list[idx] = { ...target, gapAfterSec: op.gapAfterSec };
        changelog.push(`Gap after #${idx + 1} set to ${op.gapAfterSec.toFixed(2)}s`);
        break;
      case 'replace': {
        const base = ctx.byId[op.withClipId];
        if (!base) {
          rejected.push(`Replace skipped: unknown clip ${op.withClipId}.`);
          break;
        }
        if (indexOf(op.withClipId) >= 0) {
          rejected.push(`Replace skipped: ${label(base)} is already in the timeline.`);
          break;
        }
        list[idx] = {
          ...base,
          gapAfterSec: target.gapAfterSec,
          tensionScore: target.tensionScore,
          directorNote: undefined,
          director: ctx.provenance ?? base.director,
        } as T;
        changelog.push(`Replaced #${idx + 1} (${label(target)}) with ${label(base)}`);
        break;
      }
      case 'setNote':
        list[idx] = { ...target, directorNote: op.note };
        changelog.push(`Updated note on #${idx + 1}`);
        break;
    }
  }
  return { clips: list, changelog, pendingTrims, rejected };
}
