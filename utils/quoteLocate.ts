/**
 * Locates a verified quote in its transcript by matching its words in order, and checks whether the
 * quote is the transcript's exact wording. Pure code, no model calls. The quote text is never changed:
 * when it differs, the transcript wording is recorded beside it.
 *
 * Quotes joined with an ellipsis are located part by part; each part is matched word by word, allowing
 * a few extra transcript words between quote words (fillers like "um" that the corpus cleaned out).
 */
import { findExcerpt } from './directorValidate';
import type { TextCheck } from './scriptTypes';

export interface LocUtterance { id: string; start: number; end: number; speaker: string; text: string }

export interface LocateResult {
  located: boolean;
  utteranceIds: string[];     // contiguous, first to last matched word
  speakerLabels: string[];    // distinct raw transcript labels in that range, in order (suggestions, never proof)
  matchedPct: number;         // share of quote words matched in order, 0..1
  parts: number;              // ellipsis separated passages in the quote
  span?: string;              // transcript wording from the first to the last matched word
  segStart?: number; segEnd?: number;
  reason?: string;            // why it was not located
}

export const LOCATE_MIN_MATCH = 0.6;
/** Stored on every text check; raising it makes the library re-check its quotes with the new code. */
export const LOCATOR_VERSION = 2;
const LOOKAHEAD = 4;          // transcript words that may sit between two quote words
const ANCHOR_SPAN = 12;       // quote words tried as starting points
const WINDOW_SLACK_SEC = 30;

interface Tok { w: string; u: number; s: number; e: number }   // word, utterance index, char range in that utterance
interface Prepared { toks: Tok[]; bigrams: Map<string, number[]>; unigrams: Map<string, number[]> }

const WORD_RE = /[A-Za-z0-9‘’'`]+/g;
const normWord = (w: string) => w.toLowerCase().replace(/[‘’'`]/g, '');
const words = (s: string) => (s.match(WORD_RE) || []).map(normWord).filter(Boolean);
export const quoteParts = (quote: string) => quote.split(/\.\.\.|…/).map(words).filter(p => p.length > 0);

const cache = new WeakMap<LocUtterance[], Prepared>();
function prepare(utts: LocUtterance[]): Prepared {
  const hit = cache.get(utts);
  if (hit) return hit;
  const toks: Tok[] = [];
  utts.forEach((u, ui) => {
    for (const m of u.text.matchAll(WORD_RE)) {
      const w = normWord(m[0]);
      if (w) toks.push({ w, u: ui, s: m.index!, e: m.index! + m[0].length });
    }
  });
  const bigrams = new Map<string, number[]>();
  const unigrams = new Map<string, number[]>();
  toks.forEach((t, i) => {
    (unigrams.get(t.w) || unigrams.set(t.w, []).get(t.w)!).push(i);
    if (i + 1 < toks.length) { const k = `${t.w} ${toks[i + 1].w}`; (bigrams.get(k) || bigrams.set(k, []).get(k)!).push(i); }
  });
  const p = { toks, bigrams, unigrams };
  cache.set(utts, p);
  return p;
}

interface Match { matched: number; first: number; last: number }

/** Greedy in order match of part[qi..] starting at transcript token p. */
function greedy(P: Prepared, part: string[], qi: number, p: number): Match {
  let matched = 0, first = -1, last = -1, j = p;
  for (let i = qi; i < part.length; i++) {
    for (let k = j; k < Math.min(P.toks.length, j + LOOKAHEAD + 1); k++) {
      if (P.toks[k].w === part[i]) { matched++; if (first < 0) first = k; last = k; j = k + 1; break; }
    }
  }
  return { matched, first, last };
}

function bestFor(P: Prepared, utts: LocUtterance[], part: string[], after: number, window?: [number, number]): Match | null {
  const starts: [number, number][] = [];
  for (let i = 0; i < Math.min(part.length, ANCHOR_SPAN); i++) {
    const list = i + 1 < part.length ? P.bigrams.get(`${part[i]} ${part[i + 1]}`) : P.unigrams.get(part[i]);
    for (const p of list || []) starts.push([i, p]);
  }
  if (!starts.length) for (let i = 0; i < Math.min(part.length, ANCHOR_SPAN); i++) for (const p of P.unigrams.get(part[i]) || []) starts.push([i, p]);
  let best: Match | null = null, bestScore = -Infinity;
  for (const [i, p] of starts) {
    const m = greedy(P, part, i, p);
    if (!m.matched) continue;
    const t = utts[P.toks[m.first].u].start;
    const inWindow = window && t >= window[0] - WINDOW_SLACK_SEC && t <= window[1] + WINDOW_SLACK_SEC;
    // More words first; then inside the search window; then after the previous part; then tighter; then earlier.
    const score = m.matched + (inWindow ? 0.5 : 0) + (m.first > after ? 0.25 : 0) - (m.last - m.first) * 1e-6 - m.first * 1e-9;
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return best;
}

/** Original transcript text from token a to token b, across utterances. */
function tokenSpan(P: Prepared, utts: LocUtterance[], a: number, b: number): string {
  const ua = P.toks[a].u, ub = P.toks[b].u;
  if (ua === ub) return utts[ua].text.slice(P.toks[a].s, P.toks[b].e);
  return [utts[ua].text.slice(P.toks[a].s), ...utts.slice(ua + 1, ub).map(u => u.text), utts[ub].text.slice(0, P.toks[b].e)].join(' ');
}

export function locateQuote(quote: string, utts: LocUtterance[], opts: { window?: [number, number] } = {}): LocateResult {
  const parts = quoteParts(quote);
  const total = parts.reduce((n, p) => n + p.length, 0);
  const none = (reason: string, matchedPct = 0): LocateResult => ({ located: false, utteranceIds: [], speakerLabels: [], matchedPct, parts: parts.length, reason });
  if (!total) return none('The quote has no words.');
  if (!utts.length) return none('The transcript has no utterances.');
  const P = prepare(utts);
  let matched = 0, first = Infinity, last = -1, after = -1;
  const ranges: [number, number][] = [];
  for (const part of parts) {
    const m = bestFor(P, utts, part, after, opts.window);
    if (!m) continue;
    matched += m.matched;
    first = Math.min(first, m.first);
    last = Math.max(last, m.last);
    after = m.last;
    ranges.push([m.first, m.last]);
  }
  const pct = Math.round((matched / total) * 1000) / 1000;
  if (pct < LOCATE_MIN_MATCH || last < 0) return none(`Not found in the transcript: the best match covers ${Math.round(pct * 100)}% of the quote words (needs ${LOCATE_MIN_MATCH * 100}%).`, pct);
  const u0 = P.toks[first].u, u1 = P.toks[last].u;
  const range = utts.slice(u0, u1 + 1);
  // Each passage's own wording; passages that touch are shown as one, separate ones joined with an ellipsis.
  const merged: [number, number][] = [];
  for (const r of ranges.sort((a, b) => a[0] - b[0])) {
    const prev = merged[merged.length - 1];
    if (prev && r[0] <= prev[1] + LOOKAHEAD + 1) prev[1] = Math.max(prev[1], r[1]); else merged.push([...r]);
  }
  const span = merged.map(([a, b]) => tokenSpan(P, utts, a, b)).join(' … ');
  return {
    located: true, utteranceIds: range.map(u => u.id), speakerLabels: [...new Set(range.map(u => u.speaker))],
    matchedPct: pct, parts: parts.length, span, segStart: range[0].start, segEnd: range[range.length - 1].end,
  };
}

/** The stored text check for a located (or unlocated) quote. */
export function textCheck(quote: string, loc: LocateResult, utts: LocUtterance[], transcriptHash: string, now: number): TextCheck {
  const base = { checkedAt: now, transcriptHash, matchedPct: loc.matchedPct, locator: LOCATOR_VERSION };
  if (!loc.located) return { status: 'unlocated', ...base, note: loc.reason };
  const ids = new Set(loc.utteranceIds);
  const joined = utts.filter(u => ids.has(u.id)).map(u => u.text).join(' ');
  if (findExcerpt(joined, quote)) return { status: 'exact', ...base };
  const note = loc.parts > 1
    ? `Corpus wording is joined from ${loc.parts} transcript passages (ellipsis); the transcript wording is shown beside it.`
    : `Corpus wording differs from the transcript (${Math.round(loc.matchedPct * 100)}% of quote words found in order); the transcript wording is shown beside it.`;
  return { status: 'differs', transcriptSpan: loc.span, ...base, note };
}
