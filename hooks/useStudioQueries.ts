import { useQuery } from '@tanstack/react-query';
import { EnhancedConfig, Release } from '../types';
import { getReleases } from '../utils/github';
import { fetchJsonCandidates } from '../utils/safeFetch';
import { sortReleasesByRecordedDate } from '../utils/dates';

export function useReleasesQuery(config: EnhancedConfig) {
  const owner = (config.ownerName || '').trim();
  const repo = (config.repoName || '').trim();
  const token = (config.githubToken || '').trim();
  const enabled = !!(owner && repo);

  return useQuery<Release[]>({
    queryKey: ['releases', owner, repo, Boolean(token)],
    enabled,
    queryFn: async () => {
      const data = await getReleases(token, owner, repo);
      return sortReleasesByRecordedDate(data, 'desc');
    },
    staleTime: 1000 * 60 * 3,
    gcTime: 1000 * 60 * 30,
  });
}

export function useVoiceProfilesQuery(owner?: string, repo?: string) {
  const cleanOwner = (owner || '').trim();
  const cleanRepo = (repo || '').trim();
  return useQuery<any>({
    queryKey: ['voice_profiles', cleanOwner, cleanRepo],
    queryFn: async ({ signal }) => {
      const candidates = [
        '/voice_profiles.json',
        './voice_profiles.json',
        ...(cleanOwner && cleanRepo
          ? [`https://raw.githubusercontent.com/${cleanOwner}/${cleanRepo}/master/public/voice_profiles.json`]
          : []),
      ];
      const hit = await fetchJsonCandidates<any>(candidates, {
        signal,
        validate: d => Boolean(d && (d.profiles || Array.isArray(d))),
      });
      return hit?.data ?? null;
    },
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
  });
}

export function useSummaryIndexQuery(owner?: string, repo?: string) {
  const cleanOwner = (owner || '').trim();
  const cleanRepo = (repo || '').trim();
  return useQuery<any[]>({
    queryKey: ['transcripts_summary_index', cleanOwner, cleanRepo],
    queryFn: async ({ signal }) => {
      const candidates = [
        './transcripts/transcripts_summary_index.json',
        '/transcripts/transcripts_summary_index.json',
        ...(cleanOwner && cleanRepo
          ? [`https://raw.githubusercontent.com/${cleanOwner}/${cleanRepo}/master/public/transcripts/transcripts_summary_index.json`]
          : []),
      ];
      const hit = await fetchJsonCandidates<any[]>(candidates, {
        signal,
        validate: d => Array.isArray(d),
      });
      return hit?.data ?? [];
    },
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
  });
}
