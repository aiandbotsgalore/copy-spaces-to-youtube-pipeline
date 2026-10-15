/**
 * Deterministic candidate shortlist for the Director.
 * Nothing excluded, blacklisted, unavailable, unplayable or of unknown real duration ever reaches the LLM.
 */
import type { ClipLike, DirectorCandidate } from './directorTypes';
import { DIRECTOR_CANDIDATE_CAP, DIRECTOR_TEXT_MAX_CHARS } from './directorProfile';
import { mapLimit, reconcileWindow } from './clipProbe';

export interface CandidateStats {
  total: number;
  excluded: number;
  blacklisted: number;
  unavailable: number;
  noAudio: number;
  unprobed: number;
  kept: number;
}

export interface PrepareOptions {
  isBlacklisted: (key: string) => boolean;
  hardExcludePhrase: string;
  userPrompt: string;
  cap?: number;
  probe: (url: string) => Promise<number | null>;
  concurrency?: number;
  /** Optional escalation weighting (higher = later in the arc). */
  escalationWeight?: (category?: string) => number;
}

export interface PrepareResult<T extends ClipLike> {
  candidates: DirectorCandidate[];
  byId: Record<string, T>;
  stats: CandidateStats;
}

export function truncateText(s: string, max = DIRECTOR_TEXT_MAX_CHARS): { text: string; truncated: boolean } {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return { text: t, truncated: false };
  let cut = t.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  if (sp > max * 0.6) cut = cut.slice(0, sp);
  return { text: cut.trim(), truncated: true };
}

export function emptyStats(total = 0): CandidateStats {
  return { total, excluded: 0, blacklisted: 0, unavailable: 0, noAudio: 0, unprobed: 0, kept: 0 };
}

/** Synchronous eligibility filter with reason counts. */
export function prefilterPool<T extends ClipLike>(
  pool: T[],
  opts: Pick<PrepareOptions, 'isBlacklisted' | 'hardExcludePhrase'>
): { eligible: T[]; stats: CandidateStats } {
  const stats = emptyStats(pool.length);
  const phrase = (opts.hardExcludePhrase || '').toLowerCase();
  const eligible: T[] = [];
  for (const c of pool) {
    const quote = (c.quote || '').toLowerCase();
    if (c.isExcluded || (phrase && quote.includes(phrase))) {
      stats.excluded++;
      continue;
    }
    if (opts.isBlacklisted(c.quoteId || '') || opts.isBlacklisted(c.id) || opts.isBlacklisted(c.quote || '')) {
      stats.blacklisted++;
      continue;
    }
    if (c.status === 'SOURCE_NOT_AVAILABLE') {
      stats.unavailable++;
      continue;
    }
    if (!c.audioUrl) {
      stats.noAudio++;
      continue;
    }
    eligible.push(c);
  }
  return { eligible, stats };
}

const STOP = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'their', 'her', 'his', 'then', 'versus', 'about',
  'after', 'before', 'clips', 'clip', 'cut', 'seconds', 'second', 'minute', 'minutes', 'high', 'strongest', 'lines',
]);

export function promptTokens(prompt: string): string[] {
  return ((prompt || '').toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []).filter(t => !STOP.has(t));
}

export function scoreClip(c: ClipLike, tokens: string[], arcWeight: number): number {
  const quote = (c.quote || '').toLowerCase();
  const title = (c.title || '').toLowerCase();
  const cat = (c.category || '').toLowerCase();
  const speaker = (c.speaker || '').toLowerCase();
  let s = 0;
  for (const t of tokens) {
    if (quote.includes(t)) s += 2;
    if (title.includes(t)) s += 1;
    if (cat.includes(t)) s += 1.5;
    if (speaker.includes(t)) s += 1.5;
  }
  s += (c.severity ?? 5) / 10;
  s += arcWeight;
  return s;
}

/** Rank by relevance, then stratify so no single category exceeds 40% of `take`. Stable for equal scores. */
export function rankAndStratify<T extends ClipLike>(
  clips: T[],
  prompt: string,
  take: number,
  escalationWeight?: (category?: string) => number
): T[] {
  const tokens = promptTokens(prompt);
  const arc = /\b(arc|escalat|chronolog|build)/i.test(prompt);
  const scored = clips
    .map((c, i) => ({ c, i, s: scoreClip(c, tokens, arc && escalationWeight ? escalationWeight(c.category) / 60 : 0) }))
    .sort((a, b) => b.s - a.s || a.i - b.i);

  const maxPerCat = Math.max(1, Math.floor(take * 0.4));
  const perCat = new Map<string, number>();
  const chosen: T[] = [];
  const overflow: T[] = [];
  for (const { c } of scored) {
    if (chosen.length >= take) break;
    const key = (c.category || '_none').toLowerCase();
    const n = perCat.get(key) || 0;
    if (n < maxPerCat) {
      chosen.push(c);
      perCat.set(key, n + 1);
    } else {
      overflow.push(c);
    }
  }
  for (const c of overflow) {
    if (chosen.length >= take) break;
    chosen.push(c);
  }
  return chosen;
}

export async function prepareCandidates<T extends ClipLike>(pool: T[], opts: PrepareOptions): Promise<PrepareResult<T>> {
  const cap = opts.cap ?? DIRECTOR_CANDIDATE_CAP;
  const { eligible, stats } = prefilterPool(pool, opts);

  // Over-sample so that probe failures do not leave us short.
  const sampled = rankAndStratify(eligible, opts.userPrompt, Math.ceil(cap * 1.5), opts.escalationWeight);

  const reconciled = await mapLimit(sampled, opts.concurrency ?? 6, async clip => {
    const dur = await opts.probe(clip.audioUrl as string);
    if (dur == null) return null;
    return reconcileWindow(clip, dur);
  });

  const usable: T[] = [];
  for (const r of reconciled) {
    if (!r) {
      stats.unprobed++;
      continue;
    }
    if (r.endSec - r.startSec < 0.5) {
      stats.unprobed++;
      continue;
    }
    usable.push(r);
  }

  const finalClips = usable.slice(0, cap);
  stats.kept = finalClips.length;

  const byId: Record<string, T> = {};
  const candidates: DirectorCandidate[] = finalClips.map(c => {
    byId[c.id] = c;
    const { text, truncated } = truncateText(c.quote || c.title || '');
    return {
      id: c.id,
      quoteId: c.quoteId,
      speaker: c.speaker,
      category: c.category,
      sourceDate: c.sourceDate,
      sourceTitle: c.sourceTitle || '',
      status: c.status === 'READY_FOR_EXTRACTION' ? 'READY_FOR_EXTRACTION' : 'EXISTS',
      durationSec: Math.round((c.endSec - c.startSec) * 10) / 10,
      text,
      textTruncated: truncated,
    };
  });
  // Stable order (by id) so the candidate block is byte-identical across the three parallel calls.
  candidates.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { candidates, byId, stats };
}

export function describeNoCandidates(stats: CandidateStats): string {
  const parts: string[] = [];
  if (stats.excluded) parts.push(`${stats.excluded} excluded`);
  if (stats.blacklisted) parts.push(`${stats.blacklisted} blacklisted`);
  if (stats.unavailable) parts.push(`${stats.unavailable} source unavailable`);
  if (stats.noAudio) parts.push(`${stats.noAudio} without audio`);
  if (stats.unprobed) parts.push(`${stats.unprobed} with unknown duration`);
  return `${stats.total} clips considered, none usable (${parts.join(', ') || 'pool is empty'}).`;
}
