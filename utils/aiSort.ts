/**
 * AI Sort for the Montage Reel & Sequencer.
 * Pure module (no DOM, no network) so the server middleware, the browser and tests can all share it.
 *
 * The model only ever sees short refs ("c1", "c2", ...) and returns an ordering of those refs. It never
 * sees or returns real ids, timestamps or audio data, and its output is treated as a PERMUTATION: unknown or
 * repeated refs are dropped, missing ones are appended, and locked clips are never moved. Sorting can
 * therefore reorder the reel but never add, remove or edit a clip.
 */
import type { ClipLike } from './directorTypes';
import { DIRECTOR_TEXT_MAX_CHARS } from './directorProfile';
import { truncateText } from './directorCandidates';

export const SORT_MAX_CLIPS = 100;
export const SORT_MIN_CLIPS = 3;
export const SORT_RATIONALE_MAX_CHARS = 240;

export interface SortItem {
  ref: string;
  text: string;
  textTruncated?: boolean;
  speaker: string;
  category?: string;
  severity?: number;
  sourceTitle: string;
  sourceDate?: string;
  /** Real probed duration, or null when it is not known yet (placeholder window). */
  durationSec: number | null;
}

export interface SortRequest {
  items: SortItem[];
  /** Optional theme (e.g. the last Prompt Director prompt) so the order can serve the montage's subject. */
  theme?: string;
  model?: string;
}

export interface SortOk {
  ok: true;
  mode: 'sort';
  /** Refs in the new order (always a full permutation of the request's refs). */
  order: string[];
  rationale: string;
  warnings: string[];
  usage: { promptTokens: number; completionTokens: number };
  model: string;
  ms: number;
}

export const SORT_SYSTEM_PROMPT = `You are the Sequencer: an editorial assistant that puts the clips of an audio montage into the best possible running order.
You work ONLY with the JSON you are given. You never hear audio. Each clip has a short "ref" (c1, c2, ...), its spoken text, speaker, category, source recording and date, and duration when known.

GOAL: the order that makes the strongest listening experience while staying faithful to the recordings.
1. Open with a clip that grabs attention and makes sense standing alone (a clear, self-contained statement, not one that depends on context that comes later). Avoid opening on a weak lead-in or a fragment.
2. Build an arc: set up the situation, develop it, escalate, and land on a strong, conclusive closing clip. Do not flat-line; vary the intensity.
3. Keep related clips together and in a logical flow: a clip that answers, rebuts or refers back to another must come after it. Group clips about the same subject, and place a statement next to the later statement it can be compared with.
4. Respect time. If clips from one source recording clearly describe sequential events, or a clip refers to an earlier event, keep them in chronological order (sourceDate, then the order the story needs). Never reorder so as to imply a sequence of events the recordings do not support.
5. Pacing: alternate long and short clips, and avoid more than 2 consecutive clips from the same speaker or the same source recording unless they form one continuous thought.
6. If a "theme" is provided, let it decide what the montage is about, and order for that subject.
7. Use every ref exactly once. Never invent a ref. Do not drop clips.
8. "rationale" is ONE neutral, descriptive sentence of at most 30 words saying how the order is built (for example: "Opens on a standalone statement, follows the timeline of the dispute, then ends on the strongest closing line"). No verdict words, no characterising anyone in your own voice, no emoji.

OUTPUT: a single JSON object and nothing else (no prose, no markdown fences): {"order": ["c3","c1",...], "rationale": string}`;

export const SORT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['order', 'rationale'],
  properties: {
    order: { type: 'array', items: { type: 'string' } },
    rationale: { type: 'string' },
  },
} as const;

/** Builds the model-facing items for the clips that may be moved (locked clips are excluded by the caller). */
export function buildSortItems(clips: ClipLike[]): { items: SortItem[]; refToId: Record<string, string> } {
  const refToId: Record<string, string> = {};
  const items = clips.map((c, i) => {
    const ref = `c${i + 1}`;
    refToId[ref] = c.id;
    const { text, truncated } = truncateText(c.quote || c.title || '', DIRECTOR_TEXT_MAX_CHARS);
    const dur = c.endSec - c.startSec;
    const known = !c.windowPlaceholder && Number.isFinite(dur) && dur > 0;
    const item: SortItem = {
      ref,
      text,
      speaker: c.speaker || '',
      sourceTitle: c.sourceTitle || '',
      durationSec: known ? Math.round(dur * 10) / 10 : null,
    };
    if (truncated) item.textTruncated = true;
    if (c.category) item.category = c.category;
    if (Number.isFinite(c.severity)) item.severity = c.severity;
    if (c.sourceDate) item.sourceDate = c.sourceDate;
    return item;
  });
  return { items, refToId };
}

export function buildSortMessages(req: SortRequest): Array<{ role: 'system' | 'user'; content: string }> {
  const payload: Record<string, unknown> = { task: 'sort', clips: req.items };
  if (req.theme) payload.theme = req.theme;
  return [
    { role: 'system', content: SORT_SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify(payload) },
  ];
}

export interface SortValidation {
  ok: boolean;
  order: string[];
  rationale: string;
  warnings: string[];
  /** Set when the output is unusable (caller may retry once). */
  error?: string;
}

/**
 * Turns raw model JSON into a full permutation of `refs`. Lenient on small slips (unknown or repeated refs
 * are dropped, forgotten refs are appended in their original order) and strict when the output is mostly wrong.
 */
export function validateSort(raw: unknown, refs: string[]): SortValidation {
  const bad = (error: string): SortValidation => ({ ok: false, order: [], rationale: '', warnings: [], error });
  if (!raw || typeof raw !== 'object') return bad('The model did not return a JSON object.');
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.order)) return bad('"order" must be an array of refs.');

  const valid = new Set(refs);
  const seen = new Set<string>();
  const order: string[] = [];
  let unknown = 0;
  let repeated = 0;
  for (const v of o.order) {
    const r = typeof v === 'string' ? v.trim() : '';
    if (!valid.has(r)) {
      unknown++;
      continue;
    }
    if (seen.has(r)) {
      repeated++;
      continue;
    }
    seen.add(r);
    order.push(r);
  }
  if (refs.length > 0 && order.length < Math.ceil(refs.length * 0.5)) {
    return bad(`Only ${order.length} of ${refs.length} clips were ordered. Return every ref exactly once.`);
  }

  const warnings: string[] = [];
  if (unknown) warnings.push(`Ignored ${unknown} unknown ref(s) from the model.`);
  if (repeated) warnings.push(`Ignored ${repeated} repeated ref(s) from the model.`);
  const missing = refs.filter(r => !seen.has(r));
  if (missing.length) {
    warnings.push(`${missing.length} clip(s) were not placed by the model and were appended at the end.`);
    order.push(...missing);
  }

  let rationale = typeof o.rationale === 'string' ? o.rationale.replace(/\s+/g, ' ').trim() : '';
  if (rationale.length > SORT_RATIONALE_MAX_CHARS) rationale = rationale.slice(0, SORT_RATIONALE_MAX_CHARS - 1).trimEnd() + '…';
  return { ok: true, order, rationale, warnings };
}

/**
 * Applies an ordering of clip ids to the live timeline.
 * - Locked clips stay at their current index.
 * - Every other clip fills the remaining slots in the order given; clips the order does not mention
 *   (added while the model was thinking) keep their relative order after the ones that are mentioned.
 * - Ids in `order` that no longer exist are ignored. Clips are never added, removed or modified.
 */
export function applySortOrder<T extends { id: string; locked?: boolean }>(clips: T[], order: string[]): T[] {
  const rank = new Map<string, number>();
  order.forEach((id, i) => {
    if (!rank.has(id)) rank.set(id, i);
  });
  const movable = clips.filter(c => !c.locked);
  const sorted = movable
    .map((c, i) => ({ c, i, r: rank.has(c.id) ? (rank.get(c.id) as number) : Number.POSITIVE_INFINITY }))
    .sort((a, b) => (a.r === b.r ? a.i - b.i : a.r - b.r))
    .map(x => x.c);
  let next = 0;
  return clips.map(c => (c.locked ? c : sorted[next++]));
}

/** True when `order` would change the movable clips' current sequence. */
export function orderChangesTimeline(clips: Array<{ id: string; locked?: boolean }>, order: string[]): boolean {
  const after = applySortOrder(clips, order);
  return after.some((c, i) => c.id !== clips[i].id);
}
