import { useQuery } from '@tanstack/react-query';
import { ClipItem } from '../utils/contracts/clipCatalog';
import { normalizeViralScore, normalizeClipSpeakers } from '../utils/clipScore';
import { normalizeCategory } from '../components/clips/clipUtils';
import { fetchJsonCandidates } from '../utils/safeFetch';

export function buildClipsCatalogCandidates(owner?: string, repo?: string): string[] {
  const ts = Date.now();
  const baseUrl = (import.meta as any).env?.BASE_URL || '/';
  const candidates = [
    `./clips/clips_catalog.json?t=${ts}`,
    `/clips/clips_catalog.json?t=${ts}`,
    `${baseUrl}clips/clips_catalog.json?t=${ts}`.replace(/\/+/g, '/'),
  ];
  const cleanOwner = (owner || '').trim();
  const cleanRepo = (repo || '').trim();
  if (cleanOwner && cleanRepo) {
    candidates.push(
      `https://raw.githubusercontent.com/${cleanOwner}/${cleanRepo}/master/public/clips/clips_catalog.json?t=${ts}`
    );
  }
  return candidates;
}

export function normalizeClipCatalogItems(data: any[]): ClipItem[] {
  return data.map((c: any) => ({
    ...c,
    viral_score: normalizeViralScore(c.viral_score),
    speakers: normalizeClipSpeakers(c.speakers),
    category: normalizeCategory(c.category),
  }));
}

/**
 * High-performance TanStack Query hook for fetching and caching the clips catalog.
 * Automatically deduplicates across panels, validates JSON content-types to avoid
 * HTML fallback crashes, and caches results for 5 minutes.
 */
export function useClipsCatalog(owner?: string, repo?: string) {
  return useQuery<ClipItem[]>({
    queryKey: ['clips_catalog', (owner || '').trim(), (repo || '').trim()],
    queryFn: async ({ signal }) => {
      const candidates = buildClipsCatalogCandidates(owner, repo);
      const hit = await fetchJsonCandidates<any[]>(candidates, {
        cache: 'no-store',
        signal,
        validate: (d) => Array.isArray(d) && d.length > 0,
      });
      if (!hit) return [];
      return normalizeClipCatalogItems(hit.data);
    },
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
  });
}
