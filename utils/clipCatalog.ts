import type { LaneBand } from '../components/transcript/SpeakerLane';

export interface CatalogClip {
  title: string;
  category?: string;
  start_seconds: number;
  end_seconds: number;
  viral_score: number;
  file_path?: string;
  download_url?: string;
  episode?: string;
}

let cached: Promise<CatalogClip[]> | null = null;

/** Loads the static clip catalog once per page load. Failures resolve to an empty list. */
export const loadClipCatalog = (): Promise<CatalogClip[]> => {
  if (cached) return cached;
  const base = (import.meta.env.BASE_URL || '/') as string;
  const candidates = ['./clips/clips_catalog.json', '/clips/clips_catalog.json', `${base}clips/clips_catalog.json`.replace(/\/+/g, '/')];
  cached = (async () => {
    for (const url of candidates) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const data = await res.json();
        if (Array.isArray(data) && data.length) {
          return data
            .map((c: any) => ({
              ...c,
              start_seconds: Number(c.start_seconds),
              end_seconds: Number(c.end_seconds),
              viral_score: Number(c.viral_score) || 0,
            }))
            .filter((c: CatalogClip) => Number.isFinite(c.start_seconds) && Number.isFinite(c.end_seconds) && c.end_seconds > c.start_seconds);
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
export const clipBandsForRelease = (clips: CatalogClip[], releaseTag: string | undefined, minScore = 7, maxLengthSec = Infinity): LaneBand[] => {
  if (!releaseTag) return [];
  return clips
    .filter(c => (c.viral_score >= minScore) && (c.end_seconds - c.start_seconds <= maxLengthSec) && ((c.file_path || '').includes(releaseTag) || (c.download_url || '').includes(releaseTag) || (c.episode || '').includes(releaseTag)))
    .map(c => ({ startSec: c.start_seconds, endSec: c.end_seconds, score: c.viral_score }));
};
