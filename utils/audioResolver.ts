import type { EpisodeSummary } from './transcriptData';
import { fetchSummaryIndex, findEpisodeInSummary } from './transcriptData';
import { isPlaceholderAudioUrl } from './audioUrl';
import { ANGELA_MASTER_CUTS } from './masterClipsSeed';
import type { PreCutClip } from './masterClipsSeed';

export type { PreCutClip };

export interface PreCutMatchQuery {
  quote?: string;
  title?: string;
  tag?: string;
  startSec?: number;
  endSec?: number;
  quoteId?: string;
  url?: string;
}

let cachedSummaries: EpisodeSummary[] | null = null;
let tagIndex: Map<string, EpisodeSummary> = new Map();
let sourceIdIndex: Map<string, EpisodeSummary> = new Map();

// Pre-cut clips caches and indexes
let cachedPreCutClips: PreCutClip[] = [...ANGELA_MASTER_CUTS];
let preCutById: Map<string, PreCutClip> = new Map();
let preCutByQuoteId: Map<string, PreCutClip> = new Map();
let preCutByUrl: Map<string, PreCutClip> = new Map();
let preCutBySpaceTag: Map<string, PreCutClip[]> = new Map();

function buildPreCutIndexes(clips: PreCutClip[]) {
  preCutById = new Map();
  preCutByQuoteId = new Map();
  preCutByUrl = new Map();
  preCutBySpaceTag = new Map();

  for (const c of clips) {
    if (c.id) {
      preCutById.set(c.id.toLowerCase(), c);
    }
    if (c.quote_id) {
      preCutByQuoteId.set(c.quote_id.toLowerCase(), c);
    }
    if (c.url) {
      const u = c.url.toLowerCase();
      preCutByUrl.set(u, c);
      const filename = u.split('/').pop();
      if (filename) preCutByUrl.set(filename, c);
    }
    if (c.space_tag) {
      const tagLower = c.space_tag.toLowerCase();
      const list = preCutBySpaceTag.get(tagLower) || [];
      list.push(c);
      preCutBySpaceTag.set(tagLower, list);
    }
  }
}

// Initialize pre-cut indexes with master seed table
buildPreCutIndexes(cachedPreCutClips);

/**
 * Register additional pre-cut clips (e.g. from manifest.json or clips_catalog.json).
 */
export function registerPreCutClips(clips: PreCutClip[]): void {
  if (!Array.isArray(clips) || clips.length === 0) return;
  const existingIds = new Set(cachedPreCutClips.map(c => c.id.toLowerCase()));
  const newClips = clips.filter(c => !existingIds.has(c.id.toLowerCase()));
  cachedPreCutClips = [...cachedPreCutClips, ...newClips];
  buildPreCutIndexes(cachedPreCutClips);
}

/**
 * Parses timestamps in various formats (HH:MM:SS, MM:SS, "12:56 segment") into seconds.
 */
export function parseTimestampSec(ts?: string | null): number | null {
  if (!ts) return null;
  const match3 = ts.match(/(\d{1,2}):(\d{2}):(\d{2})/);
  if (match3) return parseInt(match3[1], 10) * 3600 + parseInt(match3[2], 10) * 60 + parseInt(match3[3], 10);
  const match2 = ts.match(/(\d{1,2}):(\d{2})/);
  if (match2) return parseInt(match2[1], 10) * 60 + parseInt(match2[2], 10);
  return null;
}

export function normalizeText(s?: string | null): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanQuote(s?: string | null): string {
  return normalizeText(s).replace(/\.{2,}/g, '').trim();
}

const STOP_WORDS = new Set([
  'that', 'this', 'with', 'from', 'have', 'were', 'what', 'when', 'where', 'there',
  'their', 'about', 'just', 'like', 'some', 'than', 'them', 'then', 'into', 'only',
  'also', 'will', 'your', 'know', 'would', 'could', 'should', 'been', 'being', 'they'
]);

/**
 * Finds a matching pre-cut master clip based on ID, quote, space tag + timestamp, or filename.
 */
export function findPreCutClipMatch(
  q: PreCutMatchQuery,
  overridePreCuts?: PreCutClip[]
): PreCutClip | null {
  const pool = overridePreCuts || cachedPreCutClips;
  if (!pool || pool.length === 0) return null;

  // 1. Direct ID or Quote ID match
  if (q.quoteId) {
    const qid = q.quoteId.toLowerCase();
    const hit = pool.find(x => (x.quote_id && x.quote_id.toLowerCase() === qid) || x.id.toLowerCase() === qid);
    if (hit) return hit;
  }

  // 2. Direct pre-cut URL / filename match
  if (q.url && (q.url.includes('/clips/') || q.url.endsWith('.wav'))) {
    const filename = q.url.split('/').pop()?.toLowerCase();
    if (filename) {
      const hit = pool.find(x => x.url.toLowerCase().endsWith(filename) || x.filename?.toLowerCase() === filename);
      if (hit) return hit;
    }
  }

  const normQuote = cleanQuote(q.quote);
  const normTitle = normalizeText(q.title);
  const tagLower = (q.tag || '').toLowerCase();

  // 3. Space Tag + Timestamp match
  let spaceMatches: PreCutClip[] = [];
  if (tagLower) {
    spaceMatches = pool.filter(x =>
      x.space_tag &&
      (x.space_tag.toLowerCase().includes(tagLower) || tagLower.includes(x.space_tag.toLowerCase()))
    );
  }

  if (spaceMatches.length > 0 && q.startSec !== undefined && Number.isFinite(q.startSec)) {
    const near = spaceMatches.filter(x => {
      const sec = parseTimestampSec(x.timestamp);
      return sec !== null && Math.abs(sec - (q.startSec as number)) <= 30;
    });

    if (near.length === 1) return near[0];
    if (near.length > 1) {
      let best: PreCutClip | null = null;
      let maxScore = -1;
      for (const cand of near) {
        const cQuote = cleanQuote(cand.quote);
        const candSec = parseTimestampSec(cand.timestamp) || 0;
        const timeDiff = Math.abs(candSec - (q.startSec as number));
        let score = Math.max(0, 60 - timeDiff * 2);

        if (normQuote && cQuote) {
          if (normQuote === cQuote) {
            score += 400;
          } else if (normQuote.includes(cQuote)) {
            const cov = cQuote.length / normQuote.length;
            score += 250 + Math.round(cov * 100);
          } else if (cQuote.includes(normQuote)) {
            const prec = normQuote.length / cQuote.length;
            score += 150 + Math.round(prec * 100);
          }

          const queryWords = normQuote.split(' ').filter(w => w.length > 3 && !STOP_WORDS.has(w));
          const candWords = cQuote.split(' ').filter(w => w.length > 3 && !STOP_WORDS.has(w));
          const candSet = new Set(candWords);
          let shared = 0;
          for (const w of queryWords) {
            if (candSet.has(w)) shared++;
          }
          if (shared > 0 && queryWords.length > 0 && candWords.length > 0) {
            const precision = shared / candWords.length;
            const recall = shared / queryWords.length;
            score += Math.round(((2 * precision * recall) / (precision + recall)) * 100);
          }
        }

        if (score > maxScore) {
          maxScore = score;
          best = cand;
        }
      }
      if (best && maxScore > 0) return best;
      return near[0];
    }
  }

  // 4. Quote content match across the catalog
  if (normQuote && normQuote.length >= 10) {
    let best: PreCutClip | null = null;
    let maxScore = -1;

    for (const cand of pool) {
      const cQuote = cleanQuote(cand.quote);
      if (!cQuote || cQuote.length < 5) continue;
      let score = 0;
      let matchedContent = false;

      if (normQuote === cQuote) {
        score += 600;
        matchedContent = true;
      } else if (normQuote.includes(cQuote) && cQuote.length >= 15) {
        // Query contains candidate quote: prefer candidate that covers more of query
        const coverage = cQuote.length / normQuote.length;
        score += 400 + Math.round(coverage * 150);
        matchedContent = true;
      } else if (cQuote.includes(normQuote) && normQuote.length >= 15) {
        // Candidate contains query quote: penalize if candidate has too much extraneous text
        const precision = normQuote.length / cQuote.length;
        score += 300 + Math.round(precision * 150);
        matchedContent = true;
      } else {
        const queryWords = normQuote.split(' ').filter(w => w.length > 3 && !STOP_WORDS.has(w));
        const candWords = cQuote.split(' ').filter(w => w.length > 3 && !STOP_WORDS.has(w));
        const candSet = new Set(candWords);
        let shared = 0;
        for (const w of queryWords) {
          if (candSet.has(w)) shared++;
        }
        if (shared >= 3) {
          const overlapRatio = (2 * shared) / (queryWords.length + candWords.length);
          score += Math.round(overlapRatio * 200);
          matchedContent = true;
        }
      }

      if (matchedContent) {
        // Space match bonus only when content actually matches
        const spaceMatch = tagLower && cand.space_tag && (
          cand.space_tag.toLowerCase().includes(tagLower) ||
          tagLower.includes(cand.space_tag.toLowerCase())
        );
        if (spaceMatch) score += 200;

        if (score > maxScore) {
          maxScore = score;
          best = cand;
        }
      }
    }

    if (best && maxScore >= 50) return best;
  }

  // 5. Title match
  if (normTitle && normTitle.length >= 8) {
    const hit = pool.find(x => {
      const ct = normalizeText(x.title);
      return ct.includes(normTitle) || normTitle.includes(ct);
    });
    if (hit) return hit;
  }

  return null;
}

/**
 * Asynchronously fetch and index all pre-cut clips from public catalogs.
 */
export async function getOrFetchPreCutClips(): Promise<PreCutClip[]> {
  try {
    const res = await fetch('/clips/angela/manifest.json');
    if (res.ok) {
      const data: PreCutClip[] = await res.json();
      registerPreCutClips(data);
    }
  } catch {}
  return cachedPreCutClips;
}

function buildIndexes(summaries: EpisodeSummary[]) {
  cachedSummaries = summaries;
  tagIndex = new Map();
  sourceIdIndex = new Map();

  for (const ep of summaries) {
    if (ep.release_tag) {
      const tagLower = ep.release_tag.toLowerCase();
      tagIndex.set(tagLower, ep);

      // Extract raw Space ID after date prefix (e.g. "20260217_1vAxRvZrEPaxl" -> "1vaxrvzrepaxl")
      const parts = tagLower.split('_');
      if (parts.length >= 2) {
        const spaceId = parts.slice(1).join('_');
        if (spaceId) {
          sourceIdIndex.set(spaceId, ep);
        }
      }
    }
  }
}

/**
 * Prime the memory cache with an already fetched summary list.
 */
export function setCachedSummaryIndex(summaries: EpisodeSummary[]): void {
  if (Array.isArray(summaries) && summaries.length > 0) {
    buildIndexes(summaries);
  }
}

/**
 * Returns cached summaries or fetches them from the server/asset bundle.
 */
export async function getOrFetchSummaryIndex(): Promise<EpisodeSummary[]> {
  if (cachedSummaries && cachedSummaries.length > 0) {
    return cachedSummaries;
  }
  try {
    const list = await fetchSummaryIndex();
    buildIndexes(list);
    return list;
  } catch (err) {
    console.warn('[audioResolver] Failed to load summary index:', err);
    return [];
  }
}

/**
 * Extracts candidate episode tags or Space IDs from freeform text or markdown.
 */
export function extractEpisodeTag(text?: string | null): string | null {
  if (!text) return null;
  // Match standard release tags like 20260217_1vAxRvZrEPaxl or 20261109_1LPXAyrydVKWMy
  const fullTagMatch = text.match(/\b(20\d{6}_[a-zA-Z0-9_-]+)\b/);
  if (fullTagMatch) return fullTagMatch[1];

  // Match local upload tags like 20261111_local_1i69faszbw
  const localTagMatch = text.match(/\b(20\d{6}_local_[a-zA-Z0-9_-]+)\b/i);
  if (localTagMatch) return localTagMatch[1];

  // Match standalone local tags like local_1i69faszbw
  const rawLocalMatch = text.match(/\b(local_[a-zA-Z0-9_-]+)\b/i);
  if (rawLocalMatch) return rawLocalMatch[1];

  return null;
}

/**
 * Synchronous lookup against the in-memory cache.
 */
export function findEpisodeInCache(
  query?: string | number | null,
  overrideSummaries?: EpisodeSummary[]
): EpisodeSummary | undefined {
  if (!query) return undefined;
  const list = overrideSummaries || cachedSummaries;
  if (!list || list.length === 0) return undefined;

  const qStr = String(query).trim().toLowerCase();

  // Fast hash map lookups
  if (tagIndex.has(qStr)) return tagIndex.get(qStr);
  if (sourceIdIndex.has(qStr)) return sourceIdIndex.get(qStr);

  return findEpisodeInSummary(list, query);
}

export interface ResolveAudioOptions {
  tag?: string | number;
  title?: string;
  releaseId?: number;
  providedUrl?: string;
  textContext?: string;
}

export interface ResolvedAudioResult {
  audioUrl: string;
  title: string;
  episodeTag: string;
  releaseId?: number;
  durationSec?: number;
  isPreCut?: boolean;
}

/**
 * Resolves a reliable audio URL from provided metadata or text context.
 * Preferentially matches pre-cut master clips when available.
 */
export function resolveEpisodeAudioSync(
  opts: ResolveAudioOptions,
  overrideSummaries?: EpisodeSummary[],
  overridePreCuts?: PreCutClip[]
): ResolvedAudioResult | null {
  // Check if textContext or title matches a pre-cut clip first
  const preCut = findPreCutClipMatch({
    quote: opts.textContext || opts.title,
    title: opts.title,
    tag: opts.tag != null ? String(opts.tag) : undefined,
    url: opts.providedUrl,
  }, overridePreCuts);

  if (preCut) {
    const formattedUrl = preCut.url.startsWith('http') ? preCut.url : `/${preCut.url.replace(/^\/+/, '')}`;
    return {
      audioUrl: formattedUrl,
      title: preCut.title,
      episodeTag: preCut.space_tag || '',
      durationSec: preCut.duration,
      isPreCut: true,
    };
  }

  // If a valid, non-placeholder URL was provided, return it directly
  if (opts.providedUrl && !isPlaceholderAudioUrl(opts.providedUrl)) {
    return {
      audioUrl: opts.providedUrl,
      title: opts.title || '',
      episodeTag: opts.tag != null ? String(opts.tag) : '',
      releaseId: opts.releaseId,
    };
  }

  // Derive candidate tag from options or surrounding text context
  const tagStr = opts.tag != null ? String(opts.tag) : undefined;
  const candidateTag = tagStr || extractEpisodeTag(opts.textContext) || extractEpisodeTag(opts.title);
  const candidateQuery = candidateTag || opts.releaseId || opts.title;

  if (!candidateQuery) return null;

  const ep = findEpisodeInCache(candidateQuery, overrideSummaries);
  if (ep && ep.audio_url && !isPlaceholderAudioUrl(ep.audio_url)) {
    return {
      audioUrl: ep.audio_url,
      title: ep.title,
      episodeTag: ep.release_tag,
      releaseId: ep.release_id,
      durationSec: ep.duration_sec ?? undefined,
    };
  }

  return null;
}

/**
 * Asynchronously resolves a reliable audio URL, fetching the summary index and pre-cut catalogs if not yet loaded.
 */
export async function resolveEpisodeAudio(
  opts: ResolveAudioOptions
): Promise<ResolvedAudioResult | null> {
  const sync = resolveEpisodeAudioSync(opts);
  if (sync) return sync;

  await getOrFetchPreCutClips();
  const summaries = await getOrFetchSummaryIndex();
  return resolveEpisodeAudioSync(opts, summaries);
}

/**
 * Sanitizes a Montage clip item by:
 * 1. Preferentially upgrading to sample-accurate pre-cut master clips when quote or timestamps match.
 * 2. Ensuring placeholder or missing audio URLs are resolved to true GitHub Release audio assets from the episode catalog.
 */
export function sanitizeMontageClip<T extends {
  audioUrl?: string;
  sourceTag?: string;
  sourceTitle?: string;
  title?: string;
  quote?: string;
  startSec?: number;
  endSec?: number;
  sourceDurationSec?: number;
  windowVerified?: boolean;
  quoteId?: string;
  id?: string;
}>(clip: T, overrideSummaries?: EpisodeSummary[], overridePreCuts?: PreCutClip[]): T & {
  windowVerified?: boolean;
  sourceDurationSec?: number;
} {
  // 1. Try matching against pre-cut master clips
  const preCut = findPreCutClipMatch({
    quote: clip.quote,
    title: clip.title,
    tag: clip.sourceTag,
    startSec: clip.startSec,
    endSec: clip.endSec,
    quoteId: clip.quoteId,
    url: clip.audioUrl,
  }, overridePreCuts);

  if (preCut) {
    const formattedUrl = preCut.url.startsWith('http') ? preCut.url : `/${preCut.url.replace(/^\/+/, '')}`;
    return {
      ...clip,
      audioUrl: formattedUrl,
      startSec: 0,
      endSec: preCut.duration,
      sourceDurationSec: preCut.duration,
      windowVerified: true,
      sourceTitle: clip.sourceTitle || preCut.space_title || preCut.title,
      sourceTag: clip.sourceTag || preCut.space_tag,
    };
  }

  // 2. If clip audio is already a valid, non-placeholder URL, keep it
  if (clip.audioUrl && !isPlaceholderAudioUrl(clip.audioUrl)) {
    return clip;
  }

  // 3. Fallback: resolve placeholder from episode summary index
  const resolved = resolveEpisodeAudioSync(
    {
      tag: clip.sourceTag,
      title: clip.sourceTitle || clip.title,
      textContext: `${clip.title || ''} ${clip.quote || ''} ${clip.sourceTitle || ''} ${clip.sourceTag || ''}`,
    },
    overrideSummaries,
    overridePreCuts
  );

  if (resolved) {
    return {
      ...clip,
      audioUrl: resolved.audioUrl,
      sourceTitle: clip.sourceTitle || resolved.title,
      sourceTag: clip.sourceTag || resolved.episodeTag,
      sourceDurationSec: clip.sourceDurationSec || resolved.durationSec,
    };
  }

  return clip;
}
