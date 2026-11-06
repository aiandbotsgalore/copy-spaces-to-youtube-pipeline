import { useState, useCallback, useEffect, useRef } from 'react';
import { Release, ReleaseAsset, EnhancedConfig } from '../../types';
import { getReleases, fetchReleaseAssetText, getReleaseParts } from '../../utils/github';
import { sortReleasesByRecordedDate } from '../../utils/dates';
import { parseEpisodeSummaries } from '../../utils/contracts/transcript';
import {
  SearchWorkerClient,
  extractSpeakerPrefix,
} from '../../utils/searchWorker';

export interface SearchIndexSegment {
  start: number;
  end: number | null;
  speaker: string;
  text: string;
  _search?: string;
  relevanceScore?: number;
  matchType?: string;
  relevantSpans?: Array<{ start: number; end: number; score: number; text?: string }>;
}

export type SearchEngineMode = 'hybrid' | 'rerank' | 'lexical' | 'vector';

export interface SearchIndexEpisode {
  release_id: number;
  release_tag: string;
  title: string;
  published_at: string;
  audio_url: string;
  segment_count: number;
  segments: SearchIndexSegment[];
}

export interface EpisodeSummary {
  release_id: number;
  release_tag: string;
  title: string;
  published_at: string;
  episode_date?: string | null;
  audio_url: string;
  segment_count: number;
  body?: string;
  speakers?: string[];
  host_handle?: string | null;
}

export interface GlobalSearchResult {
  release_id: number;
  release_tag: string;
  title: string;
  published_at: string;
  audio_url: string;
  segment: SearchIndexSegment;
  segmentIndex: number;
}

export interface SavedSpeaker {
  id: string;
  name: string;
  avatarEmoji?: string;
  avatarUrl?: string;
  color?: string;
  role?: string;
}

export const SPEAKER_COLOR_MAP: Record<string, { bg: string; text: string; border: string; badge: string; dot: string; avatar: string }> = {
  emerald: { bg: 'bg-emerald-950/20', text: 'text-emerald-400', border: 'border-emerald-800/40', badge: 'bg-emerald-900/40 text-emerald-300', dot: 'bg-emerald-400', avatar: 'bg-emerald-950 text-emerald-400 border-emerald-800' },
  cyan: { bg: 'bg-cyan-950/20', text: 'text-cyan-400', border: 'border-cyan-800/40', badge: 'bg-cyan-900/40 text-cyan-300', dot: 'bg-cyan-400', avatar: 'bg-cyan-950 text-cyan-400 border-cyan-800' },
  indigo: { bg: 'bg-indigo-950/20', text: 'text-indigo-400', border: 'border-indigo-800/40', badge: 'bg-indigo-900/40 text-indigo-300', dot: 'bg-indigo-400', avatar: 'bg-indigo-950 text-indigo-400 border-indigo-800' },
  amber: { bg: 'bg-amber-950/20', text: 'text-amber-400', border: 'border-amber-800/40', badge: 'bg-amber-900/40 text-amber-300', dot: 'bg-amber-400', avatar: 'bg-amber-950 text-amber-400 border-amber-800' },
  purple: { bg: 'bg-purple-950/20', text: 'text-purple-400', border: 'border-purple-800/40', badge: 'bg-purple-900/40 text-purple-300', dot: 'bg-purple-400', avatar: 'bg-purple-950 text-purple-400 border-purple-800' },
  rose: { bg: 'bg-rose-950/20', text: 'text-rose-400', border: 'border-rose-800/40', badge: 'bg-rose-900/40 text-rose-300', dot: 'bg-rose-400', avatar: 'bg-rose-950 text-rose-400 border-rose-800' },
  teal: { bg: 'bg-teal-950/20', text: 'text-teal-400', border: 'border-teal-800/40', badge: 'bg-teal-900/40 text-teal-300', dot: 'bg-teal-400', avatar: 'bg-teal-950 text-teal-400 border-teal-800' },
  orange: { bg: 'bg-orange-950/20', text: 'text-orange-400', border: 'border-orange-800/40', badge: 'bg-orange-900/40 text-orange-300', dot: 'bg-orange-400', avatar: 'bg-orange-950 text-orange-400 border-orange-800' },
  sky: { bg: 'bg-sky-950/20', text: 'text-sky-400', border: 'border-sky-800/40', badge: 'bg-sky-900/40 text-sky-300', dot: 'bg-sky-400', avatar: 'bg-sky-950 text-sky-400 border-sky-800' },
  yellow: { bg: 'bg-yellow-950/20', text: 'text-yellow-400', border: 'border-yellow-800/40', badge: 'bg-yellow-900/40 text-yellow-300', dot: 'bg-yellow-400', avatar: 'bg-yellow-950 text-yellow-400 border-yellow-800' },
  pink: { bg: 'bg-pink-950/20', text: 'text-pink-400', border: 'border-pink-800/40', badge: 'bg-pink-900/40 text-pink-300', dot: 'bg-pink-400', avatar: 'bg-pink-950 text-pink-400 border-pink-800' },
  lime: { bg: 'bg-lime-950/20', text: 'text-lime-400', border: 'border-lime-800/40', badge: 'bg-lime-900/40 text-lime-300', dot: 'bg-lime-400', avatar: 'bg-lime-950 text-lime-400 border-lime-800' },
};

export const DEFAULT_SAVED_SPEAKERS: SavedSpeaker[] = [
  { id: 'logan', name: 'Logan', avatarEmoji: '🎙️', color: 'indigo', role: 'Host' },
  { id: 'angela-maggard', name: 'Angela Maggard', avatarEmoji: '🌹', color: 'rose', role: 'Speaker' },
  { id: 'danielle', name: 'Danielle', avatarEmoji: '⚡', color: 'cyan', role: 'Speaker' },
  { id: 'brian', name: 'Brian', avatarEmoji: '🧠', color: 'emerald', role: 'Speaker' },
  { id: 'sully', name: 'Sully', avatarEmoji: '🎧', color: 'amber', role: 'Speaker' },
  { id: 'tony', name: 'Tony', avatarEmoji: '👁️', color: 'purple', role: 'Speaker' },
  { id: 'david-grusch', name: 'David Grusch', avatarEmoji: '🛸', color: 'sky', role: 'Subject / Whistleblower' },
  { id: 'ross-coulthart', name: 'Ross Coulthart', avatarEmoji: '📻', color: 'teal', role: 'Journalist' },
];

export const DYNAMIC_COLOR_ORDER = [
  'rose',
  'cyan',
  'amber',
  'emerald',
  'purple',
  'teal',
  'orange',
  'sky',
  'yellow',
  'pink',
  'lime',
];

export const DIVERSE_EMOJIS = ['⚡', '🌹', '🧠', '👁️', '💫', '🎧', '⚙️', '🛸', '✨', '🔥', '⭐', '💎', '🚀', '🎯', '💡', '🌈', '🦁', '🐺', '🦊', '🐻', '🦉'];

export function getAutoSpeakerColor(name: string): string {
  if (name.toLowerCase() === 'logan') return 'indigo';
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i);
    hash |= 0;
  }
  return DYNAMIC_COLOR_ORDER[Math.abs(hash) % DYNAMIC_COLOR_ORDER.length];
}

export function getAutoSpeakerEmoji(name: string): string {
  if (name.toLowerCase() === 'logan') return '🎙️';
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i);
    hash |= 0;
  }
  return DIVERSE_EMOJIS[Math.abs(hash) % DIVERSE_EMOJIS.length];
}

const MAX_CACHED_EPISODES = 10;
export const EPISODE_SEGMENTS_CACHE = new Map<string, SearchIndexSegment[]>();

export async function fetchSummaryIndex(owner?: string, repo?: string): Promise<EpisodeSummary[]> {
  const base = (((import.meta as any).env?.BASE_URL as string) || '/').replace(/\/$/, '');
  const pathBase = typeof window !== 'undefined' ? window.location.pathname.replace(/\/[^/]*$/, '') : '';
  const urls = [
    `${base}/transcripts/transcripts_summary_index.json`,
    '/transcripts/transcripts_summary_index.json',
    './transcripts/transcripts_summary_index.json',
    pathBase ? `${pathBase}/transcripts/transcripts_summary_index.json` : '',
    (owner && repo) ? `https://raw.githubusercontent.com/${owner}/${repo}/master/public/transcripts/transcripts_summary_index.json` : '',
  ].filter(Boolean);

  let lastErr: unknown = null;
  for (const url of Array.from(new Set(urls))) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('text/html')) {
          continue;
        }
        const json = await res.json();
        return parseEpisodeSummaries(json);
      }
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Failed to load transcripts summary index');
}

export async function fetchSingleEpisodeTranscript(releaseTag: string, owner?: string, repo?: string): Promise<string | null> {
  const base = (((import.meta as any).env?.BASE_URL as string) || '/').replace(/\/$/, '');
  const pathBase = typeof window !== 'undefined' ? window.location.pathname.replace(/\/[^/]*$/, '') : '';
  const urls = [
    `${base}/transcripts/episodes/${releaseTag}.json`,
    `/transcripts/episodes/${releaseTag}.json`,
    `./transcripts/episodes/${releaseTag}.json`,
    pathBase ? `${pathBase}/transcripts/episodes/${releaseTag}.json` : '',
    (owner && repo) ? `https://raw.githubusercontent.com/${owner}/${repo}/master/public/transcripts/episodes/${releaseTag}.json` : '',
  ].filter(Boolean);

  for (const url of Array.from(new Set(urls))) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('text/html')) {
          return await res.text();
        }
      }
    } catch {
      // Continue to next candidate
    }
  }
  return null;
}

export async function getEpisodeSegments(releaseTag: string, owner?: string, repo?: string): Promise<SearchIndexSegment[]> {
  if (EPISODE_SEGMENTS_CACHE.has(releaseTag)) {
    const hit = EPISODE_SEGMENTS_CACHE.get(releaseTag)!;
    EPISODE_SEGMENTS_CACHE.delete(releaseTag);
    EPISODE_SEGMENTS_CACHE.set(releaseTag, hit);
    return hit;
  }
  const text = await fetchSingleEpisodeTranscript(releaseTag, owner, repo);
  if (!text) return [];
  try {
    const data = JSON.parse(text);
    const segs: SearchIndexSegment[] = Array.isArray(data) ? data : (Array.isArray(data?.segments) ? data.segments : []);
    if (EPISODE_SEGMENTS_CACHE.size >= MAX_CACHED_EPISODES) {
      const oldestKey = EPISODE_SEGMENTS_CACHE.keys().next().value;
      if (oldestKey) EPISODE_SEGMENTS_CACHE.delete(oldestKey);
    }
    EPISODE_SEGMENTS_CACHE.set(releaseTag, segs);
    return segs;
  } catch {
    return [];
  }
}

export async function fetchSearchIndex(owner?: string, repo?: string): Promise<SearchIndexEpisode[]> {
  const summaries = await fetchSummaryIndex(owner, repo);
  return summaries.map(ep => ({
    release_id: ep.release_id,
    release_tag: ep.release_tag,
    title: ep.title,
    published_at: ep.published_at,
    audio_url: ep.audio_url,
    segment_count: ep.segment_count,
    segments: EPISODE_SEGMENTS_CACHE.get(ep.release_tag) || [],
  }));
}

export interface UseTranscriptSessionOptions {
  config: EnhancedConfig;
  initialReleaseId?: number | string | null;
  owner: string;
  repo: string;
  hasCredentials: boolean;
  pickTranscriptAsset: (release: Release, partNum?: number) => ReleaseAsset | undefined;
}

export function useTranscriptSession({
  config,
  initialReleaseId,
  owner,
  repo,
  hasCredentials,
  pickTranscriptAsset,
}: UseTranscriptSessionOptions) {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(typeof initialReleaseId === 'number' ? initialReleaseId : null);
  const [selectedPartNum, setSelectedPartNum] = useState<number>(1);
  const [transcriptRaw, setTranscriptRaw] = useState('');
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState('');

  const [globalIndex, setGlobalIndex] = useState<SearchIndexEpisode[] | null>(null);
  const [globalIndexLoading, setGlobalIndexLoading] = useState(false);
  const [globalIndexError, setGlobalIndexError] = useState('');
  const [summaryIndex, setSummaryIndex] = useState<EpisodeSummary[] | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const searchWorkerRef = useRef<SearchWorkerClient | null>(null);
  const [workerSearchResults, setWorkerSearchResults] = useState<GlobalSearchResult[] | null>(null);
  const [workerSearching, setWorkerSearching] = useState(false);
  const [searchEngineMode, setSearchEngineMode] = useState<SearchEngineMode>('hybrid');
  const [serverSearchResults, setServerSearchResults] = useState<GlobalSearchResult[] | null>(null);
  const [serverSearching, setServerSearching] = useState<boolean>(false);
  const [searchFallbackNotice, setSearchFallbackNotice] = useState<string | null>(null);

  const [timeOffsetSec, setTimeOffsetSec] = useState<number>(0);
  const [audioSeekOffsetSec, setAudioSeekOffsetSec] = useState<number>(0);
  const [speakerMap, setSpeakerMap] = useState<Record<string, string>>({});

  const [savedSpeakers, setSavedSpeakers] = useState<SavedSpeaker[]>(() => {
    try {
      const stored = localStorage.getItem('spacepipe_saved_speakers');
      if (stored) {
        const parsed: SavedSpeaker[] = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const defaultMap = new Map(DEFAULT_SAVED_SPEAKERS.map(s => [s.name.toLowerCase(), s]));
          const upgraded: SavedSpeaker[] = parsed.map(s => {
            const cleanName = s.name.trim();
            const def = defaultMap.get(cleanName.toLowerCase());
            if (def) {
              return {
                ...s,
                color: def.color,
                avatarEmoji: def.avatarEmoji || s.avatarEmoji,
                role: def.role || s.role,
              };
            }
            if ((s.color === 'indigo' || !s.color || !SPEAKER_COLOR_MAP[s.color]) && cleanName.toLowerCase() !== 'logan') {
              return {
                ...s,
                color: getAutoSpeakerColor(cleanName),
                avatarEmoji: (s.avatarEmoji === '🎙️' || !s.avatarEmoji) ? getAutoSpeakerEmoji(cleanName) : s.avatarEmoji,
              };
            }
            return s;
          });
          const existingNames = new Set(upgraded.map(s => s.name.toLowerCase()));
          const missingDefaults = DEFAULT_SAVED_SPEAKERS.filter(s => !existingNames.has(s.name.toLowerCase()));
          const fullList = [...upgraded, ...missingDefaults];
          try { localStorage.setItem('spacepipe_saved_speakers', JSON.stringify(fullList)); } catch {}
          return fullList;
        }
      }
    } catch {}
    try { localStorage.setItem('spacepipe_saved_speakers', JSON.stringify(DEFAULT_SAVED_SPEAKERS)); } catch {}
    return DEFAULT_SAVED_SPEAKERS;
  });

  // Sync enrolled profiles and avatars from /voice_profiles.json
  useEffect(() => {
    const base = (((import.meta as any).env?.BASE_URL as string) || '/').replace(/\/$/, '');
    const pathBase = typeof window !== 'undefined' ? window.location.pathname.replace(/\/[^/]*$/, '') : '';
    const urls = [
      `${base}/voice_profiles.json`,
      './voice_profiles.json',
      '/voice_profiles.json',
      pathBase ? `${pathBase}/voice_profiles.json` : '',
    ].filter(Boolean);

    const loadProfiles = async () => {
      for (const u of Array.from(new Set(urls))) {
        try {
          const res = await fetch(u);
          if (res.ok) {
            const data = await res.json();
            if (data?.profiles) return data;
          }
        } catch {}
      }
      return null;
    };

    loadProfiles()
      .then(data => {
        if (!data || !data.profiles) return;
        setSavedSpeakers(prev => {
          const map = new Map(prev.map((s, idx) => [s.name.toLowerCase(), idx]));
          const next = [...prev];
          let changed = false;
          for (const [pName, pData] of Object.entries<any>(data.profiles)) {
            const clean = pName.trim();
            const lower = clean.toLowerCase();
            const avatarUrl = pData.avatar_url;
            if (map.has(lower)) {
              const idx = map.get(lower)!;
              if (avatarUrl && next[idx].avatarUrl !== avatarUrl) {
                next[idx] = { ...next[idx], avatarUrl };
                changed = true;
              }
            } else {
              next.push({
                id: lower.replace(/\s+/g, '-'),
                name: clean,
                avatarUrl,
                avatarEmoji: getAutoSpeakerEmoji(clean),
                color: getAutoSpeakerColor(clean),
                role: 'Speaker',
              });
              changed = true;
            }
          }
          if (changed) {
            try { localStorage.setItem('spacepipe_saved_speakers', JSON.stringify(next)); } catch {}
            return next;
          }
          return prev;
        });
      })
      .catch(() => {});
  }, []);

  const selectedRelease = releases.find(r => r.id === selectedId) || null;

  const fetchReleases = useCallback(async () => {
    if (!hasCredentials) return;
    setLoading(true);
    setError('');
    try {
      const data = await getReleases(config.githubToken, owner, repo);
      setReleases(sortReleasesByRecordedDate(data));
      setLoaded(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [config.githubToken, owner, repo, hasCredentials]);

  useEffect(() => {
    if (hasCredentials && !loaded && !loading) fetchReleases();
  }, [hasCredentials, loaded, loading, fetchReleases]);

  const loadGlobalIndex = useCallback(async () => {
    if (globalIndex || globalIndexLoading) return;
    setGlobalIndexLoading(true);
    setGlobalIndexError('');
    try {
      const data = await fetchSearchIndex(owner, repo);
      setGlobalIndex(data);
    } catch (e) {
      setGlobalIndexError((e as Error).message);
    } finally {
      setGlobalIndexLoading(false);
    }
  }, [globalIndex, globalIndexLoading, owner, repo]);

  const loadSegmentsForEpisodes = useCallback(async (tags: string[]) => {
    const limitedTags = tags.slice(0, 5);
    const needed = limitedTags.filter(tag => !EPISODE_SEGMENTS_CACHE.has(tag));
    if (needed.length > 0) {
      setGlobalIndexLoading(true);
      try {
        for (const tag of needed) {
          await getEpisodeSegments(tag, owner, repo);
        }
      } finally {
        setGlobalIndexLoading(false);
      }
    }
    setGlobalIndex(prev => {
      if (!prev) return prev;
      return prev.map(ep => {
        if (limitedTags.includes(ep.release_tag) && (!ep.segments || ep.segments.length === 0)) {
          return { ...ep, segments: EPISODE_SEGMENTS_CACHE.get(ep.release_tag) || [] };
        }
        return ep;
      });
    });
  }, [owner, repo]);

  const loadSummaryIndex = useCallback(async () => {
    if (summaryIndex || summaryLoading) return;
    setSummaryLoading(true);
    try {
      const data = await fetchSummaryIndex(owner, repo);
      setSummaryIndex(data);
    } catch (e) {
      console.warn('Failed to load summary index, will fallback to global index if needed:', e);
      if (!releases.length) {
        loadGlobalIndex();
      }
    } finally {
      setSummaryLoading(false);
    }
  }, [summaryIndex, summaryLoading, owner, repo, releases.length, loadGlobalIndex]);

  useEffect(() => {
    loadSummaryIndex();
  }, [loadSummaryIndex]);

  // Initialize background Search Worker
  useEffect(() => {
    searchWorkerRef.current = new SearchWorkerClient();
    return () => {
      searchWorkerRef.current?.terminate();
      searchWorkerRef.current = null;
    };
  }, []);

  // Ship loaded globalIndex to Web Worker
  useEffect(() => {
    if (globalIndex && searchWorkerRef.current) {
      searchWorkerRef.current.index(globalIndex);
    }
  }, [globalIndex]);

  // Load speaker renames for selected release
  useEffect(() => {
    if (selectedId) {
      try {
        const primary = localStorage.getItem(`spk_names_${selectedId}`);
        const secondary = selectedRelease?.tag_name ? localStorage.getItem(`spk_names_${selectedRelease.tag_name}`) : null;
        const saved = primary || secondary;
        setSpeakerMap(saved ? JSON.parse(saved) : {});
      } catch { setSpeakerMap({}); }
    }
  }, [selectedId, selectedRelease?.tag_name]);

  const saveSpeakerRename = (rawSpeaker: string, newName: string) => {
    const trimmed = newName.trim();
    if (!selectedId) return;
    setSpeakerMap(prev => {
      const next = { ...prev };
      if (trimmed && trimmed !== rawSpeaker) { next[rawSpeaker] = trimmed; } else { delete next[rawSpeaker]; }
      try {
        localStorage.setItem(`spk_names_${selectedId}`, JSON.stringify(next));
        if (selectedRelease?.tag_name) {
          localStorage.setItem(`spk_names_${selectedRelease.tag_name}`, JSON.stringify(next));
        }
      } catch {}
      return next;
    });
  };

  const resetAllSpeakerNames = () => {
    if (!selectedId) return;
    setSpeakerMap({});
    try {
      localStorage.removeItem(`spk_names_${selectedId}`);
      if (selectedRelease?.tag_name) {
        localStorage.removeItem(`spk_names_${selectedRelease.tag_name}`);
      }
    } catch {}
  };

  const setAndSaveTimeOffset = (offset: number | ((prev: number) => number)) => {
    setTimeOffsetSec(prev => {
      const next = typeof offset === 'function' ? offset(prev) : offset;
      if (selectedId) {
        try {
          if (next === 0) {
            localStorage.removeItem(`spk_offset_${selectedId}`);
            if (selectedRelease?.tag_name) localStorage.removeItem(`spk_offset_${selectedRelease.tag_name}`);
          } else {
            localStorage.setItem(`spk_offset_${selectedId}`, next.toString());
            if (selectedRelease?.tag_name) localStorage.setItem(`spk_offset_${selectedRelease.tag_name}`, next.toString());
          }
        } catch {}
      }
      return next;
    });
  };

  const handleSetAudioSeekOffset = (offset: number | ((prev: number) => number)) => {
    setAudioSeekOffsetSec(prev => {
      const next = typeof offset === 'function' ? offset(prev) : offset;
      const rounded = Math.round(next * 10) / 10;
      if (selectedId) {
        try {
          if (rounded === 0) {
            localStorage.removeItem(`spk_seek_offset_${selectedId}`);
            if (selectedRelease?.tag_name) localStorage.removeItem(`spk_seek_offset_${selectedRelease.tag_name}`);
          } else {
            localStorage.setItem(`spk_seek_offset_${selectedId}`, rounded.toString());
            if (selectedRelease?.tag_name) localStorage.setItem(`spk_seek_offset_${selectedRelease.tag_name}`, rounded.toString());
          }
        } catch {}
      }
      return rounded;
    });
  };

  const loadTranscript = useCallback(async (release: Release, targetAsset?: ReleaseAsset | null, partNum?: number) => {
    const pNum = typeof partNum === 'number' ? partNum : 1;
    setSelectedPartNum(pNum);
    const parts = getReleaseParts(release);
    const partObj = parts.find(p => p.partNumber === pNum) || parts[0];
    const asset = targetAsset !== undefined ? (targetAsset ?? undefined) : (partObj?.transcriptAsset || pickTranscriptAsset(release, pNum));

    setSelectedId(release.id);
    try {
      const savedOffset = localStorage.getItem(`spk_offset_${release.id}_p${pNum}`) || localStorage.getItem(`spk_offset_${release.id}`);
      setTimeOffsetSec(savedOffset ? parseFloat(savedOffset) : 0);
    } catch { setTimeOffsetSec(0); }
    try {
      const savedSeekOffset = localStorage.getItem(`spk_seek_offset_${release.id}_p${pNum}`)
        || localStorage.getItem(`spk_seek_offset_${release.id}`)
        || (release.tag_name ? localStorage.getItem(`spk_seek_offset_${release.tag_name}`) : null);
      if (savedSeekOffset !== null) {
        setAudioSeekOffsetSec(parseFloat(savedSeekOffset));
      } else if (release.tag_name?.includes('20260918_1AxRnZMeZNYxl') || release.name?.includes('Angela_Maggard_fan_club')) {
        setAudioSeekOffsetSec(15);
      } else {
        setAudioSeekOffsetSec(0);
      }
    } catch { setAudioSeekOffsetSec(0); }

    if (!asset) {
      setTranscriptLoading(true);
      setTranscriptError('');
      setTranscriptRaw('');
      try {
        const singleText = await fetchSingleEpisodeTranscript(release.tag_name, owner, repo);
        if (singleText) {
          const parsed = JSON.parse(singleText);
          const segs = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.segments) ? parsed.segments : []);
          if (segs && segs.length > 0) {
            setTranscriptRaw(JSON.stringify({ segments: segs }));
            setTranscriptError('');
            setTranscriptLoading(false);
            return;
          }
        }
      } catch { /* proceed to indexSource */ }

      let indexSource = globalIndex;
      if (!indexSource) {
        try {
          const data = await fetchSearchIndex(owner, repo);
          setGlobalIndex(data);
          indexSource = data;
        } catch { /* ignore fallback load error */ }
      }
      const indexed = indexSource?.find(ep => ep.release_id === release.id || ep.release_tag === release.tag_name);
      if (indexed && indexed.segments && indexed.segments.length > 0) {
        setTranscriptRaw(JSON.stringify({ segments: indexed.segments }));
        setTranscriptError('');
      } else {
        setTranscriptRaw('');
        setTranscriptError('');
      }
      setTranscriptLoading(false);
      return;
    }

    setTranscriptLoading(true);
    setTranscriptError('');
    setTranscriptRaw('');

    if (!targetAsset) {
      try {
        const singleText = await fetchSingleEpisodeTranscript(release.tag_name, owner, repo);
        if (singleText) {
          const parsed = JSON.parse(singleText);
          const segs = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.segments) ? parsed.segments : []);
          if (segs && segs.length > 0) {
            setTranscriptRaw(JSON.stringify({ segments: segs }));
            setTranscriptError('');
            setTranscriptLoading(false);
            return;
          }
        }
      } catch { /* proceed to download release asset */ }
    }

    try {
      const text = await fetchReleaseAssetText(
        config.githubToken, asset, owner, repo, release.tag_name
      );
      setTranscriptRaw(text);
    } catch (e) {
      try {
        const singleText = await fetchSingleEpisodeTranscript(release.tag_name, owner, repo);
        if (singleText) {
          const parsed = JSON.parse(singleText);
          const segs = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.segments) ? parsed.segments : []);
          if (segs && segs.length > 0) {
            setTranscriptRaw(JSON.stringify({ segments: segs }));
            setTranscriptError('');
            return;
          }
        }
      } catch { /* proceed to globalIndex fallback */ }

      let indexSource = globalIndex;
      if (!indexSource) {
        try {
          const data = await fetchSearchIndex(owner, repo);
          setGlobalIndex(data);
          indexSource = data;
        } catch { /* ignore fallback load error */ }
      }
      const indexed = indexSource?.find(ep => ep.release_id === release.id || ep.release_tag === release.tag_name);
      if (indexed && indexed.segments && indexed.segments.length > 0) {
        setTranscriptRaw(JSON.stringify({ segments: indexed.segments }));
        setTranscriptError('');
      } else {
        setTranscriptError((e as Error).message);
      }
    } finally {
      setTranscriptLoading(false);
    }
  }, [config.githubToken, owner, repo, pickTranscriptAsset, globalIndex]);

  return {
    releases,
    setReleases,
    loading,
    setLoading,
    error,
    setError,
    loaded,
    setLoaded,
    selectedId,
    setSelectedId,
    selectedPartNum,
    setSelectedPartNum,
    selectedRelease,
    fetchReleases,
    transcriptRaw,
    setTranscriptRaw,
    transcriptLoading,
    setTranscriptLoading,
    transcriptError,
    setTranscriptError,
    loadTranscript,
    globalIndex,
    setGlobalIndex,
    globalIndexLoading,
    setGlobalIndexLoading,
    globalIndexError,
    setGlobalIndexError,
    summaryIndex,
    setSummaryIndex,
    summaryLoading,
    setSummaryLoading,
    loadGlobalIndex,
    loadSegmentsForEpisodes,
    loadSummaryIndex,
    searchWorkerRef,
    workerSearchResults,
    setWorkerSearchResults,
    workerSearching,
    setWorkerSearching,
    searchEngineMode,
    setSearchEngineMode,
    serverSearchResults,
    setServerSearchResults,
    serverSearching,
    setServerSearching,
    searchFallbackNotice,
    setSearchFallbackNotice,
    timeOffsetSec,
    setTimeOffsetSec,
    setAndSaveTimeOffset,
    audioSeekOffsetSec,
    setAudioSeekOffsetSec,
    handleSetAudioSeekOffset,
    speakerMap,
    setSpeakerMap,
    saveSpeakerRename,
    resetAllSpeakerNames,
    savedSpeakers,
    setSavedSpeakers,
  };
}
