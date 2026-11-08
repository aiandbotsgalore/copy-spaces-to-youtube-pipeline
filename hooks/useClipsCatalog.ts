import { useQuery } from '@tanstack/react-query';
import { ClipItem } from '../utils/contracts/clipCatalog';
import { normalizeViralScore, normalizeClipSpeakers } from '../utils/clipScore';
import { normalizeCategory } from '../components/clips/clipUtils';

/**
 * High-performance TanStack Query hook for fetching and caching the clips catalog.
 * Automatically deduplicates across panels, provides 5-minute memory caching,
 * and eliminates manual useEffect/fetch boilerplate.
 */
export function useClipsCatalog() {
  return useQuery<ClipItem[]>({
    queryKey: ['clips_catalog'],
    queryFn: async () => {
      const ts = Date.now();
      const candidates = [
        `./clips/clips_catalog.json?t=${ts}`,
        `/clips/clips_catalog.json?t=${ts}`,
        `${(import.meta as any).env?.BASE_URL || '/'}clips/clips_catalog.json?t=${ts}`.replace(/\/+/g, '/'),
      ];

      for (const catUrl of candidates) {
        try {
          const res = await fetch(catUrl, { cache: 'no-store' });
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
              return data.map((c: any) => ({
                ...c,
                viral_score: normalizeViralScore(c.viral_score),
                speakers: normalizeClipSpeakers(c.speakers),
                category: normalizeCategory(c.category),
              }));
            }
          }
        } catch {
          // try next path candidate
        }
      }
      return [];
    },
    staleTime: 1000 * 60 * 5, // 5 minutes fresh
    gcTime: 1000 * 60 * 30, // 30 minutes in garbage collector cache
  });
}
