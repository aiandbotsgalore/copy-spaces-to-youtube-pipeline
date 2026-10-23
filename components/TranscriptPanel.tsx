import React, { useState, useCallback, useMemo, useEffect, useRef, useDeferredValue } from 'react';
import JSZip from 'jszip';
import {
  FileText, RefreshCw, AlertCircle, Search, ChevronDown, Loader,
  ExternalLink, Play, Pause, Volume2, Copy, Check, Download,
  SlidersHorizontal, ArrowDownCircle, Sparkles, Pencil, Users, X, RotateCcw,
  Save, CheckCircle2, Star, Plus, Trash2, UserPlus, Sparkle, Clock,
  Globe, Radio, Layers, ArrowRight, Headphones, Scissors, Film, HardDriveDownload,
  Database, Tag, BarChart3, ShieldAlert, Bot
} from 'lucide-react';
import { Release, ReleaseAsset, EnhancedConfig, EpisodePart } from '../types';
import { getReleases, fetchReleaseAssetText, dispatchWorkflow, updateReleaseTranscriptAssets, getReleaseParts } from '../utils/github';
import { usePlayer, NowPlayingEpisode } from '../contexts/PlayerContext';
import { getEpisodeRecordedDate, sortReleasesByRecordedDate } from '../utils/dates';
import { AudioSlicerModal, SlicerTurnTarget } from './AudioSlicerModal';
import { SpeakerRenameModal } from './transcript/SpeakerRenameModal';
import { SavedSpeakersModal } from './transcript/SavedSpeakersModal';
import { EpisodeList, EpisodeDrawer, EpisodeStatus } from './transcript/EpisodeList';
import { EpisodeHeader } from './transcript/EpisodeHeader';
import { Transport } from './transcript/Transport';
import { SpeakerLane } from './transcript/SpeakerLane';
import { GlobalSearchOverlay } from './transcript/GlobalSearchOverlay';
import { PublishPreview, type PreviewChapter } from './transcript/PublishPreview';
import { QueuedEpisode } from './transcript/QueuedEpisode';
import { ShortcutsOverlay } from './transcript/ShortcutsOverlay';
import { SelectionBar, type SelectionInfo } from './transcript/SelectionBar';
import { loadClipCatalog, clipBandsForRelease, type CatalogClip } from '../utils/clipCatalog';
import { TranscriptPane } from './transcript/TranscriptPane';
import { TranscriptRow, RowActions } from './transcript/TranscriptRow';
import { useMontage } from '../contexts/MontageContext';
import { useCopilot } from '../contexts/CopilotContext';
import { isAudioCached, cacheAudioFile, getCachedAudioUrl, removeCachedAudio } from '../utils/audioCache';
import {
  SearchWorkerClient,
  parseGoogleQuery,
  evaluateTurnMatch,
  hasActiveQuery,
  renderTranscriptMatch,
} from '../utils/searchWorker';
import {
  UtteranceWord,
  SavedSpeaker,
  ExtractedClip,
  SearchIndexSegment,
  SearchIndexEpisode,
  EpisodeSummary,
  GlobalSearchResult,
  THEMATIC_CATEGORIES,
  MENTION_TARGETS,
  formatSize,
  pickTranscriptAsset,
  parseTranscriptMetadata,
  formatSeconds,
  SPEAKER_COLOR_MAP,
  DEFAULT_SAVED_SPEAKERS,
  DYNAMIC_COLOR_ORDER,
  getAutoSpeakerColor,
  getAutoSpeakerEmoji,
  getSpeakerTheme,
  getUtteranceWords,
  EPISODE_SEGMENTS_CACHE,
  fetchSummaryIndex,
  fetchSingleEpisodeTranscript,
  getEpisodeSegments,
  fetchSearchIndex,
  parseTranscriptData
} from '../utils/transcriptData';

interface Props {
  config: EnhancedConfig;
  initialReleaseId?: number | string | null;
}

const POPULAR_SEARCH_TOPICS = [
  'aliens', 'Windex', 'bidet', 'Casper', 'psyop', 'Logan',
  'queen', 'conscious culprit', 'James Blunt', 'red panda',
  'masturbation', 'Spanish', 'crucible', 'Tunica'
];

function highlightMatch(text: string, query: string): React.ReactNode {
  return renderTranscriptMatch(text, query);
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────


/** Link to the original Space when the release body carries a recognisable X Space id; otherwise the GitHub release page. */
function sourceSpaceUrl(release: Release): string | undefined {
  const id = release.body?.match(/METADATA::SOURCE_ID::(\S+)/)?.[1];
  if (id && /^[0-9][A-Za-z0-9]{12}$/.test(id)) return `https://x.com/i/spaces/${id}`;
  return release.html_url || undefined;
}

const TranscriptPanel: React.FC<Props> = ({ config, initialReleaseId }) => {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<number | string | null>(initialReleaseId ?? null);
  const [transcriptRaw, setTranscriptRaw] = useState('');
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState('');
  const [search, setSearch] = useState('');
  const [speakerFilter, setSpeakerFilter] = useState('ALL');
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeSuccess, setTranscribeSuccess] = useState('');
  const [timeOffsetSec, setTimeOffsetSec] = useState<number>(0);
  const [audioSeekOffsetSec, setAudioSeekOffsetSec] = useState<number>(0);

  const [searchScope, setSearchScope] = useState<'current' | 'all'>('current');
  const [globalIndex, setGlobalIndex] = useState<SearchIndexEpisode[] | null>(null);
  const [globalIndexLoading, setGlobalIndexLoading] = useState(false);
  const [globalIndexError, setGlobalIndexError] = useState('');
  const [summaryIndex, setSummaryIndex] = useState<EpisodeSummary[] | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const searchWorkerRef = useRef<SearchWorkerClient | null>(null);
  const [workerSearchResults, setWorkerSearchResults] = useState<GlobalSearchResult[] | null>(null);
  const [workerSearching, setWorkerSearching] = useState(false);
  const [selectedGlobalTag, setSelectedGlobalTag] = useState<string>('ALL');
  const [selectedGlobalSpeaker, setSelectedGlobalSpeaker] = useState<string>('ALL');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedMentionTarget, setSelectedMentionTarget] = useState<string>('ALL');
  const [slicerTarget, setSlicerTarget] = useState<SlicerTurnTarget | null>(null);
  const [isSlicerOpen, setIsSlicerOpen] = useState(false);
  const [isCurrentAudioCached, setIsCurrentAudioCached] = useState(false);
  const [isCachingCurrentAudio, setIsCachingCurrentAudio] = useState(false);
  const [currentAudioCachePct, setCurrentAudioCachePct] = useState(0);
  const [speakerZipLoading, setSpeakerZipLoading] = useState(false);
  const [speakerZipProgress, setSpeakerZipProgress] = useState<{
    current: number;
    total: number;
    currentTitle: string;
    percent: number;
  } | null>(null);
  const [speakerZipError, setSpeakerZipError] = useState<string | null>(null);
  const [speakerZipSuccess, setSpeakerZipSuccess] = useState<string | null>(null);

  // Extracted Audio Clips Archive state (Angela & featured speakers)
  const [extractedAudioClips, setExtractedAudioClips] = useState<ExtractedClip[]>([]);
  const [audioZipLoading, setAudioZipLoading] = useState(false);
  const [audioZipProgress, setAudioZipProgress] = useState<{
    current: number;
    total: number;
    currentTitle: string;
    percent: number;
  } | null>(null);
  const [audioZipError, setAudioZipError] = useState<string | null>(null);
  const [audioZipSuccess, setAudioZipSuccess] = useState<string | null>(null);
  const [activeResultsView, setActiveResultsView] = useState<'turns' | 'clips'>('turns');

  const [speakerMap, setSpeakerMap] = useState<Record<string, string>>({});
  const [quickRenameTarget, setQuickRenameTarget] = useState<{ rawSpeaker: string; currentName: string; turnCount?: number } | null>(null);
  const [showRenameModal, setShowRenameModal] = useState(false);

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
  const [showSavedSpeakersModal, setShowSavedSpeakersModal] = useState(false);

  const [savingGitHub, setSavingGitHub] = useState(false);
  const [saveGitHubSuccess, setSaveGitHubSuccess] = useState('');
  const [saveGitHubError, setSaveGitHubError] = useState('');
  const [selectedPartNum, setSelectedPartNum] = useState<number>(1);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const currentLoadedIdRef = useRef<number | null>(null);
  const transcriptionPollRef = useRef<number | null>(null);

  useEffect(() => {
    if (initialReleaseId !== undefined && initialReleaseId !== null) {
      setSelectedId(initialReleaseId);
    }
  }, [initialReleaseId]);
  const lastAutoScrolledUtteranceRef = useRef<string | null>(null);
  const targetScrollSecRef = useRef<number | null>(null);
  const targetScrollRef = useRef<{ releaseId: number; tag?: string; sec: number } | null>(null);

  const { play, seek, skip, currentTime, duration: playerDuration, isPlaying, current, togglePlay } = usePlayer();
  const { addClip } = useMontage();
  const [catalogClips, setCatalogClips] = useState<CatalogClip[]>([]);
  useEffect(() => { let live = true; loadClipCatalog().then(c => { if (live) setCatalogClips(c); }); return () => { live = false; }; }, []);
  const copilot = useCopilot();

  const openQuickSlicer = (target: SlicerTurnTarget) => {
    setSlicerTarget(target);
    setIsSlicerOpen(true);
  };

  const handleAddTurnToMontage = (speaker: string, text: string, startSec: number, endSec: number | null, audioUrl?: string, title?: string, tag?: string) => {
    const cleanQuoteSlug = text
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, 5)
      .join(' ');

    const lower = text.toLowerCase();
    let cat: 'insult' | 'character' | 'abuse' | 'sexual' | 'criminal' | 'threat' | 'other' = 'character';
    let sev = 7;
    if (lower.includes('police') || lower.includes('cop') || lower.includes('ic3') || lower.includes('lawsuit') || lower.includes('court') || lower.includes('bankrupt')) {
      cat = lower.includes('lawsuit') || lower.includes('bankrupt') ? 'threat' : 'criminal';
      sev = 9;
    } else if (lower.includes('predator') || lower.includes('porn') || lower.includes('deepfake') || lower.includes('nude') || lower.includes('minor')) {
      cat = 'sexual';
      sev = 10;
    } else if (lower.includes('harem') || lower.includes('triangulat') || lower.includes('trauma') || lower.includes('manipulat')) {
      cat = 'abuse';
      sev = 8;
    } else if (lower.includes('dox') || lower.includes('address') || lower.includes('phone') || lower.includes('front door')) {
      cat = 'threat';
      sev = 9;
    }

    addClip({
      title: `${speaker}: "${cleanQuoteSlug}…"`,
      quote: text,
      speaker,
      sourceTitle: title || 'Space Episode',
      sourceTag: tag,
      audioUrl,
      startSec,
      endSec: endSec !== null && endSec > startSec ? endSec : startSec + 12,
      category: cat,
      severity: sev,
    });
  };


  const owner = (config.ownerName || '').trim();
  const repo = (config.repoName || '').trim();
  const hasCredentials = !!(config.githubToken && owner && repo);

  const effectiveReleases = useMemo((): Release[] => {
    let list: Release[] = [];
    if (releases.length > 0) {
      list = releases;
    } else if (summaryIndex && summaryIndex.length > 0) {
      list = summaryIndex.map(ep => ({
        id: ep.release_id,
        tag_name: ep.release_tag,
        name: ep.title,
        body: ep.body || null,
        published_at: ep.published_at,
        html_url: '',
        assets: ep.audio_url ? [{
          id: ep.release_id,
          name: `${ep.release_tag}.mp3`,
          browser_download_url: ep.audio_url,
          size: 0,
          content_type: 'audio/mpeg'
        }] : [],
        draft: false,
        prerelease: false,
        episode_date: ep.episode_date,
      }));
    } else if (globalIndex && globalIndex.length > 0) {
      list = globalIndex.map(ep => ({
        id: ep.release_id,
        tag_name: ep.release_tag,
        name: ep.title,
        body: (ep as any).body || null,
        published_at: ep.published_at,
        html_url: '',
        assets: ep.audio_url ? [{
          id: ep.release_id,
          name: `${ep.release_tag}.mp3`,
          browser_download_url: ep.audio_url,
          size: 0,
          content_type: 'audio/mpeg'
        }] : [],
        draft: false,
        prerelease: false,
        episode_date: (ep as any).episode_date,
      }));
    }
    return sortReleasesByRecordedDate(list, 'desc');
  }, [releases, summaryIndex, globalIndex]);

  const selectedRelease = useMemo(() => effectiveReleases.find(r => r.id === selectedId || (typeof selectedId === 'string' && (r.tag_name === selectedId || r.tag_name.includes(selectedId)))), [effectiveReleases, selectedId]);
  const episodeParts = useMemo(() => selectedRelease ? getReleaseParts(selectedRelease) : [], [selectedRelease]);
  const activePart = useMemo(() => episodeParts.find(p => p.partNumber === selectedPartNum) || episodeParts[0] || null, [episodeParts, selectedPartNum]);
  const transcriptMetadata = useMemo(() => parseTranscriptMetadata(transcriptRaw), [transcriptRaw]);
  const mp3Asset = useMemo(() => activePart?.mp3Asset ?? selectedRelease?.assets.find(a => a.name.endsWith('.mp3')) ?? null, [activePart, selectedRelease]);
  const isCurrentEpisodePlaying = current?.id === selectedRelease?.id && (activePart?.mp3Asset ? current?.audioUrl === activePart.mp3Asset.browser_download_url : true) && isPlaying;

  useEffect(() => {
    const url = mp3Asset?.browser_download_url;
    if (url) {
      isAudioCached(url).then(setIsCurrentAudioCached);
    } else {
      setIsCurrentAudioCached(false);
    }
  }, [mp3Asset]);

  const handleToggleCacheCurrentAudio = async () => {
    const url = mp3Asset?.browser_download_url;
    if (!url) {
      alert('No audio stream URL found for this episode.');
      return;
    }

    if (isCurrentAudioCached) {
      await removeCachedAudio(url);
      setIsCurrentAudioCached(false);
    } else {
      setIsCachingCurrentAudio(true);
      setCurrentAudioCachePct(0);
      try {
        await cacheAudioFile(url, (p) => setCurrentAudioCachePct(p.percent));
        setIsCurrentAudioCached(true);
      } catch (err: any) {
        alert(`Failed to cache audio: ${err.message || 'Stream error'}`);
      } finally {
        setIsCachingCurrentAudio(false);
      }
    }
  };


  const addOrUpdatePermanentSpeaker = (speaker: SavedSpeaker) => {
    setSavedSpeakers(prev => {
      const existing = prev.findIndex(s => s.name.toLowerCase() === speaker.name.toLowerCase());
      const updated = existing >= 0 ? [...prev] : [...prev, speaker];
      if (existing >= 0) updated[existing] = speaker;
      try { localStorage.setItem('spacepipe_saved_speakers', JSON.stringify(updated)); } catch {}
      return updated;
    });
  };

  const deletePermanentSpeaker = (idOrName: string) => {
    setSavedSpeakers(prev => {
      const updated = prev.filter(s => s.id !== idOrName && s.name.toLowerCase() !== idOrName.toLowerCase());
      try { localStorage.setItem('spacepipe_saved_speakers', JSON.stringify(updated)); } catch {}
      return updated;
    });
  };

  const quickSaveToPermanent = (name: string, emoji?: string, color?: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const def = DEFAULT_SAVED_SPEAKERS.find(s => s.name.toLowerCase() === trimmed.toLowerCase());
    const finalColor = color || def?.color || getAutoSpeakerColor(trimmed);
    const finalEmoji = emoji || def?.avatarEmoji || getAutoSpeakerEmoji(trimmed);
    addOrUpdatePermanentSpeaker({
      id: trimmed.toLowerCase().replace(/\s+/g, '-'),
      name: trimmed,
      avatarEmoji: finalEmoji,
      color: finalColor,
      role: def?.role || 'Speaker'
    });
  };

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
    const needed = tags.filter(tag => !EPISODE_SEGMENTS_CACHE.has(tag));
    if (needed.length > 0) {
      setGlobalIndexLoading(true);
      try {
        await Promise.all(needed.map(async (tag) => {
          await getEpisodeSegments(tag, owner, repo);
        }));
      } finally {
        setGlobalIndexLoading(false);
      }
    }
    setGlobalIndex(prev => {
      if (!prev) return prev;
      return prev.map(ep => {
        if (tags.includes(ep.release_tag) && (!ep.segments || ep.segments.length === 0)) {
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

  useEffect(() => {
    if (searchScope === 'all' && !globalIndex && !globalIndexLoading) {
      loadGlobalIndex();
    }
  }, [searchScope, globalIndex, globalIndexLoading, loadGlobalIndex]);

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

  const setAndSaveAudioSeekOffset = (offset: number | ((prev: number) => number)) => {
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

  const fetchReleases = useCallback(async () => {
    if (!hasCredentials) return;
    setLoading(true);
    setError('');
    currentLoadedIdRef.current = null;
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

  const loadTranscript = useCallback(async (release: Release, targetAsset?: ReleaseAsset | null, partNum?: number) => {
    const pNum = typeof partNum === 'number' ? partNum : 1;
    setSelectedPartNum(pNum);
    const parts = getReleaseParts(release);
    const partObj = parts.find(p => p.partNumber === pNum) || parts[0];
    const asset = targetAsset !== undefined ? (targetAsset ?? undefined) : (partObj?.transcriptAsset || pickTranscriptAsset(release, pNum));

    setSelectedId(release.id);
    if (!targetScrollRef.current) {
      setSearch('');
    }
    setSpeakerFilter('ALL');
    setTranscribeSuccess('');
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
    setQuickRenameTarget(null);
    setSaveGitHubSuccess('');
    setSaveGitHubError('');

    if (!asset) {
      setTranscriptLoading(true);
      setTranscriptError('');
      setTranscriptRaw('');
      try {
        const singleText = await fetchSingleEpisodeTranscript(release.tag_name, owner, repo);
        if (singleText) {
          const parsed = JSON.parse(singleText);
          if (parsed && parsed.segments && parsed.segments.length > 0) {
            setTranscriptRaw(JSON.stringify({ segments: parsed.segments }));
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

    try {
      const text = await fetchReleaseAssetText(
        config.githubToken, asset, owner, repo, release.tag_name
      );
      setTranscriptRaw(text);

      // Auto-clear stale offsets that would push the first segment to negative time
      try {
        const savedOffset = localStorage.getItem(`spk_offset_${release.id}_p${pNum}`) || localStorage.getItem(`spk_offset_${release.id}`);
        if (savedOffset) {
          const first = parseTranscriptData(text)[0];
          const rawOffset = Number.parseFloat(savedOffset);
          if (!Number.isFinite(rawOffset) || (first && first.rawStartSec + rawOffset < 0)) {
            localStorage.removeItem(`spk_offset_${release.id}_p${pNum}`);
            setTimeOffsetSec(0);
          }
        }
      } catch { /* localStorage may be unavailable */ }
    } catch (e) {
      // Resilient Fallback: If GitHub download is blocked by CORS or network, recover from local episode file
      try {
        const singleText = await fetchSingleEpisodeTranscript(release.tag_name, owner, repo);
        if (singleText) {
          const parsed = JSON.parse(singleText);
          if (parsed && parsed.segments && parsed.segments.length > 0) {
            setTranscriptRaw(JSON.stringify({ segments: parsed.segments }));
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
  }, [config.githubToken, owner, repo, globalIndex]);

  const stopTranscriptPolling = useCallback(() => {
    if (transcriptionPollRef.current !== null) {
      window.clearInterval(transcriptionPollRef.current);
      transcriptionPollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopTranscriptPolling(), [stopTranscriptPolling]);

  const startTranscriptPolling = useCallback((releaseId: number) => {
    stopTranscriptPolling();
    const startedAt = Date.now();
    const maxPollMs = 30 * 60 * 1000;
    transcriptionPollRef.current = window.setInterval(async () => {
      if (Date.now() - startedAt > maxPollMs) {
        stopTranscriptPolling();
        setTranscribeSuccess('Transcription is still processing. Use Refresh later to check for the completed release asset.');
        return;
      }
      try {
        const data = await getReleases(config.githubToken, owner, repo);
        setReleases(sortReleasesByRecordedDate(data, 'desc'));
        const updated = data.find(r => r.id === releaseId);
        if (updated && pickTranscriptAsset(updated)) {
          stopTranscriptPolling();
          currentLoadedIdRef.current = releaseId;
          await loadTranscript(updated);
          setTranscribeSuccess('Transcription completed and loaded automatically.');
        }
      } catch { /* polling is best-effort */ }
    }, 12_000);
  }, [config.githubToken, owner, repo, loadTranscript, stopTranscriptPolling]);

  const handleGenerateTranscript = async () => {
    if (!selectedRelease || !hasCredentials) return;
    setTranscribing(true);
    setTranscribeSuccess('');
    setTranscriptError('');
    try {
      await dispatchWorkflow(config.githubToken, owner, repo, 'transcribe_episode.yml', { release_tag: selectedRelease.tag_name });
      setTranscribeSuccess(`Workflow dispatched for ${selectedRelease.tag_name}. The audio is being transcribed and diarized; this page will check automatically for completion.`);
      startTranscriptPolling(selectedRelease.id);
    } catch (e) {
      setTranscriptError(`Failed to trigger transcription: ${(e as Error).message}`);
    } finally {
      setTranscribing(false);
    }
  };

  useEffect(() => {
    if (effectiveReleases.length > 0 && selectedId) {
      const rel = effectiveReleases.find(r =>
        r.id === selectedId || (typeof selectedId === 'string' && (r.tag_name === selectedId || r.tag_name.includes(selectedId)))
      );
      if (rel && currentLoadedIdRef.current !== rel.id) {
        currentLoadedIdRef.current = rel.id;
        setSelectedPartNum(1);
        loadTranscript(rel, undefined, 1);
        if (selectedId !== rel.id) {
          setSelectedId(rel.id);
        }
      }
    } else if (effectiveReleases.length > 0 && !selectedId) {
      const first = effectiveReleases.find(r => !!pickTranscriptAsset(r)) || effectiveReleases[0];
      if (first && currentLoadedIdRef.current !== first.id) {
        currentLoadedIdRef.current = first.id;
        setSelectedPartNum(1);
        loadTranscript(first, undefined, 1);
      }
    }
  }, [effectiveReleases, selectedId, loadTranscript]);

  const parsedUtterances = useMemo(() => parseTranscriptData(transcriptRaw), [transcriptRaw]);

  const utterances = useMemo(() => parsedUtterances.map(u => {
    const adjustedStart = Math.max(0, u.rawStartSec + timeOffsetSec);
    const adjustedEnd = u.rawEndSec !== null ? Math.max(0, u.rawEndSec + timeOffsetSec) : null;
    const adjustedWords = u.words ? u.words.map(w => ({
      ...w,
      start: Math.max(0, w.start + timeOffsetSec),
      end: Math.max(0, w.end + timeOffsetSec),
    })) : undefined;
    return {
      ...u,
      startSec: adjustedStart,
      endSec: adjustedEnd,
      startLabel: formatSeconds(adjustedStart),
      endLabel: adjustedEnd !== null ? formatSeconds(adjustedEnd) : '',
      speaker: speakerMap[u.rawSpeaker] || u.speaker,
      words: adjustedWords,
    };
  }), [parsedUtterances, speakerMap, timeOffsetSec]);

  useEffect(() => {
    if (targetScrollRef.current && utterances.length > 0 && selectedRelease) {
      const { releaseId, tag, sec } = targetScrollRef.current;
      if (selectedRelease.id === releaseId || (tag && selectedRelease.tag_name === tag)) {
        targetScrollRef.current = null;
        targetScrollSecRef.current = null;
        const u = utterances.find(item => item.startSec <= sec && (item.endSec === null || item.endSec >= sec))
          || utterances.find(item => item.startSec >= sec)
          || utterances[0];
        if (u) {
          const timer = setTimeout(() => {
            const el = document.getElementById(`utterance-card-${u.id}`);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 200);
          return () => clearTimeout(timer);
        }
      }
    } else if (targetScrollSecRef.current !== null && utterances.length > 0) {
      const targetSec = targetScrollSecRef.current;
      targetScrollSecRef.current = null;
      const u = utterances.find(item => item.startSec <= targetSec && (item.endSec === null || item.endSec >= targetSec))
        || utterances.find(item => item.startSec >= targetSec)
        || utterances[0];
      if (u) {
        const timer = setTimeout(() => {
          const el = document.getElementById(`utterance-card-${u.id}`);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 200);
        return () => clearTimeout(timer);
      }
    }
  }, [utterances, selectedRelease]);

  const speakerStats = useMemo(() => {
    const counts = new Map<string, number>();
    parsedUtterances.forEach(u => counts.set(u.rawSpeaker, (counts.get(u.rawSpeaker) || 0) + 1));
    return Array.from(counts.entries()).map(([rawSpeaker, count]) => ({
      rawSpeaker, displayName: speakerMap[rawSpeaker] || rawSpeaker, count,
    }));
  }, [parsedUtterances, speakerMap]);

  const uniqueDisplaySpeakers = useMemo(() => {
    const s = new Set<string>();
    utterances.forEach(u => s.add(u.speaker));
    return Array.from(s);
  }, [utterances]);

  const openQuickRename = (rawSpeaker: string, currentName: string) => {
    const turns = speakerStats.find(st => st.rawSpeaker === rawSpeaker)?.count || 0;
    setQuickRenameTarget({ rawSpeaker, currentName, turnCount: turns });
  };


  const searchAst = useMemo(() => parseGoogleQuery(search), [search]);
  const hasActiveSearch = useMemo(() => hasActiveQuery(searchAst), [searchAst]);

  const filteredUtterances = useMemo(() => utterances.filter(u => {
    if (speakerFilter !== 'ALL' && u.speaker !== speakerFilter) return false;

    if (selectedCategory !== 'ALL') {
      const cat = THEMATIC_CATEGORIES.find(c => c.id === selectedCategory);
      if (cat && cat.keywords.length > 0) {
        const textLower = u.text.toLowerCase();
        if (!cat.keywords.some(kw => textLower.includes(kw))) return false;
      }
    }

    if (selectedMentionTarget !== 'ALL') {
      const target = MENTION_TARGETS.find(t => t.id === selectedMentionTarget);
      if (target && target.keywords.length > 0) {
        const textLower = u.text.toLowerCase();
        if (!target.keywords.some(kw => textLower.includes(kw))) return false;
      }
    }

    if (hasActiveSearch) {
      const searchTarget = `${u.speaker}: ${u.text}`;
      if (!evaluateTurnMatch(searchTarget, searchAst)) return false;
    }
    return true;
  }), [utterances, speakerFilter, hasActiveSearch, searchAst, selectedCategory, selectedMentionTarget]);

  // Dynamic Conversation & Confrontation Heatmap across the active episode timeline
  const conversationHeatmap = useMemo(() => {
    if (!utterances.length) return [];
    let maxTime = 1;
    for (let i = 0; i < utterances.length; i++) {
      const s = utterances[i].startSec;
      if (s > maxTime) maxTime = s;
    }
    const numBuckets = 50;
    const bucketDuration = maxTime / numBuckets;

    const buckets = Array.from({ length: numBuckets }, (_, i) => ({
      index: i,
      startSec: i * bucketDuration,
      endSec: (i + 1) * bucketDuration,
      label: formatSeconds(i * bucketDuration),
      count: 0,
      mentionCount: 0,
      speakers: new Set<string>(),
    }));

    const mentionKeywords = selectedMentionTarget !== 'ALL'
      ? (MENTION_TARGETS.find(t => t.id === selectedMentionTarget)?.keywords || ['logan'])
      : ['logan', 'lawsuit', 'dox', 'police', 'predator', 'court', 'bankrupt'];

    utterances.forEach(u => {
      const bIdx = Math.min(numBuckets - 1, Math.floor(u.startSec / bucketDuration));
      buckets[bIdx].count += 1;
      buckets[bIdx].speakers.add(u.speaker);
      const lower = u.text.toLowerCase();
      if (mentionKeywords.some(kw => lower.includes(kw))) {
        buckets[bIdx].mentionCount += 1;
      }
    });

    let maxCount = 1;
    for (let i = 0; i < buckets.length; i++) {
      if (buckets[i].count > maxCount) maxCount = buckets[i].count;
    }
    return buckets.map(b => ({
      ...b,
      density: b.count / maxCount,
      isHot: b.mentionCount > 0,
    }));
  }, [utterances, selectedMentionTarget]);

  const matchCount = useMemo(() => {
    if (!hasActiveSearch) return 0;
    return utterances.filter(u => evaluateTurnMatch(`${u.speaker}: ${u.text}`, searchAst)).length;
  }, [hasActiveSearch, searchAst, utterances]);

  const totalGlobalSegments = useMemo(() => {
    if (summaryIndex && summaryIndex.length > 0) {
      return summaryIndex.reduce((acc, ep) => acc + (ep.segment_count || 0), 0);
    }
    if (globalIndex) {
      return globalIndex.reduce((acc, ep) => acc + (ep.segment_count || ep.segments?.length || 0), 0);
    }
    return 359134;
  }, [summaryIndex, globalIndex]);

  const deferredSearch = useDeferredValue(search);

  // All distinct speakers across the entire archive (from summaryIndex + loaded segments)
  const allArchiveSpeakers = useMemo(() => {
    const speakerMap = new Map<string, { count: number; episodes: Set<string> }>();

    // 1. Always seed all distinct speakers and their episode presence from summaryIndex (entire archive)
    if (summaryIndex && summaryIndex.length > 0) {
      for (const ep of summaryIndex) {
        if (ep.speakers && Array.isArray(ep.speakers)) {
          for (const spk of ep.speakers) {
            const trimmed = spk.trim();
            if (trimmed) {
              const entry = speakerMap.get(trimmed) || { count: 0, episodes: new Set<string>() };
              entry.episodes.add(ep.release_tag);
              speakerMap.set(trimmed, entry);
            }
          }
        }
      }
    }

    // 2. Count turns and track any dynamic speakers from any currently loaded segments
    if (globalIndex && globalIndex.length > 0) {
      for (const ep of globalIndex) {
        if (ep.segments && ep.segments.length > 0) {
          for (const seg of ep.segments) {
            const spk = seg.speaker?.trim();
            if (spk) {
              const entry = speakerMap.get(spk) || { count: 0, episodes: new Set<string>() };
              entry.count += 1;
              entry.episodes.add(ep.release_tag);
              speakerMap.set(spk, entry);
            }
          }
        }
      }
    }

    return Array.from(speakerMap.entries())
      .map(([name, data]) => ({
        name,
        count: data.count,
        episodeCount: data.episodes.size,
      }))
      .sort((a, b) => {
        if (a.name.toLowerCase() === 'angela') return -1;
        if (b.name.toLowerCase() === 'angela') return 1;
        const aIsGeneric = /^Speaker\s*\d+$/i.test(a.name);
        const bIsGeneric = /^Speaker\s*\d+$/i.test(b.name);
        if (aIsGeneric && !bIsGeneric) return 1;
        if (!aIsGeneric && bIsGeneric) return -1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
  }, [globalIndex, summaryIndex]);

  const selectedSpeakerEpisodeCount = useMemo(() => {
    if (selectedGlobalSpeaker === 'ALL') return 0;
    const lower = selectedGlobalSpeaker.toLowerCase();
    if (summaryIndex && summaryIndex.length > 0) {
      return summaryIndex.filter(ep => ep.speakers && ep.speakers.some(s => s.toLowerCase() === lower)).length;
    }
    if (globalIndex && globalIndex.length > 0) {
      return globalIndex.filter(ep => ep.segments && ep.segments.some(seg => seg.speaker.toLowerCase() === lower)).length;
    }
    return 0;
  }, [selectedGlobalSpeaker, summaryIndex, globalIndex]);

  const angelaEpisodeCount = useMemo(() => {
    if (summaryIndex && summaryIndex.length > 0) {
      return summaryIndex.filter(ep => ep.speakers && ep.speakers.some(s => s.toLowerCase() === 'angela')).length;
    }
    return 19;
  }, [summaryIndex]);

  const filteredClips = useMemo(() => {
    if (!extractedAudioClips.length) return [];
    const q = deferredSearch.trim().toLowerCase();
    if (!q) return extractedAudioClips;
    const terms = q.split(/\s+/).filter(Boolean);
    return extractedAudioClips.filter(c => {
      const target = `${c.title} ${c.quote} ${c.space_title || ''} ${c.filename}`.toLowerCase();
      return terms.every(term => target.includes(term));
    });
  }, [extractedAudioClips, deferredSearch]);

  // Determine if any global filter is active (search query, selected speaker, selected category, mention target, or selected episode)
  const isGlobalFilteringActive = Boolean(
    deferredSearch.trim() || selectedGlobalSpeaker !== 'ALL' || selectedGlobalTag !== 'ALL' || selectedCategory !== 'ALL' || selectedMentionTarget !== 'ALL'
  );

  // Auto-trigger globalIndex load and fetch episode segments on demand
  useEffect(() => {
    if ((selectedGlobalSpeaker !== 'ALL' || selectedGlobalTag !== 'ALL' || selectedCategory !== 'ALL' || selectedMentionTarget !== 'ALL' || searchScope === 'all') && !globalIndex && !globalIndexLoading) {
      loadGlobalIndex();
    }
  }, [selectedGlobalSpeaker, selectedGlobalTag, selectedCategory, selectedMentionTarget, searchScope, globalIndex, globalIndexLoading, loadGlobalIndex]);

  useEffect(() => {
    if (selectedGlobalSpeaker !== 'ALL' && summaryIndex && summaryIndex.length > 0) {
      const targetSpeakerLower = selectedGlobalSpeaker.trim().toLowerCase();
      const matchingTags = summaryIndex
        .filter(ep => ep.speakers && ep.speakers.some(s => s.trim().toLowerCase() === targetSpeakerLower))
        .map(ep => ep.release_tag);
      if (matchingTags.length > 0) {
        loadSegmentsForEpisodes(matchingTags);
      }
    }
  }, [selectedGlobalSpeaker, summaryIndex, loadSegmentsForEpisodes]);

  useEffect(() => {
    if (selectedGlobalTag !== 'ALL') {
      loadSegmentsForEpisodes([selectedGlobalTag]);
    }
  }, [selectedGlobalTag, loadSegmentsForEpisodes]);

  // Automatically sync full active episode turns into Copilot context
  useEffect(() => {
    if (selectedRelease && utterances.length > 0) {
      copilot.setContextPayload(prev => {
        if (
          prev.currentEpisode?.releaseTag === selectedRelease.tag_name &&
          prev.currentEpisode?.totalTurns === utterances.length
        ) {
          return prev;
        }
        return {
          ...prev,
          activeTab: 'transcripts',
          currentEpisode: {
            releaseId: selectedRelease.id,
            releaseTag: selectedRelease.tag_name,
            title: selectedRelease.name || selectedRelease.tag_name,
            audioUrl: mp3Asset?.browser_download_url,
            speakers: Array.from(new Set(utterances.map(u => u.speaker))),
            segmentsSample: utterances.slice(0, 30).map(u => ({
              speaker: u.speaker,
              text: u.text,
              start: u.startSec,
              end: u.endSec || u.startSec + 5,
            })),
            allSegments: utterances.map(u => ({
              speaker: u.speaker,
              text: u.text,
              start: u.startSec,
              end: u.endSec || u.startSec + 5,
            })),
            totalTurns: utterances.length,
            durationSec: utterances[utterances.length - 1]?.endSec || utterances[utterances.length - 1]?.startSec || 0,
          },
        };
      });
    }
  }, [selectedRelease, utterances, mp3Asset, copilot]);

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

  // Execute search queries off-thread in background Web Worker
  useEffect(() => {
    if (!globalIndex) {
      setWorkerSearchResults(null);
      setWorkerSearching(false);
      return;
    }

    if (!searchWorkerRef.current || !searchWorkerRef.current.isAvailable()) {
      setWorkerSearchResults(null);
      return;
    }

    const query = deferredSearch.trim();
    const speakerFilter = selectedGlobalSpeaker !== 'ALL' ? selectedGlobalSpeaker : null;
    const tagFilter = selectedGlobalTag !== 'ALL' ? selectedGlobalTag : null;
    const isCategoryFilter = selectedCategory !== 'ALL';
    const isMentionFilter = selectedMentionTarget !== 'ALL';

    if (!query && !speakerFilter && !tagFilter && !isCategoryFilter && !isMentionFilter) {
      setWorkerSearchResults([]);
      setWorkerSearching(false);
      return;
    }

    setWorkerSearching(true);
    const catObj = isCategoryFilter ? THEMATIC_CATEGORIES.find(c => c.id === selectedCategory) : null;
    const mentionObj = isMentionFilter ? MENTION_TARGETS.find(t => t.id === selectedMentionTarget) : null;

    searchWorkerRef.current.search({
      query,
      speakerFilter,
      tagFilter,
      categoryKeywords: catObj?.keywords || [],
      mentionKeywords: mentionObj?.keywords || [],
      mentionId: mentionObj?.id,
    }).then((results) => {
      setWorkerSearchResults(results as GlobalSearchResult[]);
      setWorkerSearching(false);
    });
  }, [globalIndex, deferredSearch, selectedGlobalSpeaker, selectedGlobalTag, selectedCategory, selectedMentionTarget]);

  const deferredSearchAst = useMemo(() => parseGoogleQuery(deferredSearch), [deferredSearch]);
  const hasActiveDeferredSearch = useMemo(() => hasActiveQuery(deferredSearchAst), [deferredSearchAst]);

  // Synchronous fallback search only if Web Worker is unavailable
  const syncFallbackMatches = useMemo((): GlobalSearchResult[] => {
    if (workerSearchResults !== null) return [];
    if (!globalIndex) return [];
    const speakerFilter = selectedGlobalSpeaker !== 'ALL' ? selectedGlobalSpeaker : null;
    const tagFilter = selectedGlobalTag !== 'ALL' ? selectedGlobalTag : null;
    const isCategoryFilter = selectedCategory !== 'ALL';
    const isMentionFilter = selectedMentionTarget !== 'ALL';

    if (!hasActiveDeferredSearch && !speakerFilter && !tagFilter && !isCategoryFilter && !isMentionFilter) return [];

    const catObj = isCategoryFilter ? THEMATIC_CATEGORIES.find(c => c.id === selectedCategory) : null;
    const mentionObj = isMentionFilter ? MENTION_TARGETS.find(t => t.id === selectedMentionTarget) : null;

    const results: GlobalSearchResult[] = [];

    for (const ep of globalIndex) {
      if (tagFilter && ep.release_tag !== tagFilter) {
        continue;
      }
      for (let i = 0; i < ep.segments.length; i++) {
        const seg = ep.segments[i];
        if (speakerFilter && seg.speaker !== speakerFilter) {
          continue;
        }

        const segTextLower = (seg.text || '').toLowerCase();

        // Thematic Category Filter
        if (catObj && catObj.keywords.length > 0) {
          const matchesCat = catObj.keywords.some(kw => segTextLower.includes(kw));
          if (!matchesCat) continue;
        }

        // Relational Mention Filter
        if (mentionObj && mentionObj.keywords.length > 0) {
          const isDirectArgue = ep.release_tag.includes('loganSavDeaconAngelaArgue');
          const matchesMention = mentionObj.keywords.some(kw => segTextLower.includes(kw)) ||
            (mentionObj.id === 'LOGAN' && isDirectArgue && seg.speaker.toLowerCase() === 'angela');
          if (!matchesMention) continue;
        }

        // Google Search Query terms
        if (hasActiveDeferredSearch) {
          const searchTarget = seg._search ?? `${seg.speaker ? seg.speaker + ': ' : ''}${seg.text || ''}`;
          if (!evaluateTurnMatch(searchTarget, deferredSearchAst)) {
            continue;
          }
        }

        results.push({
          release_id: ep.release_id,
          release_tag: ep.release_tag,
          title: ep.title,
          published_at: ep.published_at,
          audio_url: ep.audio_url,
          segment: seg,
          segmentIndex: i,
        });
      }
    }
    return results;
  }, [workerSearchResults, globalIndex, hasActiveDeferredSearch, deferredSearchAst, selectedGlobalSpeaker, selectedGlobalTag, selectedCategory, selectedMentionTarget]);

  // All matches for current criteria across all episodes (prefers worker, falls back gracefully)
  const globalAllMatches = workerSearchResults !== null ? workerSearchResults : syncFallbackMatches;

  // Episode match counts across all matches (shows which episodes have matches for the selected criteria)
  const globalResultEpisodeCounts = useMemo(() => {
    const counts = new Map<string, { tag: string; title: string; count: number }>();
    globalAllMatches.forEach(r => {
      const existing = counts.get(r.release_tag);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(r.release_tag, { tag: r.release_tag, title: r.title, count: 1 });
      }
    });
    return Array.from(counts.values());
  }, [globalAllMatches]);

  const [globalDisplayLimit, setGlobalDisplayLimit] = useState<number>(200);

  // Reset display limit when query or filters change
  useEffect(() => {
    setGlobalDisplayLimit(200);
  }, [deferredSearch, selectedGlobalSpeaker, selectedGlobalTag, selectedCategory, selectedMentionTarget]);

  // Final paginated / sliced results for DOM performance
  const globalSearchResults = useMemo((): GlobalSearchResult[] => {
    return globalAllMatches.slice(0, globalDisplayLimit);
  }, [globalAllMatches, globalDisplayLimit]);

  // Auto-reset episode tag filter if it's no longer present in matching episodes
  useEffect(() => {
    if (selectedGlobalTag !== 'ALL' && globalResultEpisodeCounts.length > 0 && !globalResultEpisodeCounts.some(e => e.tag === selectedGlobalTag)) {
      setSelectedGlobalTag('ALL');
    }
  }, [globalResultEpisodeCounts, selectedGlobalTag]);

  const handlePlayGlobalResult = (res: GlobalSearchResult) => {
    if (!res.audio_url) return;
    const effectiveTime = currentTime - audioSeekOffsetSec;
    const isThisPlaying = current?.id === res.release_id && isPlaying &&
      effectiveTime >= res.segment.start &&
      effectiveTime <= (res.segment.end !== null && res.segment.end > res.segment.start ? res.segment.end : res.segment.start + 30);

    if (isThisPlaying) {
      togglePlay();
      return;
    }

    const nowPlaying: NowPlayingEpisode = {
      id: res.release_id,
      title: res.title,
      audioUrl: res.audio_url,
    };
    const targetSeekSec = Math.max(0, res.segment.start + audioSeekOffsetSec);
    if (current?.id !== res.release_id) {
      play(nowPlaying, targetSeekSec);
    } else {
      seek(targetSeekSec);
      if (!isPlaying) togglePlay();
    }
  };

  const handleOpenInFullTranscript = (res: GlobalSearchResult) => {
    targetScrollRef.current = { releaseId: res.release_id, tag: res.release_tag, sec: res.segment.start };
    targetScrollSecRef.current = res.segment.start;
    const rel = effectiveReleases.find(r => r.id === res.release_id || r.tag_name === res.release_tag);
    if (rel) {
      currentLoadedIdRef.current = rel.id;
      setSelectedId(rel.id);
      loadTranscript(rel);
    }
    setSearchScope('current');
    if (res.audio_url) {
      const nowPlaying: NowPlayingEpisode = {
        id: res.release_id,
        title: res.title,
        audioUrl: res.audio_url,
      };
      const targetSeekSec = Math.max(0, res.segment.start + audioSeekOffsetSec);
      if (current?.id !== res.release_id) {
        play(nowPlaying, targetSeekSec);
      } else {
        seek(targetSeekSec);
        if (!isPlaying) togglePlay();
      }
    }
  };

  // Binary search — O(log n) active utterance lookup
  const activeUtteranceIndex = useMemo(() => {
    if (current?.id !== selectedRelease?.id || !utterances.length) return -1;
    const effectiveTime = currentTime - audioSeekOffsetSec;
    let lo = 0, hi = utterances.length - 1, candidate = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (utterances[mid].startSec <= effectiveTime) { candidate = mid; lo = mid + 1; }
      else { hi = mid - 1; }
    }
    if (candidate < 0) return -1;
    const u = utterances[candidate];
    const effectiveEnd = u.endSec ?? utterances[candidate + 1]?.startSec ?? Number.POSITIVE_INFINITY;
    return effectiveTime < effectiveEnd ? candidate : -1;
  }, [current?.id, selectedRelease?.id, utterances, currentTime, audioSeekOffsetSec]);

  // ID-based comparison is filter-safe (index comparison would break under search/filter)
  const activeUtteranceId = activeUtteranceIndex >= 0 ? utterances[activeUtteranceIndex]?.id ?? null : null;

  useEffect(() => {
    if (!autoScroll || !activeUtteranceId || lastAutoScrolledUtteranceRef.current === activeUtteranceId) return;
    const el = document.getElementById(`utterance-card-${activeUtteranceId}`);
    const box = document.getElementById('transcript-scroll');
    if (el && box) {
      lastAutoScrolledUtteranceRef.current = activeUtteranceId;
      const top = box.scrollTop + (el.getBoundingClientRect().top - box.getBoundingClientRect().top) - box.clientHeight / 3;
      box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
  }, [autoScroll, activeUtteranceId]);

  const handlePlayUtterance = (startSec: number) => {
    if (!selectedRelease || !mp3Asset) return;
    const titleWithPart = episodeParts.length > 1 && activePart
      ? `${selectedRelease.name || selectedRelease.tag_name} (${activePart.label})`
      : (selectedRelease.name || selectedRelease.tag_name);
    const nowPlaying: NowPlayingEpisode = { id: selectedRelease.id, title: titleWithPart, audioUrl: mp3Asset.browser_download_url };
    const targetSeekSec = Math.max(0, startSec + audioSeekOffsetSec);
    if (current?.id !== selectedRelease.id || current?.audioUrl !== mp3Asset.browser_download_url) {
      play(nowPlaying, targetSeekSec);
    } else {
      seek(targetSeekSec);
      if (!isPlaying) togglePlay();
    }
  };

  const handlePlayEpisodeToggle = () => {
    if (!selectedRelease || !mp3Asset) return;
    const titleWithPart = episodeParts.length > 1 && activePart
      ? `${selectedRelease.name || selectedRelease.tag_name} (${activePart.label})`
      : (selectedRelease.name || selectedRelease.tag_name);
    const nowPlaying: NowPlayingEpisode = { id: selectedRelease.id, title: titleWithPart, audioUrl: mp3Asset.browser_download_url };
    if (current?.id === selectedRelease.id && current?.audioUrl === mp3Asset.browser_download_url) {
      togglePlay();
    } else {
      play(nowPlaying);
    }
  };

  const handleCopyTranscript = async () => {
    if (!utterances.length) return;
    const formatted = utterances.map(u => `[${u.startLabel}${u.endLabel ? ` - ${u.endLabel}` : ''}] ${u.speaker}:\n${u.text}`).join('\n\n');
    try {
      await navigator.clipboard.writeText(formatted);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (e) { setTranscriptError(`Could not copy: ${(e as Error).message}`); }
  };

  const handleDownloadTranscript = (format: 'txt' | 'json') => {
    if (!utterances.length || !selectedRelease) return;
    const baseName = (selectedRelease.name || selectedRelease.tag_name).replace(/[^a-zA-Z0-9_-]/g, '_');
    let blob: Blob, filename: string;
    if (format === 'json') {
      const data = {
        episode: selectedRelease.name || selectedRelease.tag_name,
        tag: selectedRelease.tag_name,
        published_at: selectedRelease.published_at,
        segments: utterances.map(u => ({ start: u.startSec, end: u.endSec, speaker: u.speaker, raw_speaker: u.rawSpeaker, text: u.text, ...(u.confidence !== undefined ? { confidence: u.confidence } : {}) })),
      };
      blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      filename = `${baseName}_transcript.json`;
    } else {
      blob = new Blob([utterances.map(u => `[${u.startLabel}${u.endLabel ? ` - ${u.endLabel}` : ''}] ${u.speaker}: ${u.text}`).join('\n\n')], { type: 'text/plain;charset=utf-8' });
      filename = `${baseName}_transcript.txt`;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const handleDownloadSpeakerZip = useCallback(async (targetSpeaker?: string) => {
    const spk = (targetSpeaker || selectedGlobalSpeaker).trim();
    if (!spk || spk === 'ALL') return;

    setSpeakerZipLoading(true);
    setSpeakerZipError(null);
    setSpeakerZipSuccess(null);
    setSpeakerZipProgress({
      current: 0,
      total: 0,
      currentTitle: `Locating all spaces featuring ${spk}…`,
      percent: 5,
    });

    try {
      const speakerLower = spk.toLowerCase();
      let matchedEps: { release_tag: string; title: string; published_at?: string; audio_url?: string }[] = [];

      if (summaryIndex && summaryIndex.length > 0) {
        matchedEps = summaryIndex
          .filter(ep => ep.speakers && ep.speakers.some(s => s.toLowerCase() === speakerLower))
          .map(ep => ({
            release_tag: ep.release_tag,
            title: ep.title,
            published_at: ep.published_at,
            audio_url: ep.audio_url,
          }));
      }

      if (matchedEps.length === 0 && globalIndex && globalIndex.length > 0) {
        matchedEps = globalIndex
          .filter(ep => ep.segments && ep.segments.some(seg => seg.speaker.toLowerCase() === speakerLower))
          .map(ep => ({
            release_tag: ep.release_tag,
            title: ep.title,
            published_at: ep.published_at,
            audio_url: ep.audio_url,
          }));
      }

      if (matchedEps.length === 0) {
        throw new Error(`No recorded spaces found featuring speaker "${spk}".`);
      }

      const totalCount = matchedEps.length;
      const zip = new JSZip();
      const folderName = `Transcripts_${spk.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      const zipFolder = zip.folder(folderName) || zip;
      const jsonFolder = zipFolder.folder('raw_json');

      const allQuotes: string[] = [
        `================================================================================`,
        `ALL DIALOGUE SPOKEN BY: ${spk.toUpperCase()}`,
        `Extracted from ${totalCount} Twitter Space Episodes`,
        `Export Date: ${new Date().toLocaleString()}`,
        `================================================================================\n`,
      ];

      const indexTable: string[] = [
        `================================================================================`,
        `INDEX OF SPACES FEATURING ${spk.toUpperCase()}`,
        `Total Episodes: ${totalCount}`,
        `Generated: ${new Date().toLocaleString()}`,
        `================================================================================\n`,
      ];

      for (let i = 0; i < totalCount; i++) {
        const ep = matchedEps[i];
        const progressPct = 10 + Math.round((i / totalCount) * 80);
        setSpeakerZipProgress({
          current: i + 1,
          total: totalCount,
          currentTitle: `[${i + 1}/${totalCount}] Processing "${ep.title}"…`,
          percent: progressPct,
        });

        // 1. Get segments
        let segments: SearchIndexSegment[] = [];
        if (EPISODE_SEGMENTS_CACHE.has(ep.release_tag)) {
          segments = EPISODE_SEGMENTS_CACHE.get(ep.release_tag)!;
        } else {
          const rawText = await fetchSingleEpisodeTranscript(ep.release_tag, owner, repo);
          if (rawText) {
            try {
              const parsed = JSON.parse(rawText);
              segments = Array.isArray(parsed.segments) ? parsed.segments : [];
              if (segments.length > 0) {
                EPISODE_SEGMENTS_CACHE.set(ep.release_tag, segments);
              }
              if (jsonFolder) {
                jsonFolder.file(`${ep.release_tag}.json`, rawText);
              }
            } catch {}
          }
        }

        let formattedTranscript = '';
        let speakerTurnCount = 0;

        if (segments.length > 0) {
          const header = [
            `================================================================================`,
            `Title: ${ep.title}`,
            `Release Tag: ${ep.release_tag}`,
            ep.published_at ? `Date: ${new Date(ep.published_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}` : '',
            ep.audio_url ? `Audio URL: ${ep.audio_url}` : '',
            `Featuring Speaker: ${spk}`,
            `Total Spoken Turns: ${segments.length}`,
            `================================================================================\n`,
          ].filter(Boolean).join('\n');

          const bodyLines: string[] = [];
          for (const seg of segments) {
            const timeLabel = formatSeconds(seg.start);
            const isTarget = seg.speaker?.toLowerCase() === speakerLower;
            if (isTarget) speakerTurnCount++;

            bodyLines.push(`[${timeLabel}] ${seg.speaker || 'Unknown'}:`);
            bodyLines.push(`${seg.text}\n`);

            if (isTarget) {
              allQuotes.push(`[${ep.title}] [${timeLabel}]:\n${seg.text}\n`);
            }
          }

          formattedTranscript = `${header}\n${bodyLines.join('\n')}`;
          indexTable.push(`${i + 1}. [${ep.release_tag}] ${ep.title} — ${speakerTurnCount} turns by ${spk} (${segments.length} total turns)`);
        } else {
          const rel = releases.find(r => r.tag_name === ep.release_tag);
          if (rel) {
            const asset = pickTranscriptAsset(rel);
            if (asset) {
              try {
                formattedTranscript = await fetchReleaseAssetText(config.githubToken, asset, owner, repo, ep.release_tag);
              } catch {}
            }
          }
          if (!formattedTranscript) {
            formattedTranscript = `Title: ${ep.title}\nRelease: ${ep.release_tag}\nNote: Transcript could not be retrieved.\n`;
          }
          indexTable.push(`${i + 1}. [${ep.release_tag}] ${ep.title}`);
        }

        const safeTitle = (ep.title || ep.release_tag)
          .replace(/[^a-zA-Z0-9_\- ]/g, '')
          .trim()
          .replace(/\s+/g, '_')
          .slice(0, 80);
        zipFolder.file(`${ep.release_tag}_${safeTitle}.txt`, formattedTranscript);
      }

      zipFolder.file(`00_INDEX_ALL_${spk.toUpperCase()}_SPACES.txt`, indexTable.join('\n'));
      zipFolder.file(`00_ALL_${spk.toUpperCase()}_DIALOGUE.txt`, allQuotes.join('\n'));

      setSpeakerZipProgress({
        current: totalCount,
        total: totalCount,
        currentTitle: `Generating and compressing ZIP archive…`,
        percent: 92,
      });

      const zipBlob = await zip.generateAsync({ type: 'blob' }, (meta) => {
        setSpeakerZipProgress(prev => prev ? {
          ...prev,
          percent: Math.min(99, 92 + Math.round(meta.percent * 0.07)),
        } : null);
      });

      const downloadUrl = URL.createObjectURL(zipBlob);
      const downloadAnchor = document.createElement('a');
      const zipFileName = `Transcripts_${spk.replace(/[^a-zA-Z0-9_-]/g, '_')}_(${totalCount}_Spaces).zip`;
      downloadAnchor.href = downloadUrl;
      downloadAnchor.download = zipFileName;
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      document.body.removeChild(downloadAnchor);
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 3000);

      setSpeakerZipSuccess(`Downloaded ${zipFileName} containing all ${totalCount} transcripts!`);
      setSpeakerZipProgress(null);
    } catch (err: any) {
      console.error('Error generating speaker ZIP:', err);
      setSpeakerZipError(err.message || 'Failed to download zip file');
      setSpeakerZipProgress(null);
    } finally {
      setSpeakerZipLoading(false);
    }
  }, [selectedGlobalSpeaker, summaryIndex, globalIndex, owner, repo, releases, config.githubToken]);

  // Load extracted audio clips manifest on mount
  useEffect(() => {
    let isMounted = true;
    fetch('./clips/angela/manifest.json')
      .then(res => res.ok ? res.json() : [])
      .then((data: ExtractedClip[]) => {
        if (isMounted && Array.isArray(data)) {
          setExtractedAudioClips(data);
        }
      })
      .catch(err => {
        console.warn('Could not load audio clips manifest:', err);
      });
    return () => { isMounted = false; };
  }, []);

  const handleDownloadSingleClip = useCallback((clip: ExtractedClip) => {
    const downloadAnchor = document.createElement('a');
    downloadAnchor.href = `./${clip.url}`;
    downloadAnchor.download = clip.filename;
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    document.body.removeChild(downloadAnchor);
  }, []);

  const handlePlayClipAudio = useCallback((clip: ExtractedClip) => {
    const clipNum = parseInt(clip.id.replace(/\D/g, ''), 10) || 1;
    const nowPlaying: NowPlayingEpisode = {
      id: 999000 + clipNum,
      title: `⭐ [Audio Clip] ${clip.title}`,
      audioUrl: `./${clip.url}`,
    };
    play(nowPlaying, 0);
  }, [play]);

  const handleDownloadSpeakerAudioZip = useCallback(async (targetSpeaker: string = 'Angela') => {
    const spk = (targetSpeaker || selectedGlobalSpeaker).trim();
    setAudioZipLoading(true);
    setAudioZipError(null);
    setAudioZipSuccess(null);
    setAudioZipProgress({
      current: 1,
      total: 47,
      currentTitle: `Preparing Angela audio clips archive (47 clips: 35 .wav cuts + 12 quotes)...`,
      percent: 25,
    });

    try {
      const staticZipUrl = './clips/Angela_All_Audio_Clips.zip';
      const headCheck = await fetch(staticZipUrl, { method: 'HEAD' });
      if (headCheck.ok) {
        setAudioZipProgress({
          current: 47,
          total: 47,
          currentTitle: 'Starting direct download: Angela_All_Audio_Clips_(47_Clips).zip (38.6 MB)...',
          percent: 95,
        });

        const downloadAnchor = document.createElement('a');
        downloadAnchor.href = staticZipUrl;
        downloadAnchor.download = `Angela_All_Audio_Clips_(47_Clips).zip`;
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        document.body.removeChild(downloadAnchor);

        setAudioZipSuccess(`Downloaded Angela_All_Audio_Clips_(47_Clips).zip containing all 47 master audio clips (38.6 MB)!`);
        setTimeout(() => setAudioZipProgress(null), 3000);
        return;
      }

      // Fallback: Dynamic JSZip generation
      const zip = new JSZip();
      const folderName = `Audio_Clips_${spk.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      const zipFolder = zip.folder(folderName) || zip;
      const clipsToDownload = extractedAudioClips.length > 0 ? extractedAudioClips : [];

      let done = 0;
      for (const clip of clipsToDownload) {
        done++;
        setAudioZipProgress({
          current: done,
          total: clipsToDownload.length,
          currentTitle: `[${done}/${clipsToDownload.length}] Adding "${clip.filename}"...`,
          percent: 15 + Math.round((done / clipsToDownload.length) * 70),
        });
        try {
          const fileRes = await fetch(`./${clip.url}`);
          if (fileRes.ok) {
            const blobData = await fileRes.blob();
            zipFolder.file(clip.filename, blobData);
          }
        } catch (fErr) {
          console.warn(`Failed to add clip ${clip.filename}:`, fErr);
        }
      }

      setAudioZipProgress({
        current: clipsToDownload.length,
        total: clipsToDownload.length,
        currentTitle: 'Compressing archive…',
        percent: 90,
      });

      const zipBlob = await zip.generateAsync({ type: 'blob' }, (meta) => {
        setAudioZipProgress(prev => prev ? {
          ...prev,
          percent: Math.min(99, 90 + Math.round(meta.percent * 0.09)),
        } : null);
      });

      const dUrl = URL.createObjectURL(zipBlob);
      const downloadAnchor = document.createElement('a');
      downloadAnchor.href = dUrl;
      downloadAnchor.download = `Audio_Clips_${spk}_(${clipsToDownload.length}_Clips).zip`;
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      document.body.removeChild(downloadAnchor);
      setTimeout(() => URL.revokeObjectURL(dUrl), 4000);

      setAudioZipSuccess(`Downloaded Audio_Clips_${spk} (${clipsToDownload.length} clips)!`);
      setTimeout(() => setAudioZipProgress(null), 3000);
    } catch (err: any) {
      console.error('Error downloading audio clips ZIP:', err);
      setAudioZipError(err.message || 'Failed to download audio clips');
      setAudioZipProgress(null);
    } finally {
      setAudioZipLoading(false);
    }
  }, [selectedGlobalSpeaker, extractedAudioClips]);

  const getMatchingExtractedClip = useCallback((res: GlobalSearchResult): ExtractedClip | null => {
    if (!extractedAudioClips.length || !res.segment.text) return null;
    const textNorm = res.segment.text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
    const tag = res.release_tag;

    for (const clip of extractedAudioClips) {
      if (clip.space_tag && tag && clip.space_tag === tag) {
        const qNorm = clip.quote.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').trim();
        const words = qNorm.split(/\s+/).filter(w => w.length > 3);
        if (words.length > 0) {
          const matchCount = words.filter(w => textNorm.includes(w)).length;
          if (matchCount >= Math.min(3, Math.ceil(words.length * 0.5))) {
            return clip;
          }
        }
      }
      const qClean = clip.quote.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').slice(0, 30);
      if (qClean.length > 10 && textNorm.includes(qClean)) {
        return clip;
      }
    }
    return null;
  }, [extractedAudioClips]);

  const handleSaveToGitHub = async () => {
    if (!selectedRelease || !hasCredentials || !utterances.length) return;
    setSavingGitHub(true);
    setSaveGitHubSuccess('');
    setSaveGitHubError('');
    try {
      const text = utterances.map(u => `[${u.startLabel}${u.endLabel ? ` - ${u.endLabel}` : ''}] ${u.speaker}: ${u.text}`).join('\n\n');
      const jsonData = JSON.stringify({
        episode: selectedRelease.name || selectedRelease.tag_name,
        tag: selectedRelease.tag_name,
        published_at: selectedRelease.published_at,
        segments: utterances.map(u => ({ start: u.startSec, end: u.endSec, speaker: u.speaker, raw_speaker: u.rawSpeaker, text: u.text, ...(u.confidence !== undefined ? { confidence: u.confidence } : {}) })),
      }, null, 2);
      await updateReleaseTranscriptAssets(config.githubToken, owner, repo, selectedRelease, text, jsonData);
      // Offset is now baked into saved timestamps — clear it to prevent double-apply on reload
      try { localStorage.removeItem(`spk_offset_${selectedRelease.id}`); } catch {}
      setTimeOffsetSec(0);
      setSaveGitHubSuccess('Saved permanently to GitHub Release assets! All devices, downloads, and apps will now see these speaker names and timestamps.');
      setTimeout(() => setSaveGitHubSuccess(''), 6000);
    } catch (e) {
      setSaveGitHubError(`Failed to save to GitHub: ${(e as Error).message}`);
    } finally {
      setSavingGitHub(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  const isCurrentEpisodeLoaded = !!selectedRelease && current?.id === selectedRelease.id;

  const handleTransportSkip = (delta: number) => {
    if (isCurrentEpisodeLoaded) skip(delta);
    else if (delta > 0) handlePlayUtterance(delta);
  };

  const [queuePositions, setQueuePositions] = useState<Map<string, number>>(() => new Map());
  const [queueStages, setQueueStages] = useState<Map<string, 'fetch' | 'transcribe' | 'diarize' | 'index'>>(() => new Map());
  const queuedTags = useMemo(() => new Set(queuePositions.keys()), [queuePositions]);
  useEffect(() => {
    let live = true;
    const base = ((import.meta as any).env?.BASE_URL || '/') as string;
    fetch(`${base}transcripts/transcription_status.json`.replace(/\/+/g, '/'))
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (!live || !j || !Array.isArray(j.next_in_queue)) return;
        const pos = new Map<string, number>();
        const stages = new Map<string, 'fetch' | 'transcribe' | 'diarize' | 'index'>();
        j.next_in_queue.forEach((q: any, i: number) => {
          if (!q?.tag) return;
          pos.set(q.tag, typeof q.position === 'number' ? q.position : i + 1);
          if (['fetch', 'transcribe', 'diarize', 'index'].includes(q.stage)) stages.set(q.tag, q.stage);
        });
        setQueuePositions(pos);
        setQueueStages(stages);
      })
      .catch(() => { /* status file is optional */ });
    return () => { live = false; };
  }, []);

  const getEpisodeStatus = useCallback((release: Release): EpisodeStatus => {
    const hasTxt = !!pickTranscriptAsset(release)
      || (summaryIndex?.some(ep => (ep.release_id === release.id || ep.release_tag === release.tag_name) && (ep.segment_count || 0) > 0) ?? false);
    if (hasTxt) return 'ready';
    return queuedTags.has(release.tag_name) ? 'queued' : 'audio';
  }, [summaryIndex, queuedTags]);

  const getEpisodeRuntime = useCallback((release: Release): string | undefined => {
    const entry = summaryIndex?.find(ep => ep.release_tag === release.tag_name);
    let totalSec: number | null = typeof entry?.duration_sec === 'number' ? entry.duration_sec : null;
    if (totalSec === null) {
      const m = (release.body || entry?.body || '').match(/Duration:?\**\s*(\d{1,2}):(\d{2}):(\d{2})/i);
      if (m) totalSec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    }
    if (totalSec === null) return undefined;
    const h = Math.floor(totalSec / 3600); const mins = Math.floor((totalSec % 3600) / 60);
    return h > 0 ? `${h}h ${String(mins).padStart(2, '0')}m` : `${mins}m`;
  }, [summaryIndex]);

  const getEpisodeHandle = useCallback((release: Release): string | undefined => {
    const entry = summaryIndex?.find(ep => ep.release_tag === release.tag_name);
    const raw = entry?.host_handle || (release.body || entry?.body || '').match(/METADATA::HOST::@?([A-Za-z0-9_.\-]+)/)?.[1];
    return raw ? `@${String(raw).replace(/^@/, '')}` : undefined;
  }, [summaryIndex]);

  const episodeListProps = {
    releases: effectiveReleases,
    selectedId,
    globalActive: searchScope === 'all',
    totalLabel: summaryIndex
      ? `${summaryIndex.length} episodes • ${totalGlobalSegments.toLocaleString()} turns`
      : (globalIndex ? `${globalIndex.length} episodes • ${totalGlobalSegments.toLocaleString()} turns` : `${effectiveReleases.length} episodes`),
    getStatus: getEpisodeStatus,
    getRuntimeLabel: getEpisodeRuntime,
    getHandle: getEpisodeHandle,
    playingId: isPlaying ? (current?.id ?? null) : null,
    onSelect: (release: Release) => { setSearchScope('current'); loadTranscript(release); },
    onOpenGlobal: () => { setAdvancedGlobalSearch(false); setSearchScope('all'); loadGlobalIndex(); },
  };

  const themeBySpeaker = useMemo(() => {
    const m = new Map<string, ReturnType<typeof getSpeakerTheme>>();
    uniqueDisplaySpeakers.forEach(s => m.set(s, getSpeakerTheme(s, savedSpeakers)));
    return m;
  }, [uniqueDisplaySpeakers, savedSpeakers]);

  const getLaneDotClass = useCallback((speaker: string) => {
    const dot = (themeBySpeaker.get(speaker) ?? getSpeakerTheme(speaker, savedSpeakers)).dot;
    return dot.match(/bg-[^\s]+/)?.[0] ?? 'bg-slate-400';
  }, [themeBySpeaker, savedSpeakers]);

  const laneTurns = useMemo(
    () => utterances.map(u => ({ id: u.id, startSec: u.startSec, endSec: u.endSec, speaker: u.speaker })),
    [utterances],
  );
  const timelineDuration = useMemo(() => {
    const last = utterances[utterances.length - 1];
    const fromTurns = last ? (last.endSec ?? last.startSec) : 0;
    return fromTurns > 0 ? fromTurns : (isCurrentEpisodeLoaded ? playerDuration : 0);
  }, [utterances, isCurrentEpisodeLoaded, playerDuration]);
  const hotMarks = useMemo(() => conversationHeatmap.filter(b => b.isHot).map(b => b.startSec), [conversationHeatmap]);
  const paneSpeakers = useMemo(
    () => speakerStats.map(s => ({
      name: s.displayName,
      count: s.count,
      dotClass: (themeBySpeaker.get(s.displayName) ?? getSpeakerTheme(s.displayName, savedSpeakers)).dot.match(/bg-[^\s]+/)?.[0] ?? 'bg-slate-400',
    })),
    [speakerStats, themeBySpeaker, savedSpeakers],
  );

  const [advancedGlobalSearch, setAdvancedGlobalSearch] = useState(false);
  // Archive-wide search for the overlay: asks the dev server (it can read every transcript on disk).
  // Falls back to the in-memory results when the endpoint isn't there (e.g. a static deploy).
  const [overlayHits, setOverlayHits] = useState<GlobalSearchResult[] | null>(null);
  const [overlayLoading, setOverlayLoading] = useState(false);
  useEffect(() => {
    const overlayOpen = searchScope === 'all' && !advancedGlobalSearch;
    const q = search.trim();
    if (!overlayOpen || q.length < 2) { setOverlayHits(null); setOverlayLoading(false); return; }
    const ctrl = new AbortController();
    setOverlayLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/transcripts/search?q=${encodeURIComponent(q)}&max=150`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`search ${res.status}`);
        const rows: Array<{ episodeTitle: string; releaseTag: string; audioUrl?: string; episodeDate?: string; speaker: string; startSec: number; endSec: number; text: string }> = await res.json();
        if (!Array.isArray(rows)) throw new Error('bad payload');
        const byTag = new Map((summaryIndex ?? []).map(ep => [ep.release_tag, ep]));
        setOverlayHits(rows.map((r, i) => {
          const ep = byTag.get(r.releaseTag);
          return {
            release_id: ep?.release_id ?? 0,
            release_tag: r.releaseTag,
            title: r.episodeTitle || ep?.title || r.releaseTag,
            published_at: ep?.published_at || r.episodeDate || '',
            audio_url: r.audioUrl || ep?.audio_url || '',
            segment: { start: r.startSec, end: r.endSec, speaker: r.speaker, text: r.text },
            segmentIndex: i,
          } as GlobalSearchResult;
        }));
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setOverlayHits(null);
      } finally {
        if (!ctrl.signal.aborted) setOverlayLoading(false);
      }
    }, 250);
    return () => { window.clearTimeout(timer); ctrl.abort(); };
  }, [search, searchScope, advancedGlobalSearch, summaryIndex]);

  useEffect(() => { if (searchScope !== 'all') setAdvancedGlobalSearch(false); }, [searchScope]);
  const [showPublish, setShowPublish] = useState(false);
  const [feedCopied, setFeedCopied] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishMessage, setPublishMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const nudgeSyncRef = useRef<(d: number) => void>(() => {});
  nudgeSyncRef.current = d => setAndSaveTimeOffset(v => Number((v + d).toFixed(3)));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || el?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '?') { e.preventDefault(); setShowShortcuts(s => !s); }
      else if (e.key === ',') { e.preventDefault(); nudgeSyncRef.current(-0.1); }
      else if (e.key === '.') { e.preventDefault(); nudgeSyncRef.current(0.1); }
      else if ((e.key === 'f' || e.key === 'F') && !e.shiftKey) {
        e.preventDefault();
        setAutoScroll(a => !a);
        lastAutoScrolledUtteranceRef.current = null;
      } else if (e.key === 'Escape') {
        window.getSelection()?.removeAllRanges();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const previewChapters = useMemo<PreviewChapter[]>(() => {
    if (!utterances.length) return [];
    const last = utterances[utterances.length - 1];
    const total = last.endSec ?? last.startSec;
    if (total < 120) return [{ startSec: utterances[0].startSec, label: 'Full episode' }];
    const count = Math.min(10, Math.max(3, Math.round(total / 600)));
    const out: PreviewChapter[] = [];
    for (let i = 0; i < count; i++) {
      const from = (total / count) * i;
      const turn = utterances.find(u => u.startSec >= from && u.text.trim().length > 24) ?? utterances.find(u => u.startSec >= from);
      if (!turn) continue;
      if (out.length && Math.abs(turn.startSec - out[out.length - 1].startSec) < 30) continue;
      const words = turn.text.trim().split(/\s+/).slice(0, 9).join(' ');
      out.push({ startSec: turn.startSec, label: words.charAt(0).toUpperCase() + words.slice(1) + (turn.text.trim().split(/\s+/).length > 9 ? '…' : '') });
    }
    return out;
  }, [utterances]);

  const feedUrl = owner && repo ? `https://${owner}.github.io/${repo}/podcast.xml` : '';
  const handleCopyFeed = async () => {
    try { await navigator.clipboard.writeText(feedUrl); setFeedCopied(true); window.setTimeout(() => setFeedCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  const handlePublish = async () => {
    if (!hasCredentials) return;
    setPublishing(true);
    setPublishMessage(null);
    try {
      await dispatchWorkflow(config.githubToken, owner, repo, 'update_rss.yml');
      setPublishMessage({ kind: 'ok', text: 'Update RSS workflow started. The feed refreshes in a minute or two.' });
    } catch (err) {
      setPublishMessage({ kind: 'err', text: err instanceof Error ? err.message : 'Could not start the workflow.' });
    } finally {
      setPublishing(false);
    }
  };

  const resolveSelectionTurn = useCallback((id: string) => {
    const u = utterances.find(x => x.id === id);
    return u ? { startSec: u.startSec, endSec: u.endSec, speaker: u.speaker } : null;
  }, [utterances]);

  const handleSelectionClip = (sel: SelectionInfo) => {
    handleAddTurnToMontage(sel.speaker, sel.text, sel.startSec, sel.endSec, mp3Asset?.browser_download_url, selectedRelease?.name, selectedRelease?.tag_name);
  };

  const handleSelectionAsk = (sel: SelectionInfo) => {
    copilot.setContextPayload(prev => ({ ...prev, activeTab: 'transcripts', selectedText: sel.text }));
    copilot.activePanelNavHandler?.('ai-copilot');
  };

  const rowActionsRef = useRef<RowActions | null>(null);
  rowActionsRef.current = {
    play: handlePlayUtterance,
    rename: openQuickRename,
    slice: u => openQuickSlicer({
      speaker: u.speaker,
      quote: u.text,
      sourceTitle: selectedRelease?.name || 'Space Episode',
      sourceTag: selectedRelease?.tag_name || '',
      audioUrl: mp3Asset?.browser_download_url,
      startSec: u.startSec,
      endSec: u.endSec !== null && u.endSec > u.startSec ? u.endSec : u.startSec + 15,
      words: u.words,
    }),
    addToReel: u => handleAddTurnToMontage(u.speaker, u.text, u.startSec, u.endSec, mp3Asset?.browser_download_url, selectedRelease?.name, selectedRelease?.tag_name),
    syncAudio: u => setAndSaveAudioSeekOffset(Math.round((currentTime - u.startSec) * 10) / 10),
  };
  const rowActions = useMemo<RowActions>(() => ({
    play: s => rowActionsRef.current!.play(s),
    rename: (r, n) => rowActionsRef.current!.rename(r, n),
    slice: u => rowActionsRef.current!.slice(u),
    addToReel: u => rowActionsRef.current!.addToReel(u),
    syncAudio: u => rowActionsRef.current!.syncAudio(u),
  }), []);

  return (
    <div className="h-full overflow-hidden flex flex-col bg-slate-950">

      {/* ── Top Header ── */}
      <div className="px-4 md:px-6 py-3 border-b border-line flex items-center justify-between gap-4 flex-shrink-0 bg-bg">
        <h2 className="text-base font-semibold text-white tracking-tight">Interactive Transcripts</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (selectedRelease) {
                copilot.setContextPayload(prev => ({
                  ...prev,
                  activeTab: 'transcripts',
                  currentEpisode: {
                    releaseId: selectedRelease.id,
                    releaseTag: selectedRelease.tag_name,
                    title: selectedRelease.name || selectedRelease.tag_name,
                    audioUrl: mp3Asset?.browser_download_url,
                    speakers: Array.from(new Set(utterances.map(u => u.speaker))),
                    segmentsSample: utterances.slice(0, 30).map(u => ({
                      speaker: u.speaker,
                      text: u.text,
                      start: u.startSec,
                      end: u.endSec || u.startSec + 5,
                    })),
                    allSegments: utterances.map(u => ({
                      speaker: u.speaker,
                      text: u.text,
                      start: u.startSec,
                      end: u.endSec || u.startSec + 5,
                    })),
                    totalTurns: utterances.length,
                    durationSec: utterances[utterances.length - 1]?.endSec || utterances[utterances.length - 1]?.startSec || 0,
                  },
                }));
              }
              if (copilot.activePanelNavHandler) {
                copilot.activePanelNavHandler('ai-copilot');
              }
            }}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold bg-a1 hover:brightness-110 text-white rounded-lg transition-all cursor-pointer"
            title="Ask AI Copilot about this transcript and extract soundbites"
          >
            <Bot size={14} />
            <span>Ask Copilot</span>
          </button>

          <button onClick={fetchReleases} disabled={loading || !hasCredentials}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-card hover:brightness-125 disabled:opacity-50 text-slate-200 rounded-lg transition-colors border border-line cursor-pointer"
            title={hasCredentials ? 'Refresh releases from GitHub' : 'Connect a GitHub token to refresh'}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {!hasCredentials && (
        <div className="mx-4 md:mx-10 my-2 px-3.5 py-2 bg-indigo-950/40 border border-indigo-500/30 rounded-lg flex items-center justify-between gap-3 text-xs text-indigo-300 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Globe size={14} className="text-indigo-400 flex-shrink-0" />
            <span>Viewing local transcript archive ({effectiveReleases.length} episodes). Connect your GitHub Token in settings to sync live releases and save changes.</span>
          </div>
        </div>
      )}

      {hasCredentials && error && (
        <div className="mx-4 md:mx-10 my-2 flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-xs flex-shrink-0">
          <AlertCircle size={14} className="text-rose-400 flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={fetchReleases} className="text-xs text-rose-200 underline hover:text-white cursor-pointer">Retry</button>
        </div>
      )}

      {(summaryLoading || (globalIndexLoading && !summaryIndex)) && effectiveReleases.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-slate-400">
          <Loader size={28} className="animate-spin text-indigo-400 mb-3" />
          <p className="text-sm font-medium text-slate-300">Loading transcript database…</p>
        </div>
      )}

      {effectiveReleases.length === 0 && !summaryLoading && !globalIndexLoading && (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
          <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl mb-4"><FileText size={28} className="text-slate-400" /></div>
          <p className="text-slate-300 text-sm font-medium">No Transcripts or Episodes Found</p>
          <p className="text-slate-400 text-xs mt-1 max-w-sm">Connect your GitHub Personal Access Token or ensure transcripts_summary_index.json is loaded.</p>
        </div>
      )}

      {effectiveReleases.length > 0 && (
        <div className="flex-1 flex min-h-0">

          {/* ── Episode list (drawer below 1120px) ── */}
          <EpisodeList
            className="w-72 xl:w-80 flex-shrink-0 max-[1119px]:hidden"
            {...episodeListProps}
          />
          <EpisodeDrawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            {...episodeListProps}
          />

          {/* ── Main View ── */}
          <div className="flex-1 flex flex-col min-w-0 bg-slate-950">
            {searchScope === 'all' && !advancedGlobalSearch && (
              <GlobalSearchOverlay
                query={search}
                onQuery={setSearch}
                results={overlayHits ?? globalSearchResults}
                totalMatches={(overlayHits ?? globalAllMatches).length}
                loading={overlayLoading || globalIndexLoading}
                dateLabel={published => new Date(published).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                highlight={highlightMatch}
                onPick={handleOpenInFullTranscript}
                onAdvanced={() => setAdvancedGlobalSearch(true)}
                onClose={() => setSearchScope('current')}
              />
            )}
            {searchScope === 'all' && advancedGlobalSearch ? (
              <div className="flex-1 flex flex-col min-h-0 bg-slate-950">
                {/* Global Search Header / Filter Bar */}
                <div className="p-4 md:px-8 bg-slate-900/90 border-b border-slate-800/80 space-y-3.5 flex-shrink-0">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      {/* Scope Selector */}
                      <div className="inline-flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 shadow-inner">
                        <button
                          onClick={() => { setSearchScope('all'); loadGlobalIndex(); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 text-white shadow-md transition-all cursor-pointer"
                        >
                          <Globe size={13} />
                          <span>All Transcripts</span>
                          <span className="px-1.5 py-0.2 bg-white/20 rounded-full text-[11px] font-semibold ml-0.5">
                            {summaryIndex ? summaryIndex.length : (globalIndex ? globalIndex.length : 241)}
                          </span>
                        </button>
                        {selectedRelease && (
                          <button
                            onClick={() => setSearchScope('current')}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-white transition-all cursor-pointer"
                          >
                            <FileText size={13} />
                            <span className="truncate max-w-[150px]">{selectedRelease.name || selectedRelease.tag_name}</span>
                          </button>
                        )}
                      </div>

                      <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400 pl-1">
                        <Layers size={13} className="text-indigo-400" />
                        <span className="font-semibold text-slate-200">
                          {totalGlobalSegments > 0 ? totalGlobalSegments.toLocaleString() : '359,000+'}
                        </span>
                        <span>indexed turns</span>
                      </div>
                    </div>

                    {/* Right status */}
                    <div className="flex items-center gap-2">
                      {globalIndexLoading && (
                        <span className="flex items-center gap-1.5 text-xs text-indigo-400 animate-pulse font-medium">
                          <Loader size={12} className="animate-spin" /> Loading transcript database…
                        </span>
                      )}
                      {isGlobalFilteringActive && !globalIndexLoading && (
                        <span className="text-xs text-amber-400 font-medium px-2.5 py-1 bg-amber-500/10 border border-amber-500/30 rounded-lg shadow-sm inline-flex items-center gap-1.5">
                          {globalAllMatches.length.toLocaleString()} match{globalAllMatches.length !== 1 ? 'es' : ''}
                          {globalResultEpisodeCounts.length > 0 && ` across ${globalResultEpisodeCounts.length} episode${globalResultEpisodeCounts.length > 1 ? 's' : ''}`}
                          <span className="px-1.5 py-0.2 bg-emerald-950/80 text-[11px] text-emerald-300 rounded font-mono border border-emerald-500/30" title="Background Web Worker search engine active (60fps UI)">
                            ⚡ 60fps Worker
                          </span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Global Search Bar and Filter Dropdowns */}
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="relative flex-1 min-w-[280px]">
                      <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-indigo-400" />
                      <input
                        type="text"
                        autoFocus
                        placeholder={`Search across all ${summaryIndex?.length || globalIndex?.length || 241} transcripts (e.g. aliens, bidet, chipper, whistleblower)…`}
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="w-full pl-10 pr-9 py-2.5 bg-slate-950 border border-slate-700/90 focus:border-indigo-500 rounded-xl text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 shadow-inner"
                      />
                      {workerSearching && (
                        <div className="absolute right-9 top-1/2 -translate-y-1/2 flex items-center gap-1 px-1.5 py-0.5 bg-indigo-950/90 border border-indigo-500/40 rounded text-[11px] text-indigo-300 font-mono shadow-sm pointer-events-none">
                          <Loader size={10} className="animate-spin text-indigo-400" />
                          <span>off-thread…</span>
                        </div>
                      )}
                      {search && !workerSearching && (
                        <button
                          onClick={() => setSearch('')}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1 rounded-md hover:bg-slate-800 transition-colors cursor-pointer"
                          title="Clear search"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>

                    {/* Episode filter */}
                    {((summaryIndex && summaryIndex.length > 0) || (globalIndex && globalIndex.length > 0)) && (
                      <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 shadow-sm">
                        <Radio size={12} className="text-indigo-400 flex-shrink-0" />
                        <select
                          value={selectedGlobalTag}
                          onChange={e => setSelectedGlobalTag(e.target.value)}
                          className="bg-transparent text-xs text-slate-300 focus:outline-none cursor-pointer max-w-[170px] truncate"
                          title="Filter by episode"
                        >
                          <option value="ALL" className="bg-slate-900 text-white">All Episodes ({(summaryIndex || globalIndex)?.length || 241})</option>
                          {(summaryIndex || globalIndex || []).map(ep => (
                            <option key={ep.release_tag} value={ep.release_tag} className="bg-slate-900 text-white">
                              {ep.title || ep.release_tag}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Speaker filter — Always visible and accessible */}
                    <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 shadow-sm">
                      <Users size={12} className="text-emerald-400 flex-shrink-0" />
                      <select
                        value={selectedGlobalSpeaker}
                        onChange={e => {
                          setSelectedGlobalSpeaker(e.target.value);
                          if (!globalIndex && !globalIndexLoading) {
                            loadGlobalIndex();
                          }
                        }}
                        className="bg-transparent text-xs text-slate-300 focus:outline-none cursor-pointer max-w-[170px] truncate"
                        title="Filter by speaker across all episodes"
                      >
                        <option value="ALL" className="bg-slate-900 text-white">
                          All Speakers {allArchiveSpeakers.length > 0 ? `(${allArchiveSpeakers.length})` : ''}
                        </option>
                        {allArchiveSpeakers.map(spk => (
                          <option key={spk.name} value={spk.name} className="bg-slate-900 text-white">
                            {spk.name.toLowerCase() === 'angela' ? `⭐ ${spk.name}` : spk.name} ({spk.episodeCount} space{spk.episodeCount !== 1 ? 's' : ''}{spk.count > 0 ? `, ${spk.count} turns` : ''})
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Target Mention Filter (e.g. Angela talking about Logan) */}
                    <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 shadow-sm">
                      <ShieldAlert size={12} className="text-amber-400 flex-shrink-0" />
                      <select
                        value={selectedMentionTarget}
                        onChange={e => {
                          setSelectedMentionTarget(e.target.value);
                          if (!globalIndex && !globalIndexLoading) loadGlobalIndex();
                        }}
                        className="bg-transparent text-xs text-slate-300 focus:outline-none cursor-pointer max-w-[175px] truncate"
                        title="Filter speaker turns mentioning a specific person or topic"
                      >
                        {MENTION_TARGETS.map(m => (
                          <option key={m.id} value={m.id} className="bg-slate-900 text-white">
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Speaker ZIP Download Action Buttons */}
                    {selectedGlobalSpeaker !== 'ALL' && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleDownloadSpeakerZip(selectedGlobalSpeaker)}
                          disabled={speakerZipLoading}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 border border-slate-700 text-slate-200 rounded-lg text-xs font-semibold shadow-sm transition-all cursor-pointer whitespace-nowrap"
                          title={`Download all transcripts featuring ${selectedGlobalSpeaker} in one ZIP archive`}
                        >
                          <FileText size={12} className={speakerZipLoading ? 'animate-bounce text-emerald-400' : 'text-emerald-400'} />
                          <span>
                            {speakerZipLoading
                              ? 'Creating ZIP…'
                              : `Download ${selectedSpeakerEpisodeCount} Spaces (.zip)`}
                          </span>
                        </button>
                        {selectedGlobalSpeaker.toLowerCase() === 'angela' && (
                          <button
                            onClick={() => handleDownloadSpeakerAudioZip('Angela')}
                            disabled={audioZipLoading}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-md transition-all cursor-pointer whitespace-nowrap"
                            title="Download all 47 master audio clips of Angela (.wav & .mp3, 38.6 MB) in one ZIP archive"
                          >
                            <Headphones size={13} className={audioZipLoading ? 'animate-bounce' : ''} />
                            <span>
                              {audioZipLoading ? 'Downloading…' : 'Download Audio Clips (.zip)'}
                            </span>
                            <span className="px-1.5 py-0.5 bg-emerald-800/80 text-[11px] rounded-full text-emerald-200 font-mono">
                              47 clips
                            </span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Quick Speaker Selector & Angela Quick Actions */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs border-t border-slate-800/60 mt-1">
                    <div className="flex items-center gap-2 overflow-x-auto pb-0.5 max-w-full">
                      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex-shrink-0 flex items-center gap-1">
                        <Users size={11} className="text-emerald-400" /> Featured Speaker:
                      </span>
                      <button
                        onClick={() => {
                          setSelectedGlobalSpeaker(selectedGlobalSpeaker === 'Angela' ? 'ALL' : 'Angela');
                          if (!globalIndex && !globalIndexLoading) loadGlobalIndex();
                        }}
                        className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 flex-shrink-0 transition-all cursor-pointer border ${
                          selectedGlobalSpeaker === 'Angela'
                            ? 'bg-emerald-600 border-emerald-500 text-white shadow-md ring-1 ring-emerald-400'
                            : 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300 hover:bg-emerald-900/50 hover:text-white'
                        }`}
                        title="Filter all spaces featuring Angela"
                      >
                        <span>⭐ Angela</span>
                        <span className="text-[11px] opacity-80">({angelaEpisodeCount} spaces)</span>
                      </button>
                      <button
                        onClick={() => handleDownloadSpeakerZip('Angela')}
                        disabled={speakerZipLoading}
                        className="px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 flex-shrink-0 bg-slate-900/90 border border-slate-800 text-slate-300 hover:text-emerald-300 hover:border-emerald-500/40 transition-colors cursor-pointer shadow-sm"
                        title="Directly download all Angela transcripts as a single ZIP file"
                      >
                        <FileText size={11} className="text-emerald-400" />
                        <span>Download Angela ({angelaEpisodeCount} Spaces .zip)</span>
                      </button>
                      <button
                        onClick={() => handleDownloadSpeakerAudioZip('Angela')}
                        disabled={audioZipLoading}
                        className="px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 flex-shrink-0 bg-emerald-950/70 border border-emerald-500/50 text-emerald-300 hover:bg-emerald-900/80 hover:text-white transition-all cursor-pointer shadow-sm"
                        title="Directly download all 47 master audio clips of Angela as a single ZIP archive (.wav & .mp3)"
                      >
                        <Headphones size={11} className="text-emerald-400" />
                        <span>Download Audio Clips (47 Clips .zip)</span>
                      </button>
                    </div>

                    {selectedGlobalSpeaker !== 'ALL' && (
                      <button
                        onClick={() => setSelectedGlobalSpeaker('ALL')}
                        className="text-[11px] text-slate-400 hover:text-slate-200 underline ml-auto"
                      >
                        Reset speaker filter
                      </button>
                    )}
                  </div>

                  {/* Thematic Category Dossier Chips */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-800/60 mt-1">
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1 mr-1">
                      <Tag size={10} className="text-indigo-400" /> Dossier Themes:
                    </span>
                    {THEMATIC_CATEGORIES.map(cat => {
                      const isSelected = selectedCategory === cat.id;
                      return (
                        <button
                          key={cat.id}
                          onClick={() => {
                            setSelectedCategory(isSelected ? 'ALL' : cat.id);
                            if (!globalIndex && !globalIndexLoading) loadGlobalIndex();
                          }}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer border ${
                            isSelected
                              ? 'bg-indigo-600 border-indigo-400 text-white shadow-md ring-1 ring-indigo-300'
                              : 'bg-slate-900/80 border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white'
                          }`}
                          title={`Filter quotes in theme: ${cat.name}`}
                        >
                          <span>{cat.emoji}</span>
                          <span>{cat.name}</span>
                        </button>
                      );
                    })}
                    {selectedCategory !== 'ALL' && (
                      <button
                        onClick={() => setSelectedCategory('ALL')}
                        className="text-[11px] text-slate-400 hover:text-slate-300 underline ml-1 cursor-pointer"
                      >
                        Clear theme
                      </button>
                    )}
                  </div>

                  {/* Smart Banner if searching for 'angela' while not filtered to Angela */}
                  {search.trim().toLowerCase().includes('angela') && selectedGlobalSpeaker !== 'Angela' && (
                    <div className="flex items-center justify-between p-2.5 px-3.5 bg-emerald-950/40 border border-emerald-500/30 rounded-xl text-xs text-emerald-200 shadow-sm gap-2">
                      <div className="flex items-center gap-2">
                        <Users size={13} className="text-emerald-400 flex-shrink-0" />
                        <span>Looking for <strong>Angela</strong>? Filter all {angelaEpisodeCount} spaces featuring her and download transcripts or audio clips.</span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() => {
                            setSelectedGlobalSpeaker('Angela');
                            if (!globalIndex && !globalIndexLoading) loadGlobalIndex();
                          }}
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg text-xs cursor-pointer transition-colors"
                        >
                          Select Angela
                        </button>
                        <button
                          onClick={() => handleDownloadSpeakerZip('Angela')}
                          disabled={speakerZipLoading}
                          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-lg text-xs cursor-pointer transition-colors flex items-center gap-1 border border-slate-700"
                        >
                          <FileText size={11} className="text-emerald-400" />
                          Transcripts .zip
                        </button>
                        <button
                          onClick={() => handleDownloadSpeakerAudioZip('Angela')}
                          disabled={audioZipLoading}
                          className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-600 text-white font-semibold rounded-lg text-xs cursor-pointer transition-colors flex items-center gap-1 shadow-sm"
                        >
                          <Headphones size={11} />
                          Audio Clips .zip
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Speaker Zip Progress Status Bar */}
                  {speakerZipProgress && (
                    <div className="p-3 bg-emerald-950/70 border border-emerald-500/40 rounded-xl text-xs text-emerald-200 shadow-lg space-y-2">
                      <div className="flex items-center justify-between font-semibold">
                        <span className="flex items-center gap-2">
                          <Loader size={13} className="animate-spin text-emerald-400" />
                          <span>{speakerZipProgress.currentTitle}</span>
                        </span>
                        <span className="text-emerald-400 font-mono">{speakerZipProgress.percent}%</span>
                      </div>
                      <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-emerald-500 h-full transition-all duration-200"
                          style={{ width: `${speakerZipProgress.percent}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Speaker Zip Success Banner */}
                  {speakerZipSuccess && (
                    <div className="flex items-center justify-between p-3 bg-emerald-950/60 border border-emerald-500/30 rounded-xl text-xs text-emerald-200 shadow-md">
                      <span className="flex items-center gap-2 font-medium">
                        <CheckCircle2 size={14} className="text-emerald-400" />
                        <span>{speakerZipSuccess}</span>
                      </span>
                      <button onClick={() => setSpeakerZipSuccess(null)} className="text-emerald-400 hover:text-white p-1">
                        <X size={13} />
                      </button>
                    </div>
                  )}

                  {/* Speaker Zip Error Banner */}
                  {speakerZipError && (
                    <div className="flex items-center justify-between p-3 bg-rose-950/60 border border-rose-500/30 rounded-xl text-xs text-rose-200 shadow-md">
                      <span className="flex items-center gap-2 font-medium">
                        <AlertCircle size={14} className="text-rose-400" />
                        <span>{speakerZipError}</span>
                      </span>
                      <button onClick={() => setSpeakerZipError(null)} className="text-rose-400 hover:text-white p-1">
                        <X size={13} />
                      </button>
                    </div>
                  )}

                  {/* Audio Zip Progress Status Bar */}
                  {audioZipProgress && (
                    <div className="p-3 bg-emerald-950/70 border border-emerald-500/40 rounded-xl text-xs text-emerald-200 shadow-lg space-y-2">
                      <div className="flex items-center justify-between font-semibold">
                        <span className="flex items-center gap-2">
                          <Loader size={13} className="animate-spin text-emerald-400" />
                          <span>{audioZipProgress.currentTitle}</span>
                        </span>
                        <span className="text-emerald-400 font-mono">{audioZipProgress.percent}%</span>
                      </div>
                      <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-emerald-500 h-full transition-all duration-300"
                          style={{ width: `${audioZipProgress.percent}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Audio Zip Success Banner */}
                  {audioZipSuccess && (
                    <div className="flex items-center justify-between p-3 bg-emerald-950/60 border border-emerald-500/30 rounded-xl text-xs text-emerald-200 shadow-md">
                      <span className="flex items-center gap-2 font-medium">
                        <CheckCircle2 size={14} className="text-emerald-400" />
                        <span>{audioZipSuccess}</span>
                      </span>
                      <button onClick={() => setAudioZipSuccess(null)} className="text-emerald-400 hover:text-white p-1">
                        <X size={13} />
                      </button>
                    </div>
                  )}

                  {/* Audio Zip Error Banner */}
                  {audioZipError && (
                    <div className="flex items-center justify-between p-3 bg-rose-950/60 border border-rose-500/30 rounded-xl text-xs text-rose-200 shadow-md">
                      <span className="flex items-center gap-2 font-medium">
                        <AlertCircle size={14} className="text-rose-400" />
                        <span>{audioZipError}</span>
                      </span>
                      <button onClick={() => setAudioZipError(null)} className="text-rose-400 hover:text-white p-1">
                        <X size={13} />
                      </button>
                    </div>
                  )}

                  {/* Results View Mode Toggle (All Spoken Turns vs Master Audio Clips Archive) */}
                  {selectedGlobalSpeaker.toLowerCase() === 'angela' && extractedAudioClips.length > 0 && (
                    <div className="flex items-center justify-between gap-3 p-2 bg-slate-950/80 border border-emerald-500/30 rounded-xl flex-wrap">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                          <Layers size={11} className="text-emerald-400" /> Mode:
                        </span>
                        <button
                          onClick={() => setActiveResultsView('turns')}
                          className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                            activeResultsView === 'turns'
                              ? 'bg-slate-800 border border-slate-700 text-white shadow-sm ring-1 ring-slate-600'
                              : 'bg-slate-900/60 border border-slate-800 text-slate-400 hover:text-white'
                          }`}
                        >
                          <FileText size={11} />
                          <span>All Spoken Turns ({globalAllMatches.length.toLocaleString()})</span>
                        </button>
                        <button
                          onClick={() => setActiveResultsView('clips')}
                          className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                            activeResultsView === 'clips'
                              ? 'bg-emerald-600 border border-emerald-500 text-white shadow-md ring-1 ring-emerald-400'
                              : 'bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-900/50 hover:text-white'
                          }`}
                        >
                          <Headphones size={11} className="text-emerald-300" />
                          <span>Angela Audio Clips Archive ({extractedAudioClips.length} Master Cuts)</span>
                          <span className="px-1.5 py-0.2 bg-emerald-950/80 text-[11px] rounded-full text-emerald-200 font-mono">
                            38.6 MB
                          </span>
                        </button>
                      </div>

                      <button
                        onClick={() => handleDownloadSpeakerAudioZip('Angela')}
                        disabled={audioZipLoading}
                        className="flex items-center gap-1.5 px-3 py-1 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-all cursor-pointer whitespace-nowrap ml-auto"
                        title="Download all 47 master audio clips of Angela as a single ZIP archive (.wav & .mp3, 38.6 MB)"
                      >
                        <Download size={11} className={audioZipLoading ? 'animate-bounce' : ''} />
                        <span>Download All Audio Clips (.zip)</span>
                      </button>
                    </div>
                  )}

                  {/* Episode Match Pills (if multiple episodes have results) */}
                  {isGlobalFilteringActive && activeResultsView === 'turns' && (globalResultEpisodeCounts.length > 1 || selectedGlobalTag !== 'ALL') && (
                    <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-0.5 text-xs">
                      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex-shrink-0">
                        Episodes ({globalResultEpisodeCounts.length}):
                      </span>
                      <button
                        onClick={() => setSelectedGlobalTag('ALL')}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex-shrink-0 transition-colors cursor-pointer ${
                          selectedGlobalTag === 'ALL'
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : 'bg-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        All ({globalAllMatches.length})
                      </button>
                      {globalResultEpisodeCounts.map(ep => (
                        <button
                          key={ep.tag}
                          onClick={() => setSelectedGlobalTag(ep.tag)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium flex-shrink-0 transition-colors cursor-pointer border ${
                            selectedGlobalTag === ep.tag
                              ? 'bg-indigo-600/30 border-indigo-500/60 text-white shadow-sm'
                              : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                          }`}
                        >
                          <span className="font-semibold">{ep.title}</span>
                          <span className="ml-1 text-slate-400 opacity-80">({ep.count})</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Global Feed Content */}
                <div className="flex-1 overflow-y-auto p-4 md:p-8 bg-slate-950">
                  {globalIndexError && (
                    <div className="max-w-2xl mx-auto p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-xs shadow-lg space-y-2">
                      <p className="font-semibold flex items-center gap-2"><AlertCircle size={15} className="text-rose-400" /> Could not load search index</p>
                      <p className="opacity-90 pl-6">{globalIndexError}</p>
                      <div className="pl-6 pt-1">
                        <button
                          onClick={() => {
                            setGlobalIndex(null);
                            loadGlobalIndex();
                          }}
                          className="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-semibold cursor-pointer transition-colors"
                        >
                          Retry Loading Index
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Empty Search State: Discovery & Topics */}
                  {!isGlobalFilteringActive && (
                    <div className="max-w-4xl mx-auto space-y-8 py-6">
                      <div className="text-center space-y-3">
                        <div className="w-14 h-14 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto text-indigo-400 shadow-xl">
                          <Globe size={26} />
                        </div>
                        <h3 className="text-xl font-bold text-white tracking-tight">Global Transcript Search</h3>
                        <p className="text-xs text-slate-400 max-w-lg mx-auto leading-relaxed">
                          Search across all {summaryIndex?.length || globalIndex?.length || 241} recorded Twitter Spaces with over {(totalGlobalSegments > 0 ? totalGlobalSegments : 359134).toLocaleString()} transcribed and diarized speaker turns. Filter by any speaker or keyword, and click any turn to listen with live audio sync.
                        </p>
                      </div>

                      {/* Popular topics */}
                      <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-5 shadow-lg space-y-3">
                        <div className="flex items-center gap-2 text-xs font-bold text-slate-300 uppercase tracking-wider">
                          <Sparkles size={13} className="text-amber-400" />
                          <span>Suggested Searches & Highlights</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {POPULAR_SEARCH_TOPICS.map(topic => (
                            <button
                              key={topic}
                              onClick={() => setSearch(topic)}
                              className="px-3 py-1.5 bg-slate-950 hover:bg-indigo-600/20 border border-slate-800 hover:border-indigo-500/40 rounded-lg text-xs text-slate-300 hover:text-white transition-all cursor-pointer shadow-sm hover:scale-105"
                            >
                              🔍 {topic}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Featured Speaker Archive & Bulk Downloads */}
                      <div className="bg-slate-900/60 border border-emerald-500/30 rounded-xl p-5 shadow-lg space-y-3.5">
                        <div className="flex items-center justify-between text-xs font-bold text-slate-300 uppercase tracking-wider flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            <Users size={14} className="text-emerald-400" />
                            <span>Featured Speaker Archive & Bulk Downloads</span>
                          </div>
                          <span className="text-[11px] text-slate-400 normal-case font-normal">
                            Filter dialogue or download complete collections as a ZIP archive
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                          {/* Angela Highlight Card */}
                          <div className="p-3.5 bg-slate-900 border border-emerald-500/40 rounded-xl space-y-2.5 hover:border-emerald-400 transition-colors shadow-md">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-emerald-100 text-sm flex items-center gap-1.5">
                                <span>⭐ Angela</span>
                              </span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] font-semibold px-2 py-0.5 bg-emerald-500/20 text-emerald-300 rounded-md">
                                  {angelaEpisodeCount} spaces
                                </span>
                                <span className="text-[11px] font-semibold px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-md flex items-center gap-1">
                                  <Headphones size={10} /> 47 clips
                                </span>
                              </div>
                            </div>
                            <p className="text-[11px] text-slate-400">
                              Browse all conversations featuring Angela, download all {angelaEpisodeCount} complete transcripts, or download all 47 master audio clips (.wav & .mp3) in one ZIP archive.
                            </p>
                            <div className="flex items-center gap-2 pt-1 flex-wrap">
                              <button
                                onClick={() => {
                                  setSelectedGlobalSpeaker('Angela');
                                  if (!globalIndex && !globalIndexLoading) loadGlobalIndex();
                                }}
                                className="flex-1 min-w-[70px] py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold text-center cursor-pointer transition-colors"
                              >
                                View Turns
                              </button>
                              <button
                                onClick={() => handleDownloadSpeakerZip('Angela')}
                                disabled={speakerZipLoading}
                                className="flex-1 min-w-[90px] py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer transition-colors"
                                title="Download all text transcripts in one ZIP"
                              >
                                <FileText size={11} className="text-emerald-400" />
                                <span>Transcripts</span>
                              </button>
                              <button
                                onClick={() => handleDownloadSpeakerAudioZip('Angela')}
                                disabled={audioZipLoading}
                                className="flex-1 min-w-[100px] py-1.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer transition-colors shadow-sm"
                                title="Download all 47 master audio clips of Angela in one ZIP"
                              >
                                <Headphones size={11} />
                                <span>Audio Clips</span>
                              </button>
                            </div>
                          </div>

                          {/* Top Other Speakers */}
                          {allArchiveSpeakers.filter(s => s.name.toLowerCase() !== 'angela' && !/^Speaker\s*\d+$/i.test(s.name)).slice(0, 2).map(spk => (
                            <div key={spk.name} className="p-3.5 bg-slate-950/60 border border-slate-800 rounded-xl space-y-2 hover:border-slate-700 transition-colors">
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-slate-200 text-sm truncate">{spk.name}</span>
                                <span className="text-[11px] font-semibold px-2 py-0.5 bg-slate-800 text-slate-400 rounded-md">
                                  {spk.episodeCount} spaces
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-400 truncate">
                                Spoken turns across {spk.episodeCount} archived spaces.
                              </p>
                              <div className="flex items-center gap-2 pt-1">
                                <button
                                  onClick={() => {
                                    setSelectedGlobalSpeaker(spk.name);
                                    if (!globalIndex && !globalIndexLoading) loadGlobalIndex();
                                  }}
                                  className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold text-center cursor-pointer transition-colors"
                                >
                                  View Turns
                                </button>
                                <button
                                  onClick={() => handleDownloadSpeakerZip(spk.name)}
                                  disabled={speakerZipLoading}
                                  className="flex-1 py-1.5 bg-slate-800 hover:bg-emerald-600 text-slate-300 hover:text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer transition-colors"
                                >
                                  <Download size={11} />
                                  <span>Download .zip</span>
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Episode Directory Overview */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                            Indexed Space Library ({summaryIndex?.length || globalIndex?.length || 241} Episodes)
                          </span>
                          <span className="text-[11px] text-slate-400">
                            {totalGlobalSegments.toLocaleString()} total spoken turns
                          </span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {(summaryIndex || globalIndex || []).map(ep => (
                            <div
                              key={ep.release_tag}
                              onClick={() => {
                                const rel = effectiveReleases.find(r => r.id === ep.release_id || r.tag_name === ep.release_tag);
                                if (rel) {
                                  setSelectedId(rel.id);
                                  loadTranscript(rel);
                                  setSearchScope('current');
                                }
                              }}
                              className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/80 hover:bg-slate-900 hover:border-indigo-500/40 transition-all cursor-pointer group shadow-sm flex items-start justify-between gap-3"
                            >
                              <div className="min-w-0">
                                <h4 className="text-xs font-bold text-slate-200 group-hover:text-white truncate">
                                  {ep.title || ep.release_tag}
                                </h4>
                                <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-2">
                                  <span>{getEpisodeRecordedDate({ tag_name: ep.release_tag, name: ep.title, published_at: ep.published_at }).displayDate}</span>
                                  <span>•</span>
                                  <span className="text-indigo-400 font-medium">{(ep.segment_count || (ep as any).segments?.length || 0).toLocaleString()} turns</span>
                                </p>
                              </div>
                              <ArrowRight size={13} className="text-slate-500 group-hover:text-indigo-400 transition-colors flex-shrink-0 mt-1" />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Loading State when globalIndex is still fetching */}
                  {isGlobalFilteringActive && globalIndexLoading && (
                    <div className="flex flex-col items-center justify-center py-20 text-center max-w-md mx-auto space-y-3">
                      <Loader size={32} className="animate-spin text-indigo-400" />
                      <p className="text-sm font-semibold text-slate-200">
                        Loading dialogue segments…
                      </p>
                      <p className="text-xs text-slate-400">
                        Searching across all recorded Twitter Spaces{selectedGlobalSpeaker !== 'ALL' ? ` for "${selectedGlobalSpeaker}"` : ''}…
                      </p>
                    </div>
                  )}

                  {/* Active Filtering: 0 matches */}
                  {isGlobalFilteringActive && !globalIndexLoading && globalSearchResults.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-24 text-center text-slate-400 max-w-md mx-auto">
                      <Search size={36} className="mb-3 text-slate-500" />
                      <p className="text-sm font-semibold text-slate-300">
                        {selectedGlobalSpeaker !== 'ALL' && search.trim()
                          ? `No turns match "${search}" spoken by ${selectedGlobalSpeaker}.`
                          : selectedGlobalSpeaker !== 'ALL'
                          ? `No turns found for speaker "${selectedGlobalSpeaker}".`
                          : `No turns match "${search}" across all ${summaryIndex?.length || globalIndex?.length || 241} transcripts.`}
                      </p>
                      <p className="text-xs text-slate-400 mt-1.5">
                        Try clearing filters or checking spelling.
                      </p>
                      <div className="flex items-center gap-2 mt-4 flex-wrap justify-center">
                        {search && (
                          <button
                            onClick={() => setSearch('')}
                            className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                          >
                            Clear Search Term
                          </button>
                        )}
                        {selectedGlobalSpeaker !== 'ALL' && (
                          <button
                            onClick={() => setSelectedGlobalSpeaker('ALL')}
                            className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                          >
                            Reset Speaker Filter
                          </button>
                        )}
                        {selectedGlobalTag !== 'ALL' && (
                          <button
                            onClick={() => setSelectedGlobalTag('ALL')}
                            className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                          >
                            All Episodes
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Active Filtering: Results List */}
                  {isGlobalFilteringActive && globalSearchResults.length > 0 && (
                    <div className="max-w-4xl mx-auto space-y-3.5 pb-24">
                      {/* Summary Banner */}
                      <div className="flex items-center justify-between p-3.5 bg-indigo-950/40 border border-indigo-500/20 rounded-xl text-xs text-indigo-200 shadow-md flex-wrap gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-white">
                            Showing {globalSearchResults.length.toLocaleString()} of {globalAllMatches.length.toLocaleString()} spoken turns
                          </span>
                          {selectedGlobalSpeaker !== 'ALL' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[11px] font-medium">
                              <Users size={10} /> {selectedGlobalSpeaker}
                            </span>
                          )}
                          {search.trim() && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-[11px] font-medium">
                              <Search size={10} /> "{search.trim()}"
                            </span>
                          )}
                          {selectedGlobalTag !== 'ALL' ? (
                            <span className="text-slate-400">in selected episode</span>
                          ) : (
                            <span className="text-slate-400">
                              across {globalResultEpisodeCounts.length} episode{globalResultEpisodeCounts.length !== 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 ml-auto flex-shrink-0 flex-wrap">
                          {selectedGlobalSpeaker !== 'ALL' && (
                            <>
                              <button
                                onClick={() => handleDownloadSpeakerZip(selectedGlobalSpeaker)}
                                disabled={speakerZipLoading}
                                className="flex items-center gap-1.5 px-3 py-1 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 border border-slate-700 text-slate-200 rounded-lg text-xs font-semibold shadow-sm transition-all cursor-pointer"
                                title={`Download all transcripts featuring ${selectedGlobalSpeaker} in one ZIP archive`}
                              >
                                <FileText size={12} className={speakerZipLoading ? 'animate-bounce text-emerald-400' : 'text-emerald-400'} />
                                <span>
                                  {speakerZipLoading
                                    ? 'Creating ZIP…'
                                    : `Download All ${selectedSpeakerEpisodeCount} Transcripts (.zip)`}
                                </span>
                              </button>
                              {selectedGlobalSpeaker.toLowerCase() === 'angela' && (
                                <button
                                  onClick={() => handleDownloadSpeakerAudioZip('Angela')}
                                  disabled={audioZipLoading}
                                  className="flex items-center gap-1.5 px-3 py-1 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-sm transition-all cursor-pointer"
                                  title="Download all 47 master audio clips of Angela in one ZIP archive (.wav & .mp3, 38.6 MB)"
                                >
                                  <Headphones size={12} className={audioZipLoading ? 'animate-bounce' : ''} />
                                  <span>
                                    {audioZipLoading
                                      ? 'Downloading Audio ZIP…'
                                      : 'Download All 47 Audio Clips (.zip)'}
                                  </span>
                                </button>
                              )}
                            </>
                          )}
                          <button
                            onClick={() => {
                              setSearch('');
                              setSelectedGlobalSpeaker('ALL');
                              setSelectedGlobalTag('ALL');
                            }}
                            className="text-xs text-indigo-400 hover:text-white underline cursor-pointer"
                          >
                            Clear all filters
                          </button>
                        </div>
                      </div>

                      {activeResultsView === 'clips' && selectedGlobalSpeaker.toLowerCase() === 'angela' ? (
                        <div className="space-y-3">
                          <div className="p-4 bg-slate-900 border border-emerald-500/40 rounded-xl shadow-lg flex items-center justify-between flex-wrap gap-3">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="p-1.5 bg-emerald-500/20 text-emerald-300 rounded-lg">
                                  <Headphones size={18} />
                                </span>
                                <h3 className="font-bold text-white text-base">Angela Maggard — Master Audio Clips Archive</h3>
                                <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-semibold rounded-full">
                                  {filteredClips.length} Clips
                                </span>
                              </div>
                              <p className="text-xs text-slate-300 max-w-2xl">
                                Extracted high-fidelity audio cuts ({filteredClips.filter(c => c.format === 'wav').length} lossless WAV space cuts + {filteredClips.filter(c => c.format === 'mp3').length} producer MP3 quote drops). Total archive size: 38.6 MB.
                              </p>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <button
                                onClick={() => handleDownloadSpeakerAudioZip('Angela')}
                                disabled={audioZipLoading}
                                className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-semibold rounded-lg text-xs flex items-center gap-2 shadow-md cursor-pointer transition-all"
                                title="Download complete zip of all 47 audio clips"
                              >
                                <Download size={14} className={audioZipLoading ? 'animate-bounce' : ''} />
                                <span>{audioZipLoading ? 'Downloading…' : 'Download All Clips (.zip)'}</span>
                              </button>
                              <button
                                onClick={() => handleDownloadSpeakerZip('Angela')}
                                disabled={speakerZipLoading}
                                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold rounded-lg text-xs flex items-center gap-1.5 cursor-pointer transition-colors"
                                title="Download complete zip of all 19 text transcripts"
                              >
                                <FileText size={13} className="text-emerald-400" />
                                <span>Download Transcripts (.zip)</span>
                              </button>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 gap-3">
                            {filteredClips.map((clip, cIdx) => {
                              const isPlayingThisClip = current?.audioUrl === `./${clip.url}` && isPlaying;
                              return (
                                <div
                                  key={clip.id}
                                  className={`p-4 rounded-xl border transition-all ${
                                    isPlayingThisClip
                                      ? 'bg-emerald-950/40 border-emerald-500/80 shadow-xl ring-1 ring-emerald-500/40'
                                      : 'bg-slate-900/60 border-slate-800 hover:border-emerald-500/40 hover:bg-slate-900'
                                  }`}
                                >
                                  <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 font-mono text-[11px] font-bold border border-emerald-500/30">
                                        #{String(cIdx + 1).padStart(2, '0')}
                                      </span>
                                      <span className="font-semibold text-slate-200 text-xs truncate max-w-md">
                                        {clip.title}
                                      </span>
                                      <span className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-400 text-[11px] font-bold uppercase">
                                        {clip.format} • {Math.round((clip.size_bytes || 0) / 1024)} KB
                                      </span>
                                      {clip.timestamp && (
                                        <span className="text-[11px] text-slate-400 font-mono">
                                          ⏱ {clip.timestamp}
                                        </span>
                                      )}
                                    </div>

                                    <div className="flex items-center gap-1.5 ml-auto">
                                      <button
                                        onClick={() => handlePlayClipAudio(clip)}
                                        className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                                          isPlayingThisClip
                                            ? 'bg-emerald-500 text-white shadow'
                                            : 'bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30'
                                        }`}
                                      >
                                        {isPlayingThisClip ? <Pause size={11} /> : <Play size={11} className="translate-x-0.5" />}
                                        <span>{isPlayingThisClip ? 'Pause' : 'Play'}</span>
                                      </button>
                                      <button
                                        onClick={() => handleDownloadSingleClip(clip)}
                                        className="flex items-center gap-1 px-3 py-1 bg-slate-800 hover:bg-emerald-600 text-slate-300 hover:text-white rounded-lg text-xs font-semibold transition-colors border border-slate-700 cursor-pointer shadow-sm"
                                        title={`Download ${clip.filename}`}
                                      >
                                        <Download size={11} />
                                        <span>Download .{clip.format}</span>
                                      </button>
                                      <button
                                        onClick={() => {
                                          addClip({
                                            title: clip.title,
                                            quote: clip.quote || clip.title,
                                            speaker: 'Angela',
                                            sourceTitle: clip.space_title || 'Angela Space Audio Clip',
                                            sourceTag: clip.space_tag,
                                            audioUrl: `./${clip.url}`,
                                            startSec: 0,
                                            endSec: 30,
                                            category: 'threat',
                                            severity: 9,
                                          });
                                        }}
                                        className="flex items-center gap-1 px-3 py-1 bg-indigo-500/20 hover:bg-indigo-600 text-indigo-300 hover:text-white rounded-lg text-xs font-semibold transition-colors border border-indigo-500/40 cursor-pointer shadow-sm"
                                        title="Add clip into Montage Reel"
                                      >
                                        <Film size={11} className="text-indigo-400" />
                                        <span>+ Reel</span>
                                      </button>
                                    </div>
                                  </div>

                                  <p className="text-sm text-slate-100 font-medium italic leading-relaxed pl-2 border-l-2 border-emerald-500/60 my-2">
                                    "{clip.quote}"
                                  </p>

                                  {clip.space_title && (
                                    <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-2">
                                      <Radio size={11} className="text-emerald-400" />
                                      <span>From Space: <strong className="text-slate-300">{clip.space_title}</strong></span>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <>
                          {globalSearchResults.map((res, idx) => {
                          const theme = getSpeakerTheme(res.segment.speaker, savedSpeakers);
                          const matchedClip = getMatchingExtractedClip(res);
                          const effectiveGlobalTime = currentTime - audioSeekOffsetSec;
                          const isPlayingThis = (current?.id === res.release_id || (matchedClip && current?.audioUrl === `./${matchedClip.url}`)) && isPlaying &&
                            ((matchedClip && current?.audioUrl === `./${matchedClip.url}`) || (effectiveGlobalTime >= res.segment.start &&
                            effectiveGlobalTime <= (res.segment.end !== null && res.segment.end > res.segment.start ? res.segment.end : res.segment.start + 30)));
                          const initialChar = res.segment.speaker.replace(/^Speaker\s+/i, '').trim().charAt(0).toUpperCase() || 'S';

                          let searchWordIndex = -1;
                          let searchWords: UtteranceWord[] = [];
                          if (isPlayingThis) {
                            searchWords = getUtteranceWords({
                              text: res.segment.text,
                              startSec: res.segment.start,
                              endSec: res.segment.end,
                              words: (res.segment as any).words,
                            });
                            for (let wI = 0; wI < searchWords.length; wI++) {
                              const wObj = searchWords[wI];
                              const nextStart = wI < searchWords.length - 1 ? searchWords[wI + 1].start : (wObj.end + 0.8);
                              if (effectiveGlobalTime >= wObj.start && effectiveGlobalTime < nextStart) {
                                searchWordIndex = wI;
                                break;
                              }
                            }
                            if (searchWordIndex === -1 && searchWords.length > 0 && effectiveGlobalTime >= res.segment.start && effectiveGlobalTime < searchWords[0].start) {
                              searchWordIndex = 0;
                            }
                            if (searchWordIndex === -1 && searchWords.length > 0 && effectiveGlobalTime >= searchWords[searchWords.length - 1].start) {
                              searchWordIndex = searchWords.length - 1;
                            }
                          }

                          return (
                            <div
                              key={`${res.release_tag}-${res.segmentIndex}-${idx}`}
                              style={{ contentVisibility: 'auto', containIntrinsicSize: '120px' }}
                              className={`group flex items-start gap-3.5 p-4 rounded-xl border transition-all relative ${
                                isPlayingThis
                                  ? 'bg-indigo-950/40 border-indigo-500/80 shadow-xl ring-1 ring-indigo-500/40'
                                  : 'bg-slate-900/50 border-slate-800/80 hover:bg-slate-900 hover:border-slate-700/80 hover:shadow-md'
                              }`}
                            >
                              {/* Speaker Avatar */}
                              <div
                                className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs flex-shrink-0 shadow-sm mt-0.5 ${theme.avatar}`}
                                title={res.segment.speaker}
                              >
                                {theme.emoji ? <span className="text-base select-none">{theme.emoji}</span> : <span>{initialChar}</span>}
                              </div>

                              {/* Content */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    {/* Episode badge */}
                                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-800/90 text-slate-300 text-[11px] font-semibold border border-slate-700/60 max-w-xs truncate">
                                      <Radio size={10} className="text-indigo-400 flex-shrink-0" />
                                      <span className="truncate">{res.title}</span>
                                    </span>

                                    {/* Speaker pill */}
                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-xs font-semibold ${theme.badge}`}>
                                      {theme.emoji ? <span className="text-xs">{theme.emoji}</span> : <span className={`w-1.5 h-1.5 rounded-full ${theme.dot}`} />}
                                      <span>{res.segment.speaker}</span>
                                    </span>

                                    {/* Verified Audio Clip Badge */}
                                    {matchedClip && (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-950/90 border border-emerald-500/50 text-[11px] font-bold text-emerald-300 shadow-sm" title={`Verified extracted audio clip: ${matchedClip.filename}`}>
                                        <Sparkles size={9} className="text-emerald-400" />
                                        <span>Audio Clip ({matchedClip.format?.toUpperCase()})</span>
                                      </span>
                                    )}

                                    {/* Timestamp seek button */}
                                    <button
                                      onClick={() => handlePlayGlobalResult(res)}
                                      className="inline-flex items-center gap-1 text-[11px] font-mono font-medium px-2 py-0.5 rounded-md bg-slate-800/80 hover:bg-indigo-500/20 text-slate-400 hover:text-indigo-300 border border-slate-700/60 transition-colors cursor-pointer"
                                      title="Seek to timestamp"
                                    >
                                      <Play size={9} className="text-indigo-400 fill-indigo-400/40" />
                                      <span>{formatSeconds(res.segment.start)}</span>
                                      {res.segment.end !== null && <span className="text-slate-400 font-normal"> – {formatSeconds(res.segment.end)}</span>}
                                    </button>
                                  </div>

                                  {/* Action buttons */}
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    {matchedClip && (
                                      <button
                                        onClick={() => handleDownloadSingleClip(matchedClip)}
                                        className="flex items-center gap-1 px-2.5 py-1 bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 hover:text-white rounded-lg text-xs font-semibold transition-colors border border-emerald-500/40 cursor-pointer shadow-sm"
                                        title={`Download extracted audio clip: ${matchedClip.filename}`}
                                      >
                                        <Download size={11} className="text-emerald-400" />
                                        <span>Download Clip ({matchedClip.format?.toUpperCase()})</span>
                                      </button>
                                    )}

                                    <button
                                      onClick={() => {
                                        if (matchedClip) {
                                          handlePlayClipAudio(matchedClip);
                                        } else {
                                          handlePlayGlobalResult(res);
                                        }
                                      }}
                                      className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                                        isPlayingThis
                                          ? 'bg-indigo-500 text-white shadow'
                                          : 'bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30'
                                      }`}
                                      title={matchedClip ? `Listen to isolated audio clip: ${matchedClip.title}` : "Listen to this moment"}
                                    >
                                      {isPlayingThis ? <Pause size={11} /> : <Play size={11} className="translate-x-0.5" />}
                                      <span>{isPlayingThis ? 'Pause' : 'Play'}</span>
                                    </button>

                                    <button
                                      onClick={() => handleOpenInFullTranscript(res)}
                                      className="flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg text-xs font-medium transition-colors border border-slate-700 cursor-pointer"
                                      title="Open this episode's full transcript at this moment"
                                    >
                                      <FileText size={11} />
                                      <span>Open Transcript</span>
                                    </button>

                                    <button
                                      onClick={() => openQuickSlicer({
                                        speaker: res.segment.speaker,
                                        quote: res.segment.text,
                                        sourceTitle: res.title,
                                        sourceTag: res.release_tag,
                                        audioUrl: res.audio_url,
                                        startSec: res.segment.start,
                                        endSec: res.segment.end !== null && res.segment.end > res.segment.start ? res.segment.end : res.segment.start + 15,
                                        words: (res.segment as any).words,
                                      })}
                                      className="flex items-center gap-1 px-2.5 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 hover:text-white rounded-lg text-xs font-medium transition-colors border border-amber-500/30 cursor-pointer"
                                      title="Fine-tune boundaries and slice audio clip"
                                    >
                                      <Scissors size={11} className="text-amber-400" />
                                      <span>Slice</span>
                                    </button>

                                    <button
                                      onClick={() => handleAddTurnToMontage(
                                        res.segment.speaker,
                                        res.segment.text,
                                        res.segment.start,
                                        res.segment.end,
                                        res.audio_url,
                                        res.title,
                                        res.release_tag
                                      )}
                                      className="flex items-center gap-1 px-2.5 py-1 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 hover:text-white rounded-lg text-xs font-medium transition-colors border border-indigo-500/30 cursor-pointer"
                                      title="Add turn directly to Montage Reel Builder"
                                    >
                                      <Film size={11} className="text-indigo-400" />
                                      <span>+ Reel</span>
                                    </button>
                                  </div>
                                </div>

                              {/* Highlighted text */}
                              {isPlayingThis ? (
                                <p className="text-[14px] leading-relaxed select-text text-slate-100">
                                  {searchWords.map((w, wIdx) => {
                                    const isActiveWord = wIdx === searchWordIndex;
                                    const isPastWord = searchWordIndex >= 0 && wIdx < searchWordIndex;
                                    return (
                                      <React.Fragment key={wIdx}>
                                        <span
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const nowPlaying: NowPlayingEpisode = {
                                              id: res.release_id,
                                              title: res.title,
                                              audioUrl: res.audio_url,
                                            };
                                            const targetSeekSec = Math.max(0, w.start + audioSeekOffsetSec);
                                            if (current?.id !== res.release_id) {
                                              play(nowPlaying, targetSeekSec);
                                            } else {
                                              seek(targetSeekSec);
                                              if (!isPlaying) togglePlay();
                                            }
                                          }}
                                          className={`cursor-pointer transition-all duration-75 rounded px-1 -mx-0.5 py-0.5 ${
                                            isActiveWord
                                              ? 'bg-indigo-500 text-white font-bold shadow-md ring-1 ring-indigo-300/60 scale-[1.03] inline-block z-10'
                                              : isPastWord
                                              ? 'text-slate-100 font-medium hover:text-white hover:bg-slate-800/60'
                                              : 'text-slate-400 font-normal hover:text-slate-200 hover:bg-slate-800/40'
                                          }`}
                                          title={`Play from ${formatSeconds(w.start)}`}
                                        >
                                          {highlightMatch(w.word, search)}
                                        </span>
                                        {' '}
                                      </React.Fragment>
                                    );
                                  })}
                                </p>
                              ) : (
                                <p className="text-[14px] leading-relaxed text-slate-100 select-text">
                                  {highlightMatch(res.segment.text, search)}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {/* Load More Button */}
                      {globalAllMatches.length > globalSearchResults.length && (
                        <div className="pt-4 pb-12 flex flex-col items-center justify-center gap-2">
                          <p className="text-xs text-slate-400">
                            Showing {globalSearchResults.length.toLocaleString()} of {globalAllMatches.length.toLocaleString()} turns
                          </p>
                          <button
                            onClick={() => setGlobalDisplayLimit(prev => prev + 200)}
                            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition-all shadow-lg hover:scale-105 cursor-pointer flex items-center gap-2"
                          >
                            <span>Load More Turns (+200)</span>
                            <ChevronDown size={14} />
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
                </div>
              </div>
            ) : (
              !selectedRelease ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                  <ChevronDown size={28} className="text-slate-500 mb-3 rotate-90" />
                  <p className="text-slate-400 text-sm mb-3">Select an episode from the sidebar to view its transcript</p>
                  <button
                    onClick={() => { setSearchScope('all'); loadGlobalIndex(); }}
                    className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow-lg cursor-pointer transition-all hover:scale-105"
                  >
                    <Globe size={13} /> Or Search All Transcripts
                  </button>
                </div>
              ) : (
                <>
                  {/* Episode header */}
                  <EpisodeHeader
                    title={selectedRelease.name || selectedRelease.tag_name}
                    dateLabel={getEpisodeRecordedDate(selectedRelease).displayDate}
                    hostHandle={getEpisodeHandle(selectedRelease)?.replace(/^@/, '')}
                    runtimeLabel={getEpisodeRuntime(selectedRelease)}
                    turnCount={utterances.length}
                    speakerCount={speakerStats.length}
                    model={transcriptMetadata.model || undefined}
                    language={transcriptMetadata.language || undefined}
                    hasAudio={!!mp3Asset}
                    isCached={isCurrentAudioCached}
                    isCaching={isCachingCurrentAudio}
                    cachePct={currentAudioCachePct}
                    onToggleCache={handleToggleCacheCurrentAudio}
                    savedSpeakersCount={savedSpeakers.length}
                    onOpenSavedSpeakers={() => setShowSavedSpeakersModal(true)}
                    onOpenRename={() => setShowRenameModal(true)}
                    onOpenVoices={() => copilot.activePanelNavHandler?.('voice-profiles')}
                    canSave={!!Object.keys(speakerMap).length || timeOffsetSec !== 0}
                    saving={savingGitHub}
                    onSave={handleSaveToGitHub}
                    onOpenDrawer={() => setDrawerOpen(true)}
                    exportMenu={{
                      disabled: !utterances.length,
                      copied,
                      sourceUrl: sourceSpaceUrl(selectedRelease),
                      onPublishPreview: () => { setPublishMessage(null); setShowPublish(true); },
                      onCopy: handleCopyTranscript,
                      onDownload: handleDownloadTranscript,
                    }}
                  />

                  <SpeakerLane
                    turns={laneTurns}
                    duration={timelineDuration}
                    currentTime={isCurrentEpisodeLoaded ? Math.max(0, currentTime - audioSeekOffsetSec) : null}
                    speakerFilter={speakerFilter}
                    getDotClass={getLaneDotClass}
                    hotMarks={hotMarks}
                    bands={clipBandsForRelease(catalogClips, selectedRelease?.tag_name, config.clipMinScore ?? 7, config.clipMaxLengthSec ?? 180)}
                    onBandClick={band => handlePlayUtterance(band.startSec)}
                    onSeek={handlePlayUtterance}
                  />

                  <Transport
                    canPlay={!!mp3Asset}
                    isPlaying={isCurrentEpisodePlaying}
                    currentTime={isCurrentEpisodeLoaded ? currentTime : 0}
                    duration={isCurrentEpisodeLoaded && playerDuration > 0 ? playerDuration : (utterances[utterances.length - 1]?.endSec ?? utterances[utterances.length - 1]?.startSec ?? 0)}
                    onToggle={handlePlayEpisodeToggle}
                    onSkip={handleTransportSkip}
                    timeOffsetSec={timeOffsetSec}
                    audioSeekOffsetSec={audioSeekOffsetSec}
                    onTimeOffset={setAndSaveTimeOffset}
                    onAudioSeekOffset={setAndSaveAudioSeekOffset}
                    activeLabel={activeUtteranceIndex >= 0
                      ? `Active ${utterances[activeUtteranceIndex].startSec.toFixed(1)}s`
                      : undefined}
                  />

                  {saveGitHubSuccess && (
                    <div className="mx-4 md:mx-6 mt-3 flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-300 text-xs">
                      <CheckCircle2 size={15} className="text-emerald-400 flex-shrink-0" /><span>{saveGitHubSuccess}</span>
                    </div>
                  )}
                  {saveGitHubError && (
                    <div className="mx-4 md:mx-6 mt-3 flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-xs">
                      <AlertCircle size={15} className="text-rose-400 flex-shrink-0" /><span>{saveGitHubError}</span>
                    </div>
                  )}

                  {/* Multi-Part Episode Tabs */}
                  {episodeParts.length > 1 && (
                    <div className="px-4 md:px-6 py-2.5 bg-slate-900/80 border-b border-slate-800 flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Episode Parts:</span>
                        <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
                          {episodeParts.map(part => {
                            const isSelected = selectedPartNum === part.partNumber;
                            const hasTranscript = !!part.transcriptAsset;
                            return (
                              <button
                                key={part.partNumber}
                                onClick={() => {
                                  setSelectedPartNum(part.partNumber);
                                  if (part.transcriptAsset) {
                                    loadTranscript(selectedRelease, part.transcriptAsset, part.partNumber);
                                  } else {
                                    setTranscriptRaw('');
                                    setTranscriptError('');
                                  }
                                }}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                                  isSelected
                                    ? 'bg-indigo-600 text-white shadow-md'
                                    : 'text-slate-400 hover:text-white hover:bg-slate-800/80'
                                }`}
                              >
                                <span>{part.label}</span>
                                {hasTranscript ? (
                                  <span className={`text-[11px] px-1.5 py-0.5 rounded font-mono ${isSelected ? 'bg-indigo-700/80 text-white' : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'}`}>
                                    Transcript
                                  </span>
                                ) : (
                                  <span className={`text-[11px] px-1.5 py-0.5 rounded font-mono ${isSelected ? 'bg-indigo-700/80 text-white' : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'}`}>
                                    Audio Only
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      {activePart?.mp3Asset && (
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                          <span>Active Audio: <span className="font-mono text-slate-300">{activePart.label}</span></span>
                          <span className="text-slate-500">·</span>
                          <span className="font-mono text-slate-400">{formatSize(activePart.mp3Asset.size)}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Transcript */}
                  <ShortcutsOverlay open={showShortcuts} onClose={() => setShowShortcuts(false)} />
                  <PublishPreview
                    open={showPublish}
                    onClose={() => setShowPublish(false)}
                    feedUrl={feedUrl}
                    feedTitle={config.podcastTitle}
                    author={config.authorName}
                    artworkUrl={config.artworkDataUrl || config.imageUrl || null}
                    episodeTitle={selectedRelease?.name || selectedRelease?.tag_name || ''}
                    metaLine={[selectedRelease ? getEpisodeRecordedDate(selectedRelease).displayDate : '', selectedRelease ? getEpisodeRuntime(selectedRelease) : '', selectedRelease ? getEpisodeHandle(selectedRelease) : ''].filter(Boolean).join(' · ')}
                    chapters={previewChapters}
                    onSeekChapter={handlePlayUtterance}
                    feedCopied={feedCopied}
                    onCopyFeed={handleCopyFeed}
                    canPublish={hasCredentials}
                    publishing={publishing}
                    publishMessage={publishMessage}
                    onPublish={handlePublish}
                  />
                  <SelectionBar resolveTurn={resolveSelectionTurn} onClip={handleSelectionClip} onAsk={handleSelectionAsk} />

                  <TranscriptPane
                    search={search}
                    onSearch={setSearch}
                    matchCount={matchCount}
                    hasSearch={hasActiveSearch}
                    speakers={paneSpeakers}
                    speakerFilter={speakerFilter}
                    onSpeakerFilter={setSpeakerFilter}
                    follow={autoScroll}
                    onToggleFollow={() => { setAutoScroll(a => !a); lastAutoScrolledUtteranceRef.current = null; }}
                    onUserScroll={() => { if (isPlaying && autoScroll) setAutoScroll(false); }}
                    showJump={!autoScroll && isPlaying && !!activeUtteranceId}
                    onJump={() => { lastAutoScrolledUtteranceRef.current = null; setAutoScroll(true); }}
                  >
                    {transcriptLoading && (
                      <div className="flex flex-col items-center justify-center py-24 text-slate-400 gap-3">
                        <Loader size={26} className="animate-spin text-indigo-400" />
                        <span className="text-xs font-medium tracking-wide">Loading diarized transcript…</span>
                      </div>
                    )}

                    {transcriptError && (
                      <div className="max-w-2xl mx-auto p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-xs shadow-lg">
                        <p className="font-semibold flex items-center gap-2"><AlertCircle size={15} className="text-rose-400" /> Could not load transcript</p>
                        <p className="mt-1 opacity-90 pl-6">{transcriptError}</p>
                      </div>
                    )}

                    {!transcriptLoading && !transcriptError && !transcriptRaw && (
                      <QueuedEpisode
                        partLabel={episodeParts.length > 1 ? activePart?.label : undefined}
                        hasAudio={!!activePart?.mp3Asset}
                        isPlaying={isCurrentEpisodePlaying}
                        onTogglePlay={handlePlayEpisodeToggle}
                        position={selectedRelease ? (queuePositions.get(selectedRelease.tag_name) ?? null) : null}
                        queueLength={queuePositions.size || null}
                        stage={selectedRelease ? (queueStages.get(selectedRelease.tag_name) ?? null) : null}
                        transcribing={transcribing}
                        success={transcribeSuccess || null}
                        onPrioritize={handleGenerateTranscript}
                      />
                    )}

                    {!transcriptLoading && !transcriptError && transcriptRaw && filteredUtterances.length === 0 && (
                      <div className="flex flex-col items-center justify-center py-24 text-center text-slate-400 max-w-md mx-auto">
                        <Search size={32} className="mb-3 text-slate-500" />
                        <p className="text-sm font-medium text-slate-300">
                          {search ? `No speaker turns match "${search}" in this episode.` : 'No speaker turns match your filters.'}
                        </p>
                        {search ? (
                          <div className="flex items-center gap-3 mt-4">
                            <button
                              onClick={() => { setSearchScope('all'); loadGlobalIndex(); }}
                              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow-lg cursor-pointer transition-all hover:scale-105"
                            >
                              <Globe size={13} /> Search All {summaryIndex?.length || globalIndex?.length || 241} Transcripts for "{search}"
                            </button>
                            <button onClick={() => { setSearch(''); setSpeakerFilter('ALL'); }}
                              className="text-xs text-slate-400 hover:text-slate-300 underline cursor-pointer">
                              Clear search
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => { setSearch(''); setSpeakerFilter('ALL'); }}
                            className="mt-3 text-xs text-indigo-400 hover:text-indigo-300 underline cursor-pointer">
                            Reset filters
                          </button>
                        )}
                      </div>
                    )}

                    {!transcriptLoading && !transcriptError && filteredUtterances.length > 0 && (
                      <div className="max-w-5xl mx-auto space-y-0.5 pb-24">
                        {filteredUtterances.map((utterance, rowIdx) => {
                          const isActiveRow = activeUtteranceId === utterance.id;
                          let activeWordIndex = -1;
                          let utteranceWords: UtteranceWord[] = [];
                          if (isActiveRow) {
                            utteranceWords = getUtteranceWords(utterance);
                            const effectiveTime = currentTime - audioSeekOffsetSec;
                            for (let i = 0; i < utteranceWords.length; i++) {
                              const w = utteranceWords[i];
                              const nextStart = i < utteranceWords.length - 1 ? utteranceWords[i + 1].start : (w.end + 0.8);
                              if (effectiveTime >= w.start && effectiveTime < nextStart) {
                                activeWordIndex = i;
                                break;
                              }
                            }
                            if (activeWordIndex === -1 && utteranceWords.length > 0 && effectiveTime >= utterance.startSec && effectiveTime < utteranceWords[0].start) {
                              activeWordIndex = 0;
                            }
                            if (activeWordIndex === -1 && utteranceWords.length > 0 && effectiveTime >= utteranceWords[utteranceWords.length - 1].start) {
                              activeWordIndex = utteranceWords.length - 1;
                            }
                          }
                          return (
                            <TranscriptRow
                              key={utterance.id}
                              utterance={utterance}
                              theme={themeBySpeaker.get(utterance.speaker) ?? getSpeakerTheme(utterance.speaker, savedSpeakers)}
                              striped={rowIdx % 2 === 1}
                              active={isActiveRow}
                              words={utteranceWords}
                              activeWordIndex={activeWordIndex}
                              query={search}
                              highlight={highlightMatch}
                              isPlaying={isPlaying}
                              inSelection={false}
                              actions={rowActions}
                            />
                          );
                        })}
                      </div>
                    )}
                  </TranscriptPane>
                </>
              )
            )}
          </div>
        </div>
      )}

      {/* ── Quick Rename Single Speaker Modal ── */}
      <SpeakerRenameModal
        target={quickRenameTarget}
        onClose={() => setQuickRenameTarget(null)}
        onApply={(rawSpeaker: string, newName: string, color: string, emoji: string, addToSaved: boolean) => {
          saveSpeakerRename(rawSpeaker, newName);
          if (addToSaved) {
            addOrUpdatePermanentSpeaker({
              id: newName.toLowerCase().replace(/\s+/g, '-'),
              name: newName,
              avatarEmoji: emoji,
              color: color,
              role: 'Speaker',
            });
          }
          setQuickRenameTarget(null);
        }}
        onReset={(rawSpeaker: string) => saveSpeakerRename(rawSpeaker, '')}
        onOpenSavedModal={() => {
          setQuickRenameTarget(null);
          setShowSavedSpeakersModal(true);
        }}
        savedSpeakers={savedSpeakers}
        defaultSavedSpeakers={DEFAULT_SAVED_SPEAKERS}
        speakerColorMap={SPEAKER_COLOR_MAP}
        dynamicColorOrder={DYNAMIC_COLOR_ORDER}
        getSpeakerTheme={getSpeakerTheme}
        getAutoSpeakerColor={getAutoSpeakerColor}
        getAutoSpeakerEmoji={getAutoSpeakerEmoji}
      />

      {/* ── Saved Speakers Modal ── */}
      <SavedSpeakersModal
        isOpen={showSavedSpeakersModal}
        onClose={() => setShowSavedSpeakersModal(false)}
        savedSpeakers={savedSpeakers}
        onDeleteSpeaker={(idOrName: string) => deletePermanentSpeaker(idOrName)}
        onAddSpeaker={(speaker: SavedSpeaker) => addOrUpdatePermanentSpeaker(speaker)}
        getSpeakerTheme={getSpeakerTheme}
      />

      {/* Interactive In-Browser Audio Slicer Modal */}
      <AudioSlicerModal
        isOpen={isSlicerOpen}
        onClose={() => setIsSlicerOpen(false)}
        target={slicerTarget}
      />
    </div>
  );
};

export default TranscriptPanel;
