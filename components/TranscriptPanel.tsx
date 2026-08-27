import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  FileText, RefreshCw, AlertCircle, Search, ChevronDown, Loader,
  ExternalLink, Play, Pause, Volume2, Copy, Check, Download,
  SlidersHorizontal, ArrowDownCircle, Sparkles, Pencil, Users, X, RotateCcw,
  Save, CloudCheck, CheckCircle2, Star, Plus, Trash2, UserPlus, Sparkle
} from 'lucide-react';
import { Release, EnhancedConfig } from '../types';
import { getReleases, fetchReleaseAssetText, dispatchWorkflow, updateReleaseTranscriptAssets } from '../utils/github';
import { usePlayer, NowPlayingEpisode } from '../contexts/PlayerContext';

interface Props {
  config: EnhancedConfig;
  initialReleaseId?: number | null;
}

export interface ParsedUtterance {
  id: string;
  startSec: number;
  endSec: number | null;
  startLabel: string;
  endLabel: string;
  speaker: string;
  rawSpeaker: string;
  text: string;
  raw: string;
}

export interface SavedSpeaker {
  id: string;
  name: string;
  avatarEmoji?: string;
  color?: string;
  role?: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function parseTimeToSeconds(timeStr: string): number {
  if (!timeStr) return 0;
  const parts = timeStr.trim().replace(/^\[|\]$/g, '').split(':').map(Number);
  if (parts.length === 3) {
    return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
  }
  if (parts.length === 2) {
    return (parts[0] || 0) * 60 + (parts[1] || 0);
  }
  return Number(timeStr) || 0;
}

function formatSeconds(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) {
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${rem.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${rem.toString().padStart(2, '0')}`;
}

export const SPEAKER_COLOR_MAP: Record<string, { bg: string; text: string; border: string; badge: string; dot: string; avatar: string }> = {
  indigo: { bg: 'bg-indigo-500/10', text: 'text-indigo-300', border: 'border-indigo-500/30', badge: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40', dot: 'bg-indigo-400', avatar: 'bg-indigo-600 text-white' },
  purple: { bg: 'bg-purple-500/10', text: 'text-purple-300', border: 'border-purple-500/30', badge: 'bg-purple-500/20 text-purple-300 border-purple-500/40', dot: 'bg-purple-400', avatar: 'bg-purple-600 text-white' },
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-300', border: 'border-emerald-500/30', badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', dot: 'bg-emerald-400', avatar: 'bg-emerald-600 text-white' },
  sky: { bg: 'bg-sky-500/10', text: 'text-sky-300', border: 'border-sky-500/30', badge: 'bg-sky-500/20 text-sky-300 border-sky-500/40', dot: 'bg-sky-400', avatar: 'bg-sky-600 text-white' },
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-300', border: 'border-amber-500/30', badge: 'bg-amber-500/20 text-amber-300 border-amber-500/40', dot: 'bg-amber-400', avatar: 'bg-amber-600 text-white' },
  rose: { bg: 'bg-rose-500/10', text: 'text-rose-300', border: 'border-rose-500/30', badge: 'bg-rose-500/20 text-rose-300 border-rose-500/40', dot: 'bg-rose-400', avatar: 'bg-rose-600 text-white' },
  cyan: { bg: 'bg-cyan-500/10', text: 'text-cyan-300', border: 'border-cyan-500/30', badge: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40', dot: 'bg-cyan-400', avatar: 'bg-cyan-600 text-white' },
  fuchsia: { bg: 'bg-fuchsia-500/10', text: 'text-fuchsia-300', border: 'border-fuchsia-500/30', badge: 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40', dot: 'bg-fuchsia-400', avatar: 'bg-fuchsia-600 text-white' },
  teal: { bg: 'bg-teal-500/10', text: 'text-teal-300', border: 'border-teal-500/30', badge: 'bg-teal-500/20 text-teal-300 border-teal-500/40', dot: 'bg-teal-400', avatar: 'bg-teal-600 text-white' },
  orange: { bg: 'bg-orange-500/10', text: 'text-orange-300', border: 'border-orange-500/30', badge: 'bg-orange-500/20 text-orange-300 border-orange-500/40', dot: 'bg-orange-400', avatar: 'bg-orange-600 text-white' },
};

const DEFAULT_SAVED_SPEAKERS: SavedSpeaker[] = [
  { id: 'logan', name: 'Logan', avatarEmoji: '🎙️', color: 'indigo', role: 'Host' },
  { id: 'mary', name: 'Mary', avatarEmoji: '👩‍🎨', color: 'purple', role: 'Co-Host' },
  { id: 'oor', name: 'Oor', avatarEmoji: '⚡', color: 'sky', role: 'Speaker' },
  { id: 'rick-doty', name: 'Rick Doty', avatarEmoji: '🛸', color: 'emerald', role: 'Special Guest' },
  { id: 'shane', name: 'Shane', avatarEmoji: '🎧', color: 'amber', role: 'Co-Host' },
  { id: 'lana', name: 'Lana', avatarEmoji: '🌸', color: 'rose', role: 'Speaker' },
];

const SPEAKER_PALETTE: Record<string, { bg: string; text: string; border: string; badge: string; dot: string; avatar: string }> = {
  'A': { bg: 'bg-emerald-500/10', text: 'text-emerald-300', border: 'border-emerald-500/30', badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', dot: 'bg-emerald-400', avatar: 'bg-emerald-600 text-white' },
  'B': { bg: 'bg-sky-500/10', text: 'text-sky-300', border: 'border-sky-500/30', badge: 'bg-sky-500/20 text-sky-300 border-sky-500/40', dot: 'bg-sky-400', avatar: 'bg-sky-600 text-white' },
  'C': { bg: 'bg-purple-500/10', text: 'text-purple-300', border: 'border-purple-500/30', badge: 'bg-purple-500/20 text-purple-300 border-purple-500/40', dot: 'bg-purple-400', avatar: 'bg-purple-600 text-white' },
  'D': { bg: 'bg-amber-500/10', text: 'text-amber-300', border: 'border-amber-500/30', badge: 'bg-amber-500/20 text-amber-300 border-amber-500/40', dot: 'bg-amber-400', avatar: 'bg-amber-600 text-white' },
  'E': { bg: 'bg-rose-500/10', text: 'text-rose-300', border: 'border-rose-500/30', badge: 'bg-rose-500/20 text-rose-300 border-rose-500/40', dot: 'bg-rose-400', avatar: 'bg-rose-600 text-white' },
  'F': { bg: 'bg-cyan-500/10', text: 'text-cyan-300', border: 'border-cyan-500/30', badge: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40', dot: 'bg-cyan-400', avatar: 'bg-cyan-600 text-white' },
  'G': { bg: 'bg-violet-500/10', text: 'text-violet-300', border: 'border-violet-500/30', badge: 'bg-violet-500/20 text-violet-300 border-violet-500/40', dot: 'bg-violet-400', avatar: 'bg-violet-600 text-white' },
  'H': { bg: 'bg-teal-500/10', text: 'text-teal-300', border: 'border-teal-500/30', badge: 'bg-teal-500/20 text-teal-300 border-teal-500/40', dot: 'bg-teal-400', avatar: 'bg-teal-600 text-white' },
  'I': { bg: 'bg-indigo-500/10', text: 'text-indigo-300', border: 'border-indigo-500/30', badge: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40', dot: 'bg-indigo-400', avatar: 'bg-indigo-600 text-white' },
  'J': { bg: 'bg-orange-500/10', text: 'text-orange-300', border: 'border-orange-500/30', badge: 'bg-orange-500/20 text-orange-300 border-orange-500/40', dot: 'bg-orange-400', avatar: 'bg-orange-600 text-white' },
  'K': { bg: 'bg-pink-500/10', text: 'text-pink-300', border: 'border-pink-500/30', badge: 'bg-pink-500/20 text-pink-300 border-pink-500/40', dot: 'bg-pink-400', avatar: 'bg-pink-600 text-white' },
  'L': { bg: 'bg-lime-500/10', text: 'text-lime-300', border: 'border-lime-500/30', badge: 'bg-lime-500/20 text-lime-300 border-lime-500/40', dot: 'bg-lime-400', avatar: 'bg-lime-600 text-white' },
  'M': { bg: 'bg-fuchsia-500/10', text: 'text-fuchsia-300', border: 'border-fuchsia-500/30', badge: 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40', dot: 'bg-fuchsia-400', avatar: 'bg-fuchsia-600 text-white' },
  'N': { bg: 'bg-yellow-500/10', text: 'text-yellow-300', border: 'border-yellow-500/30', badge: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40', dot: 'bg-yellow-400', avatar: 'bg-yellow-600 text-white' },
  'O': { bg: 'bg-blue-500/10', text: 'text-blue-300', border: 'border-blue-500/30', badge: 'bg-blue-500/20 text-blue-300 border-blue-500/40', dot: 'bg-blue-400', avatar: 'bg-blue-600 text-white' },
  'P': { bg: 'bg-emerald-500/10', text: 'text-emerald-300', border: 'border-emerald-500/30', badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', dot: 'bg-emerald-400', avatar: 'bg-emerald-600 text-white' },
};

function getSpeakerTheme(displayName: string, savedSpeakers: SavedSpeaker[] = []) {
  // Check if speaker matches a SavedSpeaker profile
  const match = savedSpeakers.find(s => s.name.toLowerCase() === displayName.toLowerCase());
  if (match && match.color && SPEAKER_COLOR_MAP[match.color]) {
    return {
      ...SPEAKER_COLOR_MAP[match.color],
      emoji: match.avatarEmoji,
      role: match.role,
    };
  }

  const clean = displayName.replace(/^Speaker\s+/i, '').trim();
  const char = (clean.charAt(0) || 'A').toUpperCase();
  if (SPEAKER_PALETTE[char]) return { ...SPEAKER_PALETTE[char], emoji: undefined, role: undefined };
  
  let hash = 0;
  for (let i = 0; i < displayName.length; i++) hash = (hash * 31 + displayName.charCodeAt(i)) % 16;
  const keys = Object.keys(SPEAKER_PALETTE);
  return { ...SPEAKER_PALETTE[keys[hash % keys.length]], emoji: undefined, role: undefined };
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return parts.map((p, i) =>
    p.toLowerCase() === query.toLowerCase()
      ? <mark key={i} className="bg-amber-400/30 text-amber-200 rounded px-0.5 font-medium">{p}</mark>
      : p
  );
}

function parseTranscriptData(rawContent: string): ParsedUtterance[] {
  if (!rawContent.trim()) return [];

  // 1. Try parsing JSON format
  try {
    const json = JSON.parse(rawContent);
    if (json && Array.isArray(json.segments) && json.segments.length > 0) {
      return json.segments.map((seg: any, idx: number) => {
        const startSec = typeof seg.start === 'number' ? (seg.start > 1000 ? seg.start / 1000 : seg.start) : 0;
        const endSec = typeof seg.end === 'number' ? (seg.end > 1000 ? seg.end / 1000 : seg.end) : null;
        const spk = seg.speaker || 'Speaker A';
        const formattedSpeaker = spk.startsWith('Speaker') ? spk : `Speaker ${spk}`;
        return {
          id: `seg-${idx}`,
          startSec,
          endSec,
          startLabel: formatSeconds(startSec),
          endLabel: endSec ? formatSeconds(endSec) : '',
          speaker: formattedSpeaker,
          rawSpeaker: seg.raw_speaker || formattedSpeaker,
          text: (seg.text || '').trim(),
          raw: `[${formatSeconds(startSec)}] ${formattedSpeaker}: ${seg.text}`,
        };
      });
    }
  } catch {
    // Proceed to text parsing
  }

  // 2. Parse plain text line by line
  const lines = rawContent.split(/\r?\n/);
  const utterances: ParsedUtterance[] = [];
  const lineRegex = /^\[?(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:-\s*(\d{1,2}:\d{2}(?::\d{2})?))?\]?\s*(?:Speaker\s+([A-Za-z0-9_]+)|([A-Za-z0-9_]+))?\s*:\s*(.*)$/i;

  let currentUtterance: ParsedUtterance | null = null;

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    const match = trimmed.match(lineRegex);
    if (match) {
      if (currentUtterance) {
        utterances.push(currentUtterance);
      }
      const startStr = match[1];
      const endStr = match[2];
      const speakerId = match[3] || match[4] || 'A';
      const text = match[5] || '';
      const startSec = parseTimeToSeconds(startStr);
      const endSec = endStr ? parseTimeToSeconds(endStr) : null;
      const formattedSpeaker = speakerId.startsWith('Speaker') ? speakerId : `Speaker ${speakerId}`;

      currentUtterance = {
        id: `line-${index}`,
        startSec,
        endSec,
        startLabel: formatSeconds(startSec),
        endLabel: endSec ? formatSeconds(endSec) : '',
        speaker: formattedSpeaker,
        rawSpeaker: formattedSpeaker,
        text,
        raw: trimmed,
      };
    } else if (currentUtterance) {
      currentUtterance.text += ` ${trimmed}`;
      currentUtterance.raw += `\n${trimmed}`;
    } else {
      utterances.push({
        id: `raw-${index}`,
        startSec: index * 10,
        endSec: null,
        startLabel: formatSeconds(index * 10),
        endLabel: '',
        speaker: 'Transcript',
        rawSpeaker: 'Transcript',
        text: trimmed,
        raw: trimmed,
      });
    }
  });

  if (currentUtterance) {
    utterances.push(currentUtterance);
  }

  return utterances;
}

const TranscriptPanel: React.FC<Props> = ({ config, initialReleaseId }) => {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(initialReleaseId || null);
  const [transcriptRaw, setTranscriptRaw] = useState('');
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState('');
  const [search, setSearch] = useState('');
  const [speakerFilter, setSpeakerFilter] = useState('ALL');
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeSuccess, setTranscribeSuccess] = useState('');

  // Speaker Renaming States
  const [speakerMap, setSpeakerMap] = useState<Record<string, string>>({});
  const [editingSpeakerKey, setEditingSpeakerKey] = useState<string | null>(null);
  const [editingSpeakerVal, setEditingSpeakerVal] = useState('');
  const [showRenameModal, setShowRenameModal] = useState(false);

  // Permanent Saved Speakers Directory
  const [savedSpeakers, setSavedSpeakers] = useState<SavedSpeaker[]>(() => {
    try {
      const stored = localStorage.getItem('spacepipe_saved_speakers');
      if (stored) return JSON.parse(stored);
    } catch {}
    return DEFAULT_SAVED_SPEAKERS;
  });
  const [showSavedSpeakersModal, setShowSavedSpeakersModal] = useState(false);
  const [newSpeakerName, setNewSpeakerName] = useState('');
  const [newSpeakerEmoji, setNewSpeakerEmoji] = useState('🎙️');
  const [newSpeakerColor, setNewSpeakerColor] = useState('indigo');
  const [newSpeakerRole, setNewSpeakerRole] = useState('Co-Host');

  const addOrUpdatePermanentSpeaker = (speaker: SavedSpeaker) => {
    setSavedSpeakers(prev => {
      const existing = prev.findIndex(s => s.name.toLowerCase() === speaker.name.toLowerCase());
      let updated: SavedSpeaker[];
      if (existing >= 0) {
        updated = [...prev];
        updated[existing] = speaker;
      } else {
        updated = [...prev, speaker];
      }
      try {
        localStorage.setItem('spacepipe_saved_speakers', JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  const deletePermanentSpeaker = (idOrName: string) => {
    setSavedSpeakers(prev => {
      const updated = prev.filter(s => s.id !== idOrName && s.name.toLowerCase() !== idOrName.toLowerCase());
      try {
        localStorage.setItem('spacepipe_saved_speakers', JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  const quickSaveToPermanent = (name: string, emoji = '🎙️', color = 'indigo') => {
    const trimmed = name.trim();
    if (!trimmed) return;
    addOrUpdatePermanentSpeaker({
      id: trimmed.toLowerCase().replace(/\s+/g, '-'),
      name: trimmed,
      avatarEmoji: emoji,
      color: color,
      role: 'Speaker'
    });
  };

  // GitHub Release Permanent Save States
  const [savingGitHub, setSavingGitHub] = useState(false);
  const [saveGitHubSuccess, setSaveGitHubSuccess] = useState('');
  const [saveGitHubError, setSaveGitHubError] = useState('');

  const currentLoadedIdRef = useRef<number | null>(null);

  const { play, seek, currentTime, isPlaying, current, togglePlay } = usePlayer();

  const hasCredentials = !!(config.githubToken && config.ownerName && config.repoName);

  // Restore saved speaker names for selected release
  useEffect(() => {
    if (selectedId) {
      try {
        const saved = localStorage.getItem(`spk_names_${selectedId}`);
        if (saved) {
          setSpeakerMap(JSON.parse(saved));
        } else {
          setSpeakerMap({});
        }
      } catch {
        setSpeakerMap({});
      }
    }
  }, [selectedId]);

  const saveSpeakerRename = (rawSpeaker: string, newName: string) => {
    const trimmed = newName.trim();
    if (!selectedId) return;

    setSpeakerMap(prev => {
      const next = { ...prev };
      if (trimmed && trimmed !== rawSpeaker) {
        next[rawSpeaker] = trimmed;
      } else {
        delete next[rawSpeaker];
      }
      try {
        localStorage.setItem(`spk_names_${selectedId}`, JSON.stringify(next));
      } catch {}
      return next;
    });

    setEditingSpeakerKey(null);
  };

  const resetAllSpeakerNames = () => {
    if (!selectedId) return;
    setSpeakerMap({});
    try {
      localStorage.removeItem(`spk_names_${selectedId}`);
    } catch {}
  };

  const fetchReleases = useCallback(async () => {
    if (!hasCredentials) return;
    setLoading(true);
    setError('');
    try {
      const data = await getReleases(config.githubToken, config.ownerName.trim(), config.repoName.trim());
      const withTranscripts = data.filter(r =>
        r.assets.some(a => a.name.endsWith('.txt') || a.name.endsWith('.json'))
      );
      setReleases(withTranscripts.length > 0 ? withTranscripts : data);
      setLoaded(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [config.githubToken, config.ownerName, config.repoName, hasCredentials]);

  useEffect(() => {
    if (hasCredentials && !loaded && !loading) {
      fetchReleases();
    }
  }, [hasCredentials, loaded, loading, fetchReleases]);

  const loadTranscript = useCallback(async (release: Release) => {
    const asset = release.assets.find(a => a.name.endsWith('.json')) ||
                  release.assets.find(a => a.name.endsWith('.txt'));
    setSelectedId(release.id);
    setSearch('');
    setSpeakerFilter('ALL');
    setTranscribeSuccess('');
    setEditingSpeakerKey(null);
    setSaveGitHubSuccess('');
    setSaveGitHubError('');

    if (!asset) {
      setTranscriptRaw('');
      setTranscriptError('');
      return;
    }

    setTranscriptLoading(true);
    setTranscriptError('');
    setTranscriptRaw('');

    try {
      const text = await fetchReleaseAssetText(
        config.githubToken,
        asset,
        config.ownerName.trim(),
        config.repoName.trim()
      );
      setTranscriptRaw(text);
    } catch (e) {
      setTranscriptError((e as Error).message);
    } finally {
      setTranscriptLoading(false);
    }
  }, [config.githubToken, config.ownerName, config.repoName]);

  const handleGenerateTranscript = async () => {
    if (!selectedRelease || !hasCredentials) return;
    setTranscribing(true);
    setTranscribeSuccess('');
    setTranscriptError('');
    try {
      await dispatchWorkflow(
        config.githubToken,
        config.ownerName.trim(),
        config.repoName.trim(),
        'transcribe_episode.yml',
        { release_tag: selectedRelease.tag_name }
      );
      setTranscribeSuccess(`Workflow dispatched for ${selectedRelease.tag_name}! AssemblyAI is processing the audio in GitHub Actions. Click 'Refresh' once the job finishes.`);
    } catch (e) {
      setTranscriptError(`Failed to trigger transcription: ${(e as Error).message}`);
    } finally {
      setTranscribing(false);
    }
  };

  useEffect(() => {
    if (releases.length > 0 && selectedId) {
      if (currentLoadedIdRef.current !== selectedId) {
        const rel = releases.find(r => r.id === selectedId);
        if (rel) {
          currentLoadedIdRef.current = selectedId;
          loadTranscript(rel);
        }
      }
    } else if (releases.length > 0 && !selectedId) {
      const firstWithTranscript = releases.find(r =>
        r.assets.some(a => a.name.endsWith('.txt') || a.name.endsWith('.json'))
      ) || releases[0];
      if (firstWithTranscript && currentLoadedIdRef.current !== firstWithTranscript.id) {
        currentLoadedIdRef.current = firstWithTranscript.id;
        loadTranscript(firstWithTranscript);
      }
    }
  }, [releases, selectedId, loadTranscript]);

  const selectedRelease = releases.find(r => r.id === selectedId);
  const mp3Asset = selectedRelease?.assets.find(a => a.name.endsWith('.mp3'));
  const isCurrentEpisodePlaying = current?.id === selectedRelease?.id && isPlaying;

  // Compute utterances with custom speaker mapping applied
  const utterances = useMemo(() => {
    const rawUtterances = parseTranscriptData(transcriptRaw);
    return rawUtterances.map(u => ({
      ...u,
      speaker: speakerMap[u.rawSpeaker] || u.rawSpeaker,
    }));
  }, [transcriptRaw, speakerMap]);

  // Extract distinct raw speakers and counts
  const speakerStats = useMemo(() => {
    const counts = new Map<string, number>();
    const rawUtterances = parseTranscriptData(transcriptRaw);
    rawUtterances.forEach(u => {
      counts.set(u.rawSpeaker, (counts.get(u.rawSpeaker) || 0) + 1);
    });
    return Array.from(counts.entries()).map(([rawSpeaker, count]) => ({
      rawSpeaker,
      displayName: speakerMap[rawSpeaker] || rawSpeaker,
      count,
    }));
  }, [transcriptRaw, speakerMap]);

  const uniqueDisplaySpeakers = useMemo(() => {
    const s = new Set<string>();
    utterances.forEach(u => s.add(u.speaker));
    return Array.from(s);
  }, [utterances]);

  const filteredUtterances = useMemo(() => {
    return utterances.filter(u => {
      if (speakerFilter !== 'ALL' && u.speaker !== speakerFilter) {
        return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        return u.text.toLowerCase().includes(q) || u.speaker.toLowerCase().includes(q);
      }
      return true;
    });
  }, [utterances, speakerFilter, search]);

  const matchCount = useMemo(() => {
    if (!search.trim()) return 0;
    const q = search.toLowerCase();
    return utterances.filter(u => u.text.toLowerCase().includes(q)).length;
  }, [search, utterances]);

  const activeUtteranceIndex = useMemo(() => {
    if (current?.id !== selectedRelease?.id || !utterances.length) return -1;
    for (let i = 0; i < utterances.length; i++) {
      const u = utterances[i];
      const nextU = utterances[i + 1];
      const end = u.endSec ?? (nextU ? nextU.startSec : u.startSec + 30);
      if (currentTime >= u.startSec && currentTime < end) {
        return i;
      }
    }
    return -1;
  }, [current, selectedRelease, utterances, currentTime]);

  useEffect(() => {
    if (autoScroll && activeUtteranceIndex >= 0) {
      const el = document.getElementById(`utterance-card-${activeUtteranceIndex}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [autoScroll, activeUtteranceIndex]);

  const handlePlayUtterance = (startSec: number) => {
    if (!selectedRelease || !mp3Asset) return;
    const nowPlaying: NowPlayingEpisode = {
      id: selectedRelease.id,
      title: selectedRelease.name || selectedRelease.tag_name,
      audioUrl: mp3Asset.browser_download_url,
    };

    if (current?.id !== selectedRelease.id) {
      play(nowPlaying);
      setTimeout(() => seek(startSec), 150);
    } else {
      seek(startSec);
      if (!isPlaying) togglePlay();
    }
  };

  const handlePlayEpisodeToggle = () => {
    if (!selectedRelease || !mp3Asset) return;
    const nowPlaying: NowPlayingEpisode = {
      id: selectedRelease.id,
      title: selectedRelease.name || selectedRelease.tag_name,
      audioUrl: mp3Asset.browser_download_url,
    };

    if (current?.id === selectedRelease.id) {
      togglePlay();
    } else {
      play(nowPlaying);
    }
  };

  const handleCopyTranscript = () => {
    if (!utterances.length) return;
    const formatted = utterances
      .map(u => `[${u.startLabel}${u.endLabel ? ` - ${u.endLabel}` : ''}] ${u.speaker}:\n${u.text}`)
      .join('\n\n');
    navigator.clipboard.writeText(formatted);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadTranscript = (format: 'txt' | 'json') => {
    if (!utterances.length || !selectedRelease) return;
    const baseName = (selectedRelease.name || selectedRelease.tag_name).replace(/[^a-zA-Z0-9_-]/g, '_');
    let blob: Blob;
    let filename: string;

    if (format === 'json') {
      const data = {
        episode: selectedRelease.name || selectedRelease.tag_name,
        tag: selectedRelease.tag_name,
        published_at: selectedRelease.published_at,
        segments: utterances.map(u => ({
          start: u.startSec,
          end: u.endSec,
          speaker: u.speaker,
          raw_speaker: u.rawSpeaker,
          text: u.text,
        })),
      };
      blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      filename = `${baseName}_transcript.json`;
    } else {
      const text = utterances
        .map(u => `[${u.startLabel}${u.endLabel ? ` - ${u.endLabel}` : ''}] ${u.speaker}: ${u.text}`)
        .join('\n\n');
      blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      filename = `${baseName}_transcript.txt`;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveToGitHub = async () => {
    if (!selectedRelease || !hasCredentials || !utterances.length) return;
    setSavingGitHub(true);
    setSaveGitHubSuccess('');
    setSaveGitHubError('');

    try {
      const text = utterances
        .map(u => `[${u.startLabel}${u.endLabel ? ` - ${u.endLabel}` : ''}] ${u.speaker}: ${u.text}`)
        .join('\n\n');

      const jsonData = JSON.stringify({
        episode: selectedRelease.name || selectedRelease.tag_name,
        tag: selectedRelease.tag_name,
        published_at: selectedRelease.published_at,
        segments: utterances.map(u => ({
          start: u.startSec,
          end: u.endSec,
          speaker: u.speaker,
          raw_speaker: u.rawSpeaker,
          text: u.text,
        })),
      }, null, 2);

      await updateReleaseTranscriptAssets(
        config.githubToken,
        config.ownerName.trim(),
        config.repoName.trim(),
        selectedRelease,
        text,
        jsonData
      );

      setSaveGitHubSuccess('Saved permanently to GitHub Release assets! All devices, downloads, and apps will now see these speaker names.');
      setTimeout(() => setSaveGitHubSuccess(''), 6000);
    } catch (e) {
      setSaveGitHubError(`Failed to save to GitHub: ${(e as Error).message}`);
    } finally {
      setSavingGitHub(false);
    }
  };

  return (
    <div className="h-full overflow-hidden flex flex-col bg-slate-950">
      {/* ── Top Header ── */}
      <div className="p-6 md:px-10 md:py-6 border-b border-slate-800 flex items-center justify-between gap-4 flex-shrink-0 bg-slate-900/40">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold text-white tracking-tight">Interactive Transcripts</h2>
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold">
              <Sparkles size={11} /> Diarized & Editable
            </span>
          </div>
          <p className="text-slate-400 text-xs mt-1">
            Click any speaker label to rename them across the whole episode. Click quotes to jump audio playback instantly.
          </p>
        </div>

        <button
          onClick={fetchReleases}
          disabled={loading || !hasCredentials}
          className="flex items-center gap-2 px-3.5 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 rounded-lg transition-colors border border-slate-700 cursor-pointer"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {!hasCredentials && (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
          <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl mb-4">
            <AlertCircle size={28} className="text-slate-500" />
          </div>
          <p className="text-slate-300 text-sm font-medium">GitHub Connection Required</p>
          <p className="text-slate-500 text-xs mt-1 max-w-sm">Connect your GitHub Personal Access Token to load transcripts from your repository releases.</p>
        </div>
      )}

      {hasCredentials && error && (
        <div className="mx-6 md:mx-10 mt-4 flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
          <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {hasCredentials && loaded && releases.length === 0 && !error && (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
          <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl mb-4">
            <FileText size={28} className="text-slate-500" />
          </div>
          <p className="text-slate-300 text-sm font-medium">No Episodes Found</p>
          <p className="text-slate-500 text-xs mt-1 max-w-sm">Run your ingest pipeline to download Spaces and generate transcripts.</p>
        </div>
      )}

      {hasCredentials && loaded && releases.length > 0 && (
        <div className="flex-1 flex min-h-0">
          {/* ── Sidebar: Episode List ── */}
          <div className="w-72 md:w-80 flex-shrink-0 border-r border-slate-800 overflow-y-auto bg-slate-950/70 divide-y divide-slate-900">
            <div className="p-3 bg-slate-900/50 border-b border-slate-800">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                Select Episode ({releases.length})
              </span>
            </div>

            {releases.map(release => {
              const hasTxt = release.assets.some(a => a.name.endsWith('.txt') || a.name.endsWith('.json'));
              const isSelected = selectedId === release.id;
              const isPlayingThis = current?.id === release.id && isPlaying;

              return (
                <button
                  key={release.id}
                  onClick={() => loadTranscript(release)}
                  className={`w-full text-left p-3.5 transition-all flex items-start gap-3 group relative cursor-pointer ${
                    isSelected
                      ? 'bg-indigo-600/15 border-l-4 border-l-indigo-500 text-white'
                      : 'hover:bg-slate-900/80 text-slate-300'
                  }`}
                >
                  <div className={`mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    isPlayingThis ? 'bg-indigo-500 text-white animate-pulse' : isSelected ? 'bg-indigo-500/20 text-indigo-400' : 'bg-slate-800 text-slate-500 group-hover:text-slate-300'
                  }`}>
                    {isPlayingThis ? <Volume2 size={13} /> : <FileText size={13} />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-semibold truncate ${isSelected ? 'text-white font-bold' : 'text-slate-300'}`}>
                      {release.name || release.tag_name}
                    </p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-[10px] text-slate-500">{formatDate(release.published_at)}</span>
                      {hasTxt ? (
                        <span className="px-1.5 py-0.2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded text-[9px] font-medium">
                          Transcript Ready
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.2 bg-slate-800 text-slate-500 rounded text-[9px]">
                          Audio Only
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* ── Main View: Interactive Player & Transcript ── */}
          <div className="flex-1 flex flex-col min-w-0 bg-slate-950">
            {!selectedRelease && (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                <ChevronDown size={28} className="text-slate-700 mb-3 rotate-90" />
                <p className="text-slate-500 text-sm">Select an episode from the sidebar to view its transcript</p>
              </div>
            )}

            {selectedRelease && (
              <>
                {/* ── Episode Sticky Player Header ── */}
                <div className="p-4 md:px-6 bg-slate-900/90 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {mp3Asset && (
                      <button
                        onClick={handlePlayEpisodeToggle}
                        className={`w-10 h-10 rounded-xl flex items-center justify-center font-medium shadow-md transition-all cursor-pointer ${
                          isCurrentEpisodePlaying
                            ? 'bg-indigo-500 text-white shadow-indigo-500/30'
                            : 'bg-indigo-600 hover:bg-indigo-500 text-white hover:scale-105 shadow-indigo-600/20'
                        }`}
                        title={isCurrentEpisodePlaying ? 'Pause Audio' : 'Play Episode Audio'}
                      >
                        {isCurrentEpisodePlaying ? <Pause size={16} /> : <Play size={16} className="translate-x-0.5" />}
                      </button>
                    )}

                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-white truncate max-w-md">
                        {selectedRelease.name || selectedRelease.tag_name}
                      </h3>
                      <p className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
                        <span>{formatDate(selectedRelease.published_at)}</span>
                        {utterances.length > 0 && (
                          <>
                            <span>•</span>
                            <span className="text-indigo-400 font-medium">{utterances.length} turns</span>
                          </>
                        )}
                        {speakerStats.length > 0 && (
                          <>
                            <span>•</span>
                            <span className="text-emerald-400">{speakerStats.length} speaker{speakerStats.length > 1 ? 's' : ''}</span>
                          </>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Saved Speakers Directory Button */}
                    <button
                      onClick={() => setShowSavedSpeakersModal(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-xs font-semibold rounded-lg transition-colors border border-amber-500/30 cursor-pointer shadow-sm"
                      title="Manage permanent speaker avatars, emojis, and roster"
                    >
                      <Star size={12} className="text-amber-400 fill-amber-400/30" />
                      Saved Speakers ({savedSpeakers.length})
                    </button>

                    {/* Rename Speakers Button */}
                    {speakerStats.length > 0 && (
                      <button
                        onClick={() => setShowRenameModal(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 text-xs font-semibold rounded-lg transition-colors border border-indigo-500/40 cursor-pointer"
                        title="Rename speaker labels for this episode"
                      >
                        <Users size={12} />
                        Rename Speakers
                      </button>
                    )}

                    {/* Permanent Save to GitHub Button */}
                    {speakerStats.length > 0 && (
                      <button
                        onClick={handleSaveToGitHub}
                        disabled={savingGitHub || !Object.keys(speakerMap).length}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 disabled:opacity-40 text-emerald-300 text-xs font-semibold rounded-lg transition-colors border border-emerald-500/40 cursor-pointer shadow-sm"
                        title="Permanently overwrite GitHub Release .txt and .json files with updated speaker names"
                      >
                        {savingGitHub ? <Loader size={12} className="animate-spin text-emerald-400" /> : <Save size={12} />}
                        {savingGitHub ? 'Saving to GitHub…' : 'Save to GitHub'}
                      </button>
                    )}

                    {/* Copy button */}
                    <button
                      onClick={handleCopyTranscript}
                      disabled={!utterances.length}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-xs font-medium rounded-lg transition-colors border border-slate-700 cursor-pointer"
                      title="Copy formatted transcript to clipboard"
                    >
                      {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                      {copied ? 'Copied!' : 'Copy'}
                    </button>

                    {/* Download buttons */}
                    <button
                      onClick={() => handleDownloadTranscript('txt')}
                      disabled={!utterances.length}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-xs font-medium rounded-lg transition-colors border border-slate-700 cursor-pointer"
                      title="Download transcript (.txt)"
                    >
                      <Download size={12} />
                      .txt
                    </button>

                    <button
                      onClick={() => handleDownloadTranscript('json')}
                      disabled={!utterances.length}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-xs font-medium rounded-lg transition-colors border border-slate-700 cursor-pointer"
                      title="Download structured data (.json)"
                    >
                      <Download size={12} />
                      .json
                    </button>

                    <a
                      href={selectedRelease.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded-lg transition-colors border border-slate-800"
                      title="View release on GitHub"
                    >
                      <ExternalLink size={13} />
                    </a>
                  </div>
                </div>

                {/* Save Success / Error Toast Notifications */}
                {saveGitHubSuccess && (
                  <div className="mx-4 md:mx-6 mt-3 flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-300 text-xs animate-in fade-in slide-in-from-top-2">
                    <CheckCircle2 size={15} className="text-emerald-400 flex-shrink-0" />
                    <span>{saveGitHubSuccess}</span>
                  </div>
                )}

                {saveGitHubError && (
                  <div className="mx-4 md:mx-6 mt-3 flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300 text-xs animate-in fade-in slide-in-from-top-2">
                    <AlertCircle size={15} className="text-red-400 flex-shrink-0" />
                    <span>{saveGitHubError}</span>
                  </div>
                )}

                {/* ── Filter & Search Toolbar ── */}
                <div className="p-3 md:px-6 bg-slate-900/50 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3 flex-1 min-w-[240px]">
                    <div className="relative flex-1 max-w-sm">
                      <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input
                        type="text"
                        placeholder="Search transcript text or speaker…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="w-full pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
                      />
                    </div>

                    {search && (
                      <span className="text-xs text-amber-400 font-medium">
                        {matchCount} match{matchCount !== 1 ? 'es' : ''}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    {/* Speaker filter */}
                    {uniqueDisplaySpeakers.length > 1 && (
                      <div className="flex items-center gap-1.5">
                        <SlidersHorizontal size={12} className="text-slate-500" />
                        <select
                          value={speakerFilter}
                          onChange={e => setSpeakerFilter(e.target.value)}
                          className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 cursor-pointer"
                        >
                          <option value="ALL">All Speakers ({uniqueDisplaySpeakers.length})</option>
                          {uniqueDisplaySpeakers.map(spk => (
                            <option key={spk} value={spk}>{spk}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Auto-scroll toggle */}
                    <button
                      onClick={() => setAutoScroll(!autoScroll)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg transition-colors border cursor-pointer ${
                        autoScroll
                          ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30 font-medium'
                          : 'bg-slate-900 text-slate-500 border-slate-800'
                      }`}
                      title="Automatically scroll to follow playback"
                    >
                      <ArrowDownCircle size={12} />
                      Auto-Scroll {autoScroll ? 'ON' : 'OFF'}
                    </button>
                  </div>
                </div>

                {/* ── Transcript Content / Utterance Feed ── */}
                <div className="flex-1 overflow-y-auto p-4 md:p-8 bg-gradient-to-b from-slate-950 via-slate-950/95 to-slate-950">
                  {transcriptLoading && (
                    <div className="flex flex-col items-center justify-center py-24 text-slate-400 gap-3">
                      <Loader size={26} className="animate-spin text-indigo-400" />
                      <span className="text-xs font-medium tracking-wide">Loading diarized transcript…</span>
                    </div>
                  )}

                  {transcriptError && (
                    <div className="max-w-2xl mx-auto p-4 bg-red-500/10 border border-red-500/30 rounded-2xl text-red-300 text-xs shadow-lg">
                      <p className="font-semibold flex items-center gap-2">
                        <AlertCircle size={15} className="text-red-400" />
                        Could not load transcript
                      </p>
                      <p className="mt-1 opacity-90 pl-6">{transcriptError}</p>
                    </div>
                  )}

                  {!transcriptLoading && !transcriptError && !transcriptRaw && (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-8 max-w-md mx-auto py-20">
                      <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mb-4 text-indigo-400 shadow-xl shadow-indigo-500/5">
                        <Sparkles size={28} />
                      </div>
                      <h4 className="text-base font-bold text-white mb-1.5">No Transcript Generated Yet</h4>
                      <p className="text-slate-400 text-xs mb-6 leading-relaxed">
                        This episode has audio published, but has not been transcribed with AssemblyAI speaker diarization yet.
                      </p>

                      {transcribeSuccess ? (
                        <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl text-emerald-300 text-xs mb-4 text-left w-full shadow-lg">
                          <p className="font-semibold flex items-center gap-1.5"><Check size={14} /> Job Dispatched</p>
                          <p className="mt-1 opacity-90">{transcribeSuccess}</p>
                        </div>
                      ) : (
                        <button
                          onClick={handleGenerateTranscript}
                          disabled={transcribing}
                          className="flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl shadow-lg shadow-indigo-600/25 transition-all hover:scale-105 cursor-pointer"
                        >
                          {transcribing ? <Loader size={14} className="animate-spin" /> : <Sparkles size={14} />}
                          {transcribing ? 'Dispatching GitHub Action…' : '⚡ Transcribe with AssemblyAI Now'}
                        </button>
                      )}
                    </div>
                  )}

                  {!transcriptLoading && !transcriptError && transcriptRaw && filteredUtterances.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-24 text-center text-slate-500">
                      <Search size={32} className="mb-3 text-slate-600" />
                      <p className="text-sm font-medium">No speaker turns match your search/filter.</p>
                      <button
                        onClick={() => { setSearch(''); setSpeakerFilter('ALL'); }}
                        className="mt-3 text-xs text-indigo-400 hover:text-indigo-300 underline cursor-pointer"
                      >
                        Reset filters
                      </button>
                    </div>
                  )}

                  {/* ── Centered Reading Flow Container ── */}
                  {!transcriptLoading && !transcriptError && filteredUtterances.length > 0 && (
                    <div className="max-w-3xl mx-auto space-y-3.5 pb-24">
                      {filteredUtterances.map((utterance, idx) => {
                        const isPlayingThisUtterance = activeUtteranceIndex === idx;
                        const theme = getSpeakerTheme(utterance.speaker, savedSpeakers);
                        const isEditingThisSpeaker = editingSpeakerKey === utterance.rawSpeaker;
                        const initialChar = utterance.speaker.replace(/^Speaker\s+/i, '').trim().charAt(0).toUpperCase() || 'S';

                        return (
                          <div
                            id={`utterance-card-${idx}`}
                            key={utterance.id}
                            onClick={() => handlePlayUtterance(utterance.startSec)}
                            className={`group flex items-start gap-3.5 p-4 rounded-2xl border transition-all cursor-pointer relative ${
                              isPlayingThisUtterance
                                ? 'bg-indigo-950/40 border-indigo-500/80 shadow-xl shadow-indigo-500/10 ring-1 ring-indigo-500/40'
                                : 'bg-slate-900/50 border-slate-800/80 hover:bg-slate-900 hover:border-slate-700/80 hover:shadow-md'
                            }`}
                          >
                            {/* Speaker Avatar Badge */}
                            <div
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingSpeakerKey(utterance.rawSpeaker);
                                setEditingSpeakerVal(utterance.speaker);
                              }}
                              className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs flex-shrink-0 shadow-sm mt-0.5 transition-transform group-hover:scale-105 ${theme.avatar} cursor-pointer`}
                              title={`Click to rename ${utterance.speaker}`}
                            >
                              {theme.emoji ? (
                                <span className="text-base select-none">{theme.emoji}</span>
                              ) : (
                                <span>{initialChar}</span>
                              )}
                            </div>

                            {/* Utterance Body */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                                <div className="flex items-center gap-2 relative">
                                  {/* Inline Editable Speaker Tag */}
                                  {isEditingThisSpeaker ? (
                                    <div
                                      className="relative flex items-center gap-1.5"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <input
                                        type="text"
                                        autoFocus
                                        value={editingSpeakerVal}
                                        onChange={(e) => setEditingSpeakerVal(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') saveSpeakerRename(utterance.rawSpeaker, editingSpeakerVal);
                                          if (e.key === 'Escape') setEditingSpeakerKey(null);
                                        }}
                                        placeholder={utterance.rawSpeaker}
                                        className="px-2.5 py-1 text-xs font-bold bg-slate-950 border-2 border-indigo-500 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-400 w-44 shadow-lg shadow-indigo-500/20"
                                      />
                                      <button
                                        onClick={() => saveSpeakerRename(utterance.rawSpeaker, editingSpeakerVal)}
                                        className="p-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md text-[10px]"
                                        title="Save name"
                                      >
                                        <Check size={11} />
                                      </button>
                                      <button
                                        onClick={() => setEditingSpeakerKey(null)}
                                        className="p-1 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-md text-[10px]"
                                        title="Cancel"
                                      >
                                        <X size={11} />
                                      </button>

                                      {/* Quick-Pick Popover for Saved Permanent Speakers */}
                                      <div className="absolute left-0 top-full mt-2 w-64 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-40 p-2 space-y-1 animate-in fade-in slide-in-from-top-1">
                                        <div className="flex items-center justify-between px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-800">
                                          <span className="flex items-center gap-1">
                                            <Star size={10} className="text-amber-400 fill-amber-400" />
                                            Saved Speakers
                                          </span>
                                          <button
                                            onClick={() => setShowSavedSpeakersModal(true)}
                                            className="text-indigo-400 hover:text-indigo-300 font-normal lowercase cursor-pointer"
                                          >
                                            manage
                                          </button>
                                        </div>

                                        <div className="max-h-48 overflow-y-auto space-y-0.5 pt-1">
                                          {savedSpeakers
                                            .filter(s => !editingSpeakerVal.trim() || s.name.toLowerCase().includes(editingSpeakerVal.toLowerCase()))
                                            .map(s => (
                                              <button
                                                key={s.id || s.name}
                                                onClick={() => saveSpeakerRename(utterance.rawSpeaker, s.name)}
                                                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg hover:bg-slate-800 text-left text-xs transition-colors group cursor-pointer"
                                              >
                                                <div className="flex items-center gap-2">
                                                  <span className="text-sm">{s.avatarEmoji || '🎙️'}</span>
                                                  <span className="font-semibold text-slate-200 group-hover:text-white">{s.name}</span>
                                                </div>
                                                {s.role && (
                                                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 group-hover:bg-slate-700">
                                                    {s.role}
                                                  </span>
                                                )}
                                              </button>
                                            ))}
                                        </div>

                                        {editingSpeakerVal.trim() && !savedSpeakers.some(s => s.name.toLowerCase() === editingSpeakerVal.trim().toLowerCase()) && (
                                          <button
                                            onClick={() => {
                                              quickSaveToPermanent(editingSpeakerVal);
                                              saveSpeakerRename(utterance.rawSpeaker, editingSpeakerVal);
                                            }}
                                            className="w-full mt-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 text-[11px] font-semibold transition-colors border border-indigo-500/30 cursor-pointer"
                                          >
                                            <Plus size={12} />
                                            <span>Save "{editingSpeakerVal}" as Permanent</span>
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setEditingSpeakerKey(utterance.rawSpeaker);
                                        setEditingSpeakerVal(utterance.speaker);
                                      }}
                                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg border text-xs font-semibold ${theme.badge} hover:ring-1 hover:ring-indigo-400/60 transition-all cursor-pointer group/tag`}
                                      title="Click to rename this speaker across all turns"
                                    >
                                      {theme.emoji ? (
                                        <span className="text-xs">{theme.emoji}</span>
                                      ) : (
                                        <span className={`w-1.5 h-1.5 rounded-full ${theme.dot}`} />
                                      )}
                                      <span>{utterance.speaker}</span>
                                      <Pencil size={10} className="opacity-40 group-hover/tag:opacity-100 transition-opacity ml-0.5 text-slate-300" />
                                    </button>
                                  )}

                                  {/* Timestamp Seek Button */}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handlePlayUtterance(utterance.startSec);
                                    }}
                                    className="inline-flex items-center gap-1 text-[11px] font-mono font-medium px-2 py-0.5 rounded-md bg-slate-800/80 hover:bg-indigo-500/20 text-slate-400 hover:text-indigo-300 border border-slate-700/60 transition-colors"
                                    title="Click to seek playback to this moment"
                                  >
                                    <Play size={9} className="text-indigo-400 fill-indigo-400/40" />
                                    <span>{utterance.startLabel}</span>
                                    {utterance.endLabel && (
                                      <span className="text-slate-500 font-normal">
                                        - {utterance.endLabel}
                                      </span>
                                    )}
                                  </button>
                                </div>

                                {isPlayingThisUtterance && (
                                  <span className="flex items-center gap-1.5 text-[10px] font-bold text-indigo-400 uppercase tracking-wider bg-indigo-500/15 px-2.5 py-0.5 rounded-full border border-indigo-500/30 animate-pulse">
                                    <Volume2 size={11} /> Speaking Now
                                  </span>
                                )}
                              </div>

                              {/* Spoken Text with Comfortable Reading Typography */}
                              <p className={`text-[15px] leading-relaxed transition-colors select-text ${
                                isPlayingThisUtterance ? 'text-white font-medium' : 'text-slate-100'
                              }`}>
                                {highlightMatch(utterance.text, search)}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Rename Speakers Modal with Quick-Select Chips ── */}
      {showRenameModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  <Users size={16} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Rename Episode Speakers</h3>
                  <p className="text-[11px] text-slate-400">Click a saved speaker chip or type a custom name</p>
                </div>
              </div>
              <button
                onClick={() => setShowRenameModal(false)}
                className="p-1.5 text-slate-500 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Quick-select chips from permanent roster */}
            {savedSpeakers.length > 0 && (
              <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl space-y-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                  <Star size={10} className="text-amber-400 fill-amber-400" />
                  Quick-Pick Saved Speakers:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {savedSpeakers.map(s => (
                    <button
                      key={s.id || s.name}
                      onClick={() => {
                        // find first unassigned speaker
                        const unassigned = speakerStats.find(st => !speakerMap[st.rawSpeaker] && st.displayName !== s.name);
                        if (unassigned) {
                          saveSpeakerRename(unassigned.rawSpeaker, s.name);
                        }
                      }}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-700/80 rounded-lg text-xs text-slate-200 hover:text-white transition-colors cursor-pointer"
                      title={`Assign ${s.name} (${s.role || 'Speaker'})`}
                    >
                      <span>{s.avatarEmoji || '🎙️'}</span>
                      <span className="font-semibold">{s.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
              {speakerStats.map(({ rawSpeaker, displayName, count }) => {
                const theme = getSpeakerTheme(displayName, savedSpeakers);
                return (
                  <div key={rawSpeaker} className="flex items-center justify-between gap-3 p-3 bg-slate-950 border border-slate-800 rounded-xl">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg border text-xs font-bold ${theme.badge}`}>
                        {theme.emoji ? <span>{theme.emoji}</span> : <span className={`w-1.5 h-1.5 rounded-full ${theme.dot}`} />}
                        {rawSpeaker}
                      </span>
                      <span className="text-[10px] text-slate-500">({count} turns)</span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        placeholder={rawSpeaker}
                        value={speakerMap[rawSpeaker] || ''}
                        onChange={(e) => saveSpeakerRename(rawSpeaker, e.target.value)}
                        className="px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 focus:border-indigo-500 rounded-lg text-white placeholder-slate-600 focus:outline-none w-44"
                      />
                      {speakerMap[rawSpeaker] && (
                        <button
                          onClick={() => quickSaveToPermanent(speakerMap[rawSpeaker])}
                          className="p-1.5 text-amber-400 hover:text-amber-300 hover:bg-amber-500/20 rounded-lg transition-colors border border-amber-500/20"
                          title={`Save "${speakerMap[rawSpeaker]}" to Permanent Speakers`}
                        >
                          <Star size={12} className="fill-amber-400/40" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-800 gap-2">
              <button
                onClick={resetAllSpeakerNames}
                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-red-400 transition-colors cursor-pointer"
              >
                <RotateCcw size={12} /> Reset
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleSaveToGitHub}
                  disabled={savingGitHub || !Object.keys(speakerMap).length}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer shadow-lg shadow-emerald-600/20"
                >
                  {savingGitHub ? <Loader size={12} className="animate-spin" /> : <Save size={12} />}
                  {savingGitHub ? 'Saving…' : 'Save to GitHub'}
                </button>

                <button
                  onClick={() => setShowRenameModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Permanent Saved Speakers Directory Modal ── */}
      {showSavedSpeakersModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  <Star size={18} className="fill-amber-400/40" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Permanent Saved Speakers</h3>
                  <p className="text-xs text-slate-400">These profiles appear as quick-pick options on every space</p>
                </div>
              </div>
              <button
                onClick={() => setShowSavedSpeakersModal(false)}
                className="p-1.5 text-slate-500 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Existing Saved Speakers Roster */}
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {savedSpeakers.map(s => {
                const theme = getSpeakerTheme(s.name, savedSpeakers);
                return (
                  <div key={s.id || s.name} className="flex items-center justify-between p-3 bg-slate-950 border border-slate-800 rounded-xl">
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg shadow-sm ${theme.avatar}`}>
                        {s.avatarEmoji || '🎙️'}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-white">{s.name}</span>
                          {s.role && (
                            <span className="px-2 py-0.5 text-[10px] rounded-full bg-slate-800 text-slate-300 font-medium border border-slate-700">
                              {s.role}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-500 capitalize">{s.color || 'indigo'} theme</span>
                      </div>
                    </div>

                    <button
                      onClick={() => deletePermanentSpeaker(s.id || s.name)}
                      className="p-1.5 text-slate-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
                      title={`Remove ${s.name}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Add New Speaker Form */}
            <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl space-y-3">
              <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <UserPlus size={13} className="text-indigo-400" />
                Add New Permanent Speaker
              </span>

              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="Speaker Name (e.g. Rick)"
                  value={newSpeakerName}
                  onChange={(e) => setNewSpeakerName(e.target.value)}
                  className="col-span-2 px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />

                <select
                  value={newSpeakerRole}
                  onChange={(e) => setNewSpeakerRole(e.target.value)}
                  className="px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-slate-300 focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  <option value="Host">Host</option>
                  <option value="Co-Host">Co-Host</option>
                  <option value="Special Guest">Special Guest</option>
                  <option value="Speaker">Speaker</option>
                </select>

                <select
                  value={newSpeakerColor}
                  onChange={(e) => setNewSpeakerColor(e.target.value)}
                  className="px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-slate-300 focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  <option value="indigo">Indigo</option>
                  <option value="purple">Purple</option>
                  <option value="emerald">Emerald</option>
                  <option value="sky">Sky Blue</option>
                  <option value="amber">Amber</option>
                  <option value="rose">Rose</option>
                  <option value="cyan">Cyan</option>
                  <option value="teal">Teal</option>
                  <option value="orange">Orange</option>
                  <option value="fuchsia">Fuchsia</option>
                </select>
              </div>

              {/* Emoji quick selector */}
              <div className="flex items-center gap-1.5 flex-wrap pt-1">
                <span className="text-[10px] text-slate-500 font-medium">Emoji:</span>
                {['🎙️', '👩‍🎨', '⚡', '🛸', '🎧', '🌸', '👑', '👽', '🤖', '🔥', '⭐', '💡', '💬', '🕵️'].map(emoji => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => setNewSpeakerEmoji(emoji)}
                    className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm transition-all cursor-pointer ${
                      newSpeakerEmoji === emoji ? 'bg-indigo-600 text-white scale-110 shadow' : 'bg-slate-900 hover:bg-slate-800'
                    }`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>

              <button
                onClick={() => {
                  if (newSpeakerName.trim()) {
                    addOrUpdatePermanentSpeaker({
                      id: newSpeakerName.trim().toLowerCase().replace(/\s+/g, '-'),
                      name: newSpeakerName.trim(),
                      avatarEmoji: newSpeakerEmoji,
                      color: newSpeakerColor,
                      role: newSpeakerRole,
                    });
                    setNewSpeakerName('');
                  }
                }}
                disabled={!newSpeakerName.trim()}
                className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-lg shadow-indigo-600/20"
              >
                <Plus size={13} />
                Add to Permanent Directory
              </button>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-800">
              <button
                onClick={() => setShowSavedSpeakersModal(false)}
                className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TranscriptPanel;
