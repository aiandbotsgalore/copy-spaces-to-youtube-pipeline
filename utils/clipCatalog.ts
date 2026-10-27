import type { LaneBand } from '../components/transcript/SpeakerLane';
import { ClipItem, parseClipCatalog } from './contracts/clipCatalog';

export type { ClipItem };
export type CatalogClip = ClipItem;

let cached: Promise<ClipItem[]> | null = null;

/** Loads the static clip catalog once per page load. Failures resolve to an empty list. */
export const loadClipCatalog = (): Promise<ClipItem[]> => {
  if (cached) return cached;
  const base = (import.meta.env.BASE_URL || '/') as string;
  const ts = Date.now();
  const candidates = [`./clips/clips_catalog.json?t=${ts}`, `/clips/clips_catalog.json?t=${ts}`, `${base}clips/clips_catalog.json?t=${ts}`.replace(/\/+/g, '/')];
  cached = (async () => {
    for (const url of candidates) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) continue;
        const data = await res.json();
        const parsed = parseClipCatalog(data);
        if (parsed.length > 0) {
          return parsed;
        }
      } catch {
        /* try next candidate */
      }
    }
    return [];
  })();
  return cached;
};

/** Clips belonging to one release; matched on the release tag appearing in the clip's file/download URL. */
export const clipBandsForRelease = (clips: ClipItem[], releaseTag: string | undefined, minScore = 7, maxLengthSec = Infinity): LaneBand[] => {
  if (!releaseTag) return [];
  return clips
    .filter(c => (c.viral_score >= minScore) && (c.end_seconds - c.start_seconds <= maxLengthSec) && ((c.file_path || '').includes(releaseTag) || (c.download_url || '').includes(releaseTag) || (c.episode || '').includes(releaseTag)))
    .map(c => ({ startSec: c.start_seconds, endSec: c.end_seconds, score: c.viral_score }));
};
