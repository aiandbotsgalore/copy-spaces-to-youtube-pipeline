import type { LaneBand } from '../components/transcript/SpeakerLane';
import { ClipItem, parseClipCatalog } from './contracts/clipCatalog';
import { fetchJsonCandidates } from './safeFetch';

export type { ClipItem };
export type CatalogClip = ClipItem;

let cached: Promise<ClipItem[]> | null = null;

/** Loads the static clip catalog once per page load. Empty/HTML failures do not poison the cache. */
export const loadClipCatalog = (): Promise<ClipItem[]> => {
  if (cached) return cached;
  const base = (import.meta.env.BASE_URL || '/') as string;
  const ts = Date.now();
  const candidates = [
    `./clips/clips_catalog.json?t=${ts}`,
    `/clips/clips_catalog.json?t=${ts}`,
    `${base}clips/clips_catalog.json?t=${ts}`.replace(/\/+/g, '/'),
  ];
  const pending = (async () => {
    const hit = await fetchJsonCandidates<any>(candidates, {
      cache: 'no-store',
      validate: d => Array.isArray(d) && d.length > 0,
    });
    if (!hit) {
      cached = null;
      return [];
    }
    const parsed = parseClipCatalog(hit.data);
    if (parsed.length === 0) {
      cached = null;
    }
    return parsed;
  })();
  cached = pending;
  return pending;
};

/** Clips belonging to one release; matched on the release tag appearing in the clip's file/download URL. */
export const clipBandsForRelease = (clips: ClipItem[], releaseTag: string | undefined, minScore = 7, maxLengthSec = Infinity): LaneBand[] => {
  if (!releaseTag) return [];
  return clips
    .filter(c => (c.viral_score >= minScore) && (c.end_seconds - c.start_seconds <= maxLengthSec) && ((c.file_path || '').includes(releaseTag) || (c.download_url || '').includes(releaseTag) || (c.episode || '').includes(releaseTag)))
    .map(c => ({ startSec: c.start_seconds, endSec: c.end_seconds, score: c.viral_score }));
};
