import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  FileText, RefreshCw, AlertCircle, Search, ChevronDown, Loader,
  ExternalLink, Play, Pause, Volume2, Copy, Check, Download,
  SlidersHorizontal, ArrowDownCircle, Sparkles, Pencil, Users, X, RotateCcw,
  Save, CloudCheck, CheckCircle2, Star, Plus, Trash2, UserPlus, Sparkle, Clock
} from 'lucide-react';
import { Release, EnhancedConfig } from '../types';
import { getReleases, fetchReleaseAssetText, dispatchWorkflow, updateReleaseTranscriptAssets } from '../utils/github';
import { usePlayer, NowPlayingEpisode } from '../contexts/PlayerContext';
import { getEpisodeRecordedDate, sortReleasesByRecordedDate } from '../utils/dates';

interface Props {
  config: EnhancedConfig;
  initialReleaseId?: number | null;
}

export interface ParsedUtterance {
  id: string;
  startSec: number;
  endSec: number | null;
  rawStartSec: number;
  rawEndSec: number | null;
  startLabel: string;
  endLabel: string;
  speaker: string;
  rawSpeaker: string;
  text: string;
  raw: string;
  confidence?: number | null;
  wordCount?: number;
}

interface TranscriptMetadata {
  model?: string;
  language?: string;
  confidence?: number | null;
  audioDurationSec?: number | null;
  transcriptId?: string;
}

type ReleaseAssetLike = {
  name: string;
  size?: number;
  updated_at?: string;
};

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
  const cleaned = timeStr.trim().replace(/^\[|\]$/g, '');
  const parts = cleaned.split(':').map(Number);
  if (parts.some(Number.isNaN)) return 0;
  if (parts.length === 3) return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
  if (parts.length === 2) return (parts[0] || 0) * 60 + (parts[1] || 0);
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : 0;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function inferNumericTimestampScale(segments: any[]): 1 | 1000 {
  const numeric = segments.slice(0, 100).filter(s => typeof s?.start === 'number' || typeof s?.end === 'number');
  if (!numeric.length) return 1;
  const durations = numeric
    .filter(s => Number.isFinite(s?.start) && Number.isFinite(s?.end) && s.end > s.start)
    .map(s => s.end - s.start);
  const values = numeric.flatMap(s => [s?.start, s?.end]).filter(Number.isFinite) as number[];
  const maxValue = values.length ? Math.max(...values) : 0;
  const medianDuration = median(durations);
  if (maxValue >= 1_000_000) return 1000;
  if (medianDuration >= 250) return 1000;
  if (maxValue > 86_400 && medianDuration > 60) return 1000;
  return 1;
}

function readTimestampSeconds(segment: any, key: 'start' | 'end', scale: 1 | 1000): number | null {
  const explicitMs = segment?.[`${key}_ms`];
  if (typeof explicitMs === 'number' && Number.isFinite(explicitMs)) return explicitMs / 1000;
  const explicitSec = segment?.[`${key}_sec`] ?? segment?.[`${key}_seconds`];
  if (typeof explicitSec === 'number' && Number.isFinite(explicitSec)) return explicitSec;
  const value = segment?.[key] ?? segment?.[`${key}_time`];
  if (typeof value === 'number' && Number.isFinite(value)) return value / scale;
  if (typeof value === 'string') return parseTimeToSeconds(value);
  return null;
}

function normalizeSpeakerLabel(value: unknown): string {
  const raw = String(value ?? 'A').trim() || 'A';
  if (/^Speaker\s+/i.test(raw)) return raw;
  return raw.length <= 3 ? `Speaker ${raw}` : raw;
}

function isLikelyTranscriptAsset(asset: ReleaseAssetLike): boolean {
  const name = asset.name.toLowerCase();
  if (name.endsWith('.mp3') || name.endsWith('.m4a') || name.endsWith('.wav') || name.endsWith('.jpg') || name.endsWith('.png') || name.endsWith('.jpeg')) {
    return false;
  }
  return /\.(json|txt)$/i.test(name);
}

function transcriptAssetScore(asset: ReleaseAssetLike, releaseTag?: string): number {
  const name = asset.name.toLowerCase();
  let score = 0;
  // JSON format is prioritized because it contains structured utterances and confidence scores
  if (/\.json$/i.test(name)) score += 50;
  if (/\.txt$/i.test(name)) score += 20;

  // Bonus for matching release tag or containing transcript keywords
  if (releaseTag && name.includes(releaseTag.toLowerCase())) score += 40;
  if (/transcript/.test(name)) score += 20;
  if (/diari[sz]/.test(name)) score += 20;
  if (/utterance|speaker/.test(name)) score += 10;
  return score;
}

function pickTranscriptAsset(release: Release): Release['assets'][number] | undefined {
  const textAssets = release.assets.filter(a => isLikelyTranscriptAsset(a));
  if (!textAssets.length) return undefined;
  return [...textAssets].sort((a, b) => transcriptAssetScore(b, release.tag_name) - transcriptAssetScore(a, release.tag_name))[0];
}

function parseTranscriptMetadata(rawContent: string): TranscriptMetadata {
  try {
    const json = JSON.parse(rawContent);
    const durationRaw = json.audio_duration ?? json.audio_duration_seconds ?? json.duration;
    const duration = typeof durationRaw === 'number' && Number.isFinite(durationRaw)
      ? (durationRaw > 100_000 ? durationRaw / 1000 : durationRaw)
      : null;
    return {
      model: json.speech_model ?? json.model ?? json.model_id,
      language: json.language_code ?? json.language ?? json.detected_language,
      confidence: typeof json.confidence === 'number' ? json.confidence : null,
      audioDurationSec: duration,
      transcriptId: json.id ?? json.transcript_id,
    };
  } catch {
    return {};
  }
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
  indigo:  { bg: 'bg-indigo-500/10',  text: 'text-indigo-300',  border: 'border-indigo-500/30',  badge: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',  dot: 'bg-indigo-400',  avatar: 'bg-indigo-600 text-white'  },
  purple:  { bg: 'bg-purple-500/10',  text: 'text-purple-300',  border: 'border-purple-500/30',  badge: 'bg-purple-500/20 text-purple-300 border-purple-500/40',  dot: 'bg-purple-400',  avatar: 'bg-purple-600 text-white'  },
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-300', border: 'border-emerald-500/30', badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', dot: 'bg-emerald-400', avatar: 'bg-emerald-600 text-white' },
  sky:     { bg: 'bg-sky-500/10',     text: 'text-sky-300',     border: 'border-sky-500/30',     badge: 'bg-sky-500/20 text-sky-300 border-sky-500/40',             dot: 'bg-sky-400',     avatar: 'bg-sky-600 text-white'     },
  amber:   { bg: 'bg-amber-500/10',   text: 'text-amber-300',   border: 'border-amber-500/30',   badge: 'bg-amber-500/20 text-amber-300 border-amber-500/40',       dot: 'bg-amber-400',   avatar: 'bg-amber-600 text-white'   },
  rose:    { bg: 'bg-rose-500/10',    text: 'text-rose-300',    border: 'border-rose-500/30',    badge: 'bg-rose-500/20 text-rose-300 border-rose-500/40',           dot: 'bg-rose-400',    avatar: 'bg-rose-600 text-white'    },
  cyan:    { bg: 'bg-cyan-500/10',    text: 'text-cyan-300',    border: 'border-cyan-500/30',    badge: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',           dot: 'bg-cyan-400',    avatar: 'bg-cyan-600 text-white'    },
  fuchsia: { bg: 'bg-fuchsia-500/10', text: 'text-fuchsia-300', border: 'border-fuchsia-500/30', badge: 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40', dot: 'bg-fuchsia-400', avatar: 'bg-fuchsia-600 text-white' },
  teal:    { bg: 'bg-teal-500/10',    text: 'text-teal-300',    border: 'border-teal-500/30',    badge: 'bg-teal-500/20 text-teal-300 border-teal-500/40',           dot: 'bg-teal-400',    avatar: 'bg-teal-600 text-white'    },
  orange:  { bg: 'bg-orange-500/10',  text: 'text-orange-300',  border: 'border-orange-500/30',  badge: 'bg-orange-500/20 text-orange-300 border-orange-500/40',    dot: 'bg-orange-400',  avatar: 'bg-orange-600 text-white'  },
};

const DEFAULT_SAVED_SPEAKERS: SavedSpeaker[] = [
  { id: 'logan',     name: 'Logan',     avatarEmoji: '🎙️', color: 'indigo',  role: 'Host'          },
  { id: 'mary',      name: 'Mary',      avatarEmoji: '👩‍🎨', color: 'purple',  role: 'Co-Host'       },
  { id: 'oor',       name: 'Oor',       avatarEmoji: '⚡',  color: 'sky',     role: 'Speaker'       },
  { id: 'rick-doty', name: 'Rick Doty', avatarEmoji: '🛸',  color: 'emerald', role: 'Special Guest' },
  { id: 'shane',     name: 'Shane',     avatarEmoji: '🎧',  color: 'amber',   role: 'Co-Host'       },
  { id: 'lana',      name: 'Lana',      avatarEmoji: '🌸',  color: 'rose',    role: 'Speaker'       },
];

const SPEAKER_PALETTE: Record<string, { bg: string; text: string; border: string; badge: string; dot: string; avatar: string }> = {
  'A': { bg: 'bg-emerald-500/10', text: 'text-emerald-300', border: 'border-emerald-500/30', badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', dot: 'bg-emerald-400', avatar: 'bg-emerald-600 text-white' },
  'B': { bg: 'bg-sky-500/10',     text: 'text-sky-300',     border: 'border-sky-500/30',     badge: 'bg-sky-500/20 text-sky-300 border-sky-500/40',             dot: 'bg-sky-400',     avatar: 'bg-sky-600 text-white'     },
  'C': { bg: 'bg-purple-500/10',  text: 'text-purple-300',  border: 'border-purple-500/30',  badge: 'bg-purple-500/20 text-purple-300 border-purple-500/40',    dot: 'bg-purple-400',  avatar: 'bg-purple-600 text-white'  },
  'D': { bg: 'bg-amber-500/10',   text: 'text-amber-300',   border: 'border-amber-500/30',   badge: 'bg-amber-500/20 text-amber-300 border-amber-500/40',       dot: 'bg-amber-400',   avatar: 'bg-amber-600 text-white'   },
  'E': { bg: 'bg-rose-500/10',    text: 'text-rose-300',    border: 'border-rose-500/30',    badge: 'bg-rose-500/20 text-rose-300 border-rose-500/40',           dot: 'bg-rose-400',    avatar: 'bg-rose-600 text-white'    },
  'F': { bg: 'bg-cyan-500/10',    text: 'text-cyan-300',    border: 'border-cyan-500/30',    badge: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',           dot: 'bg-cyan-400',    avatar: 'bg-cyan-600 text-white'    },
  'G': { bg: 'bg-violet-500/10',  text: 'text-violet-300',  border: 'border-violet-500/30',  badge: 'bg-violet-500/20 text-violet-300 border-violet-500/40',    dot: 'bg-violet-400',  avatar: 'bg-violet-600 text-white'  },
  'H': { bg: 'bg-teal-500/10',    text: 'text-teal-300',    border: 'border-teal-500/30',    badge: 'bg-teal-500/20 text-teal-300 border-teal-500/40',           dot: 'bg-teal-400',    avatar: 'bg-teal-600 text-white'    },
  'I': { bg: 'bg-indigo-500/10',  text: 'text-indigo-300',  border: 'border-indigo-500/30',  badge: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',    dot: 'bg-indigo-400',  avatar: 'bg-indigo-600 text-white'  },
  'J': { bg: 'bg-orange-500/10',  text: 'text-orange-300',  border: 'border-orange-500/30',  badge: 'bg-orange-500/20 text-orange-300 border-orange-500/40',    dot: 'bg-orange-400',  avatar: 'bg-orange-600 text-white'  },
  'K': { bg: 'bg-pink-500/10',    text: 'text-pink-300',    border: 'border-pink-500/30',    badge: 'bg-pink-500/20 text-pink-300 border-pink-500/40',           dot: 'bg-pink-400',    avatar: 'bg-pink-600 text-white'    },
  'L': { bg: 'bg-lime-500/10',    text: 'text-lime-300',    border: 'border-lime-500/30',    badge: 'bg-lime-500/20 text-lime-300 border-lime-500/40',           dot: 'bg-lime-400',    avatar: 'bg-lime-600 text-white'    },
  'M': { bg: 'bg-fuchsia-500/10', text: 'text-fuchsia-300', border: 'border-fuchsia-500/30', badge: 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40', dot: 'bg-fuchsia-400', avatar: 'bg-fuchsia-600 text-white' },
  'N': { bg: 'bg-yellow-500/10',  text: 'text-yellow-300',  border: 'border-yellow-500/30',  badge: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',    dot: 'bg-yellow-400',  avatar: 'bg-yellow-600 text-white'  },
  'O': { bg: 'bg-blue-500/10',    text: 'text-blue-300',    border: 'border-blue-500/30',    badge: 'bg-blue-500/20 text-blue-300 border-blue-500/40',           dot: 'bg-blue-400',    avatar: 'bg-blue-600 text-white'    },
  'P': { bg: 'bg-emerald-500/10', text: 'text-emerald-300', border: 'border-emerald-500/30', badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', dot: 'bg-emerald-400', avatar: 'bg-emerald-600 text-white' },
};

function getSpeakerTheme(displayName: string, savedSpeakers: SavedSpeaker[] = []) {
  const match = savedSpeakers.find(s => s.name.toLowerCase() === displayName.toLowerCase());
  if (match && match.color && SPEAKER_COLOR_MAP[match.color]) {
    return { ...SPEAKER_COLOR_MAP[match.color], emoji: match.avatarEmoji, role: match.role };
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

  try {
    const json = JSON.parse(rawContent);
    const candidates: any[][] = [];
    const addCandidate = (value: unknown) => {
      if (Array.isArray(value) && value.length > 0) candidates.push(value);
    };
    addCandidate(json.utterances);
    addCandidate(json.segments);
    addCandidate(json.transcript?.utterances);
    addCandidate(json.transcript?.segments);
    addCandidate(json.data?.utterances);
    addCandidate(json.data?.segments);
    addCandidate(json.results?.utterances);
    addCandidate(json.results?.segments);
    if (Array.isArray(json.chunks)) {
      addCandidate(json.chunks.flatMap((c: any) => c?.utterances || c?.segments || []));
    }

    if (candidates.length > 0) {
      const score = (arr: any[]) => arr.reduce((total, seg) => {
        const hasText = typeof seg?.text === 'string' && seg.text.trim().length > 0;
        const hasSpeaker = seg?.speaker !== undefined && seg?.speaker !== null;
        return total + (hasText ? 2 : 0) + (hasSpeaker ? 3 : 0);
      }, 0);
      const rawSegments = [...candidates].sort((a, b) => score(b) - score(a))[0];
      const scale = inferNumericTimestampScale(rawSegments);

      const parsed = rawSegments
        .map((seg: any, idx: number): ParsedUtterance | null => {
          const startSec = Math.max(0, readTimestampSeconds(seg, 'start', scale) ?? 0);
          const parsedEnd = readTimestampSeconds(seg, 'end', scale);
          const endSec = parsedEnd !== null && parsedEnd >= startSec ? parsedEnd : null;
          const formattedSpeaker = normalizeSpeakerLabel(seg?.speaker ?? seg?.speaker_label ?? seg?.speaker_id);
          const rawSpeaker = normalizeSpeakerLabel(seg?.raw_speaker ?? seg?.speaker ?? seg?.speaker_label ?? seg?.speaker_id);
          const text = String(seg?.text ?? seg?.transcript ?? '').trim();
          if (!text) return null;
          const confidence = typeof seg?.confidence === 'number' && Number.isFinite(seg.confidence) ? seg.confidence : null;
          const wordCount = Array.isArray(seg?.words) ? seg.words.length : text.split(/\s+/).filter(Boolean).length;
          return {
            id: `seg-${idx}-${Math.round(startSec * 1000)}`,
            startSec, endSec, rawStartSec: startSec, rawEndSec: endSec,
            startLabel: formatSeconds(startSec),
            endLabel: endSec !== null ? formatSeconds(endSec) : '',
            speaker: formattedSpeaker, rawSpeaker, text,
            raw: `[${formatSeconds(startSec)}${endSec !== null ? ` - ${formatSeconds(endSec)}` : ''}] ${formattedSpeaker}: ${text}`,
            confidence, wordCount,
          };
        })
        .filter((u: ParsedUtterance | null): u is ParsedUtterance => u !== null)
        .sort((a, b) => a.startSec - b.startSec || (a.endSec ?? a.startSec) - (b.endSec ?? b.startSec));

      return parsed.map((utterance, idx) => {
        if (utterance.endSec !== null) return utterance;
        const next = parsed[idx + 1];
        if (!next || next.startSec <= utterance.startSec) return utterance;
        return { ...utterance, endSec: next.startSec, rawEndSec: next.startSec, endLabel: formatSeconds(next.startSec) };
      });
    }
  } catch {
    // fall through to plain-text parser
  }

  const lines = rawContent.split(/\r?\n/);
  const utterances: ParsedUtterance[] = [];
  const lineRegex = /^\[?(\d+:\d{2}(?::\d{2})?(?:\.\d+)?)\s*(?:-\s*(\d+:\d{2}(?::\d{2})?(?:\.\d+)?))?\]?\s*([^:\n\r]+?)\s*:\s*(.*)$/;
  let currentUtterance: ParsedUtterance | null = null;

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const match = trimmed.match(lineRegex);
    if (match) {
      if (currentUtterance) utterances.push(currentUtterance);
      const startSec = parseTimeToSeconds(match[1]);
      const endSec = match[2] ? parseTimeToSeconds(match[2]) : null;
      const formattedSpeaker = normalizeSpeakerLabel(match[3]?.trim() || 'A');
      const text = match[4]?.trim() || '';
      currentUtterance = {
        id: `line-${index}-${Math.round(startSec * 1000)}`,
        startSec, endSec, rawStartSec: startSec, rawEndSec: endSec,
        startLabel: formatSeconds(startSec),
        endLabel: endSec !== null ? formatSeconds(endSec) : '',
        speaker: formattedSpeaker, rawSpeaker: formattedSpeaker, text, raw: trimmed,
        wordCount: text.split(/\s+/).filter(Boolean).length,
      };
    } else if (currentUtterance) {
      currentUtterance.text += ` ${trimmed}`;
      currentUtterance.raw += `\n${trimmed}`;
      currentUtterance.wordCount = currentUtterance.text.split(/\s+/).filter(Boolean).length;
    } else {
      utterances.push({
        id: `raw-${index}`, startSec: 0, endSec: null, rawStartSec: 0, rawEndSec: null,
        startLabel: '00:00', endLabel: '', speaker: 'Transcript', rawSpeaker: 'Transcript',
        text: trimmed, raw: trimmed, wordCount: trimmed.split(/\s+/).filter(Boolean).length,
      });
    }
  });
  if (currentUtterance) utterances.push(currentUtterance);
  return utterances;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

const TranscriptPanel: React.FC<Props> = ({ config, initialReleaseId }) => {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(initialReleaseId ?? null);
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

  const [speakerMap, setSpeakerMap] = useState<Record<string, string>>({});
  const [editingSpeakerKey, setEditingSpeakerKey] = useState<string | null>(null);
  const [editingSpeakerVal, setEditingSpeakerVal] = useState('');
  const [showRenameModal, setShowRenameModal] = useState(false);

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

  const [savingGitHub, setSavingGitHub] = useState(false);
  const [saveGitHubSuccess, setSaveGitHubSuccess] = useState('');
  const [saveGitHubError, setSaveGitHubError] = useState('');

  const currentLoadedIdRef = useRef<number | null>(null);
  const transcriptionPollRef = useRef<number | null>(null);
  const lastAutoScrolledUtteranceRef = useRef<string | null>(null);

  const { play, seek, currentTime, isPlaying, current, togglePlay } = usePlayer();
  const hasCredentials = !!(config.githubToken && config.ownerName && config.repoName);

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

  const quickSaveToPermanent = (name: string, emoji = '🎙️', color = 'indigo') => {
    const trimmed = name.trim();
    if (!trimmed) return;
    addOrUpdatePermanentSpeaker({ id: trimmed.toLowerCase().replace(/\s+/g, '-'), name: trimmed, avatarEmoji: emoji, color, role: 'Speaker' });
  };

  useEffect(() => {
    if (selectedId) {
      try {
        const saved = localStorage.getItem(`spk_names_${selectedId}`);
        setSpeakerMap(saved ? JSON.parse(saved) : {});
      } catch { setSpeakerMap({}); }
    }
  }, [selectedId]);

  const saveSpeakerRename = (rawSpeaker: string, newName: string) => {
    const trimmed = newName.trim();
    if (!selectedId) return;
    setSpeakerMap(prev => {
      const next = { ...prev };
      if (trimmed && trimmed !== rawSpeaker) { next[rawSpeaker] = trimmed; } else { delete next[rawSpeaker]; }
      try { localStorage.setItem(`spk_names_${selectedId}`, JSON.stringify(next)); } catch {}
      return next;
    });
    setEditingSpeakerKey(null);
  };

  const resetAllSpeakerNames = () => {
    if (!selectedId) return;
    setSpeakerMap({});
    try { localStorage.removeItem(`spk_names_${selectedId}`); } catch {}
  };

  const setAndSaveTimeOffset = (offset: number | ((prev: number) => number)) => {
    setTimeOffsetSec(prev => {
      const next = typeof offset === 'function' ? offset(prev) : offset;
      if (selectedId) {
        try {
          if (next === 0) { localStorage.removeItem(`spk_offset_${selectedId}`); }
          else { localStorage.setItem(`spk_offset_${selectedId}`, next.toString()); }
        } catch {}
      }
      return next;
    });
  };

  const fetchReleases = useCallback(async () => {
    if (!hasCredentials) return;
    setLoading(true);
    setError('');
    currentLoadedIdRef.current = null;
    try {
      const data = await getReleases(config.githubToken, config.ownerName.trim(), config.repoName.trim());
      setReleases(sortReleasesByRecordedDate(data));
      setLoaded(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [config.githubToken, config.ownerName, config.repoName, hasCredentials]);

  useEffect(() => {
    if (hasCredentials && !loaded && !loading) fetchReleases();
  }, [hasCredentials, loaded, loading, fetchReleases]);

  const loadTranscript = useCallback(async (release: Release) => {
    const asset = pickTranscriptAsset(release);
    setSelectedId(release.id);
    setSearch('');
    setSpeakerFilter('ALL');
    setTranscribeSuccess('');
    try {
      const savedOffset = localStorage.getItem(`spk_offset_${release.id}`);
      setTimeOffsetSec(savedOffset ? parseFloat(savedOffset) : 0);
    } catch { setTimeOffsetSec(0); }
    setEditingSpeakerKey(null);
    setSaveGitHubSuccess('');
    setSaveGitHubError('');

    if (!asset) { setTranscriptRaw(''); setTranscriptError(''); return; }

    setTranscriptLoading(true);
    setTranscriptError('');
    setTranscriptRaw('');

    try {
      const text = await fetchReleaseAssetText(
        config.githubToken, asset, config.ownerName.trim(), config.repoName.trim()
      );
      setTranscriptRaw(text);

      // Auto-clear stale offsets that would push the first segment to negative time
      try {
        const savedOffset = localStorage.getItem(`spk_offset_${release.id}`);
        if (savedOffset) {
          const first = parseTranscriptData(text)[0];
          const rawOffset = Number.parseFloat(savedOffset);
          if (!Number.isFinite(rawOffset) || (first && first.rawStartSec + rawOffset < 0)) {
            localStorage.removeItem(`spk_offset_${release.id}`);
            setTimeOffsetSec(0);
          }
        }
      } catch { /* localStorage may be unavailable */ }
    } catch (e) {
      setTranscriptError((e as Error).message);
    } finally {
      setTranscriptLoading(false);
    }
  }, [config.githubToken, config.ownerName, config.repoName]);

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
        const data = await getReleases(config.githubToken, config.ownerName.trim(), config.repoName.trim());
        setReleases(data);
        const updated = data.find(r => r.id === releaseId);
        if (updated && pickTranscriptAsset(updated)) {
          stopTranscriptPolling();
          currentLoadedIdRef.current = releaseId;
          await loadTranscript(updated);
          setTranscribeSuccess('Transcription completed and loaded automatically.');
        }
      } catch { /* polling is best-effort */ }
    }, 12_000);
  }, [config.githubToken, config.ownerName, config.repoName, loadTranscript, stopTranscriptPolling]);

  const handleGenerateTranscript = async () => {
    if (!selectedRelease || !hasCredentials) return;
    setTranscribing(true);
    setTranscribeSuccess('');
    setTranscriptError('');
    try {
      await dispatchWorkflow(config.githubToken, config.ownerName.trim(), config.repoName.trim(), 'transcribe_episode.yml', { release_tag: selectedRelease.tag_name });
      setTranscribeSuccess(`Workflow dispatched for ${selectedRelease.tag_name}. Your local RTX 4060 Ti runner is transcribing and diarizing the audio; this page will check automatically for completion.`);
      startTranscriptPolling(selectedRelease.id);
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
        if (rel) { currentLoadedIdRef.current = selectedId; loadTranscript(rel); }
      }
    } else if (releases.length > 0 && !selectedId) {
      const first = releases.find(r => !!pickTranscriptAsset(r)) || releases[0];
      if (first && currentLoadedIdRef.current !== first.id) {
        currentLoadedIdRef.current = first.id;
        loadTranscript(first);
      }
    }
  }, [releases, selectedId, loadTranscript]);

  const selectedRelease = releases.find(r => r.id === selectedId);
  const transcriptMetadata = useMemo(() => parseTranscriptMetadata(transcriptRaw), [transcriptRaw]);
  const mp3Asset = useMemo(() => selectedRelease?.assets.find(a => a.name.endsWith('.mp3')) ?? null, [selectedRelease]);
  const isCurrentEpisodePlaying = current?.id === selectedRelease?.id && isPlaying;

  const parsedUtterances = useMemo(() => parseTranscriptData(transcriptRaw), [transcriptRaw]);

  const utterances = useMemo(() => parsedUtterances.map(u => {
    const adjustedStart = Math.max(0, u.rawStartSec + timeOffsetSec);
    const adjustedEnd = u.rawEndSec !== null ? Math.max(0, u.rawEndSec + timeOffsetSec) : null;
    return {
      ...u,
      startSec: adjustedStart,
      endSec: adjustedEnd,
      startLabel: formatSeconds(adjustedStart),
      endLabel: adjustedEnd !== null ? formatSeconds(adjustedEnd) : '',
      speaker: speakerMap[u.rawSpeaker] || u.speaker,
    };
  }), [parsedUtterances, speakerMap, timeOffsetSec]);

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

  const filteredUtterances = useMemo(() => utterances.filter(u => {
    if (speakerFilter !== 'ALL' && u.speaker !== speakerFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return u.text.toLowerCase().includes(q) || u.speaker.toLowerCase().includes(q);
    }
    return true;
  }), [utterances, speakerFilter, search]);

  const matchCount = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return 0;
    return utterances.filter(u => u.text.toLowerCase().includes(q) || u.speaker.toLowerCase().includes(q)).length;
  }, [search, utterances]);

  // Binary search — O(log n) active utterance lookup
  const activeUtteranceIndex = useMemo(() => {
    if (current?.id !== selectedRelease?.id || !utterances.length) return -1;
    let lo = 0, hi = utterances.length - 1, candidate = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (utterances[mid].startSec <= currentTime) { candidate = mid; lo = mid + 1; }
      else { hi = mid - 1; }
    }
    if (candidate < 0) return -1;
    const u = utterances[candidate];
    const effectiveEnd = u.endSec ?? utterances[candidate + 1]?.startSec ?? Number.POSITIVE_INFINITY;
    return currentTime < effectiveEnd ? candidate : -1;
  }, [current?.id, selectedRelease?.id, utterances, currentTime]);

  // ID-based comparison is filter-safe (index comparison would break under search/filter)
  const activeUtteranceId = activeUtteranceIndex >= 0 ? utterances[activeUtteranceIndex]?.id ?? null : null;

  useEffect(() => {
    if (!autoScroll || !activeUtteranceId || lastAutoScrolledUtteranceRef.current === activeUtteranceId) return;
    const el = document.getElementById(`utterance-card-${activeUtteranceId}`);
    if (el) {
      lastAutoScrolledUtteranceRef.current = activeUtteranceId;
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [autoScroll, activeUtteranceId]);

  const handlePlayUtterance = (startSec: number) => {
    if (!selectedRelease || !mp3Asset) return;
    const nowPlaying: NowPlayingEpisode = { id: selectedRelease.id, title: selectedRelease.name || selectedRelease.tag_name, audioUrl: mp3Asset.browser_download_url };
    if (current?.id !== selectedRelease.id) { play(nowPlaying, startSec); }
    else { seek(startSec); if (!isPlaying) togglePlay(); }
  };

  const handlePlayEpisodeToggle = () => {
    if (!selectedRelease || !mp3Asset) return;
    const nowPlaying: NowPlayingEpisode = { id: selectedRelease.id, title: selectedRelease.name || selectedRelease.tag_name, audioUrl: mp3Asset.browser_download_url };
    if (current?.id === selectedRelease.id) { togglePlay(); } else { play(nowPlaying); }
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
      await updateReleaseTranscriptAssets(config.githubToken, config.ownerName.trim(), config.repoName.trim(), selectedRelease, text, jsonData);
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
          {/* Diagnostic sync readout — only shown while playing */}
          {isPlaying && (
            <div className="mt-3 flex items-center gap-4 text-[10px] font-mono text-emerald-400 bg-emerald-950/30 px-3 py-1.5 rounded border border-emerald-900/50">
              <span title="Current audio element time">Audio: {currentTime.toFixed(2)}s ({formatSeconds(currentTime)})</span>
              <span className="text-emerald-700">|</span>
              <span title="Currently highlighted segment">
                Active: {activeUtteranceIndex >= 0
                  ? `[${utterances[activeUtteranceIndex].startSec.toFixed(2)} – ${utterances[activeUtteranceIndex].endSec?.toFixed(2) ?? '?'}]`
                  : 'None'}
              </span>
              <span className="text-emerald-700">|</span>
              <span title="Global sync offset">Offset: {timeOffsetSec}s</span>
            </div>
          )}
        </div>

        <button onClick={fetchReleases} disabled={loading || !hasCredentials}
          className="flex items-center gap-2 px-3.5 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 rounded-lg transition-colors border border-slate-700 cursor-pointer">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {!hasCredentials && (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
          <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl mb-4"><AlertCircle size={28} className="text-slate-500" /></div>
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
          <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl mb-4"><FileText size={28} className="text-slate-500" /></div>
          <p className="text-slate-300 text-sm font-medium">No Episodes Found</p>
          <p className="text-slate-500 text-xs mt-1 max-w-sm">Run your ingest pipeline to download Spaces and generate transcripts.</p>
        </div>
      )}

      {hasCredentials && loaded && releases.length > 0 && (
        <div className="flex-1 flex min-h-0">

          {/* ── Sidebar ── */}
          <div className="w-72 md:w-80 flex-shrink-0 border-r border-slate-800 overflow-y-auto bg-slate-950/70 divide-y divide-slate-900">
            <div className="p-3 bg-slate-900/50 border-b border-slate-800">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Select Episode ({releases.length})</span>
            </div>
            {releases.map(release => {
              const hasTxt = !!pickTranscriptAsset(release);
              const isSelected = selectedId === release.id;
              const isPlayingThis = current?.id === release.id && isPlaying;
              return (
                <button key={release.id} onClick={() => loadTranscript(release)}
                  className={`w-full text-left p-3.5 transition-all flex items-start gap-3 group relative cursor-pointer ${isSelected ? 'bg-indigo-600/15 border-l-4 border-l-indigo-500 text-white' : 'hover:bg-slate-900/80 text-slate-300'}`}>
                  <div className={`mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${isPlayingThis ? 'bg-indigo-500 text-white animate-pulse' : isSelected ? 'bg-indigo-500/20 text-indigo-400' : 'bg-slate-800 text-slate-500 group-hover:text-slate-300'}`}>
                    {isPlayingThis ? <Volume2 size={13} /> : <FileText size={13} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-semibold truncate ${isSelected ? 'text-white font-bold' : 'text-slate-300'}`}>{release.name || release.tag_name}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-[10px] text-slate-400">{getEpisodeRecordedDate(release).displayDate}</span>
                      {hasTxt
                        ? <span className="px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded text-[9px] font-medium">Transcript Ready</span>
                        : <span className="px-1.5 py-0.5 bg-slate-800 text-slate-500 rounded text-[9px]">Audio Only</span>}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* ── Main View ── */}
          <div className="flex-1 flex flex-col min-w-0 bg-slate-950">
            {!selectedRelease && (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                <ChevronDown size={28} className="text-slate-700 mb-3 rotate-90" />
                <p className="text-slate-500 text-sm">Select an episode from the sidebar to view its transcript</p>
              </div>
            )}

            {selectedRelease && (<>

              {/* Episode Player Header */}
              <div className="p-4 md:px-6 bg-slate-900/90 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {mp3Asset && (
                    <button onClick={handlePlayEpisodeToggle}
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-md transition-all cursor-pointer ${isCurrentEpisodePlaying ? 'bg-indigo-500 text-white shadow-indigo-500/30' : 'bg-indigo-600 hover:bg-indigo-500 text-white hover:scale-105 shadow-indigo-600/20'}`}
                      title={isCurrentEpisodePlaying ? 'Pause Audio' : 'Play Episode Audio'}>
                      {isCurrentEpisodePlaying ? <Pause size={16} /> : <Play size={16} className="translate-x-0.5" />}
                    </button>
                  )}
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-white truncate max-w-md">{selectedRelease.name || selectedRelease.tag_name}</h3>
                    <p className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-slate-300 font-medium">{getEpisodeRecordedDate(selectedRelease).displayDate}</span>
                      {utterances.length > 0 && <><span>•</span><span className="text-indigo-400 font-medium">{utterances.length} turns</span></>}
                      {speakerStats.length > 0 && <><span>•</span><span className="text-emerald-400">{speakerStats.length} speaker{speakerStats.length > 1 ? 's' : ''}</span></>}
                      {transcriptMetadata.model && <><span>•</span><span className="text-cyan-400" title="Speech-to-text model">{transcriptMetadata.model}</span></>}
                      {transcriptMetadata.language && <><span>•</span><span className="text-slate-400 uppercase">{transcriptMetadata.language}</span></>}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={() => setShowSavedSpeakersModal(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-xs font-semibold rounded-lg transition-colors border border-amber-500/30 cursor-pointer shadow-sm">
                    <Star size={12} className="text-amber-400 fill-amber-400/30" /> Saved Speakers ({savedSpeakers.length})
                  </button>
                  {speakerStats.length > 0 && (
                    <button onClick={() => setShowRenameModal(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 text-xs font-semibold rounded-lg transition-colors border border-indigo-500/40 cursor-pointer">
                      <Users size={12} /> Rename Speakers
                    </button>
                  )}
                  {speakerStats.length > 0 && (
                    <button onClick={handleSaveToGitHub} disabled={savingGitHub || (!Object.keys(speakerMap).length && timeOffsetSec === 0)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 disabled:opacity-40 text-emerald-300 text-xs font-semibold rounded-lg transition-colors border border-emerald-500/40 cursor-pointer shadow-sm">
                      {savingGitHub ? <Loader size={12} className="animate-spin text-emerald-400" /> : <Save size={12} />}
                      {savingGitHub ? 'Saving…' : 'Save to GitHub'}
                    </button>
                  )}
                  <button onClick={handleCopyTranscript} disabled={!utterances.length}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-xs font-medium rounded-lg transition-colors border border-slate-700 cursor-pointer">
                    {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                  <button onClick={() => handleDownloadTranscript('txt')} disabled={!utterances.length}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-xs font-medium rounded-lg transition-colors border border-slate-700 cursor-pointer">
                    <Download size={12} /> .txt
                  </button>
                  <button onClick={() => handleDownloadTranscript('json')} disabled={!utterances.length}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-xs font-medium rounded-lg transition-colors border border-slate-700 cursor-pointer">
                    <Download size={12} /> .json
                  </button>
                  <a href={selectedRelease.html_url} target="_blank" rel="noopener noreferrer"
                    className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded-lg transition-colors border border-slate-800">
                    <ExternalLink size={13} />
                  </a>
                </div>
              </div>

              {saveGitHubSuccess && (
                <div className="mx-4 md:mx-6 mt-3 flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-300 text-xs">
                  <CheckCircle2 size={15} className="text-emerald-400 flex-shrink-0" /><span>{saveGitHubSuccess}</span>
                </div>
              )}
              {saveGitHubError && (
                <div className="mx-4 md:mx-6 mt-3 flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300 text-xs">
                  <AlertCircle size={15} className="text-red-400 flex-shrink-0" /><span>{saveGitHubError}</span>
                </div>
              )}

              {/* Filter & Sync Toolbar */}
              <div className="p-3 md:px-6 bg-slate-900/50 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-[240px]">
                  <div className="relative flex-1 max-w-sm">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input type="text" placeholder="Search transcript text or speaker…" value={search} onChange={e => setSearch(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors" />
                  </div>
                  {search && <span className="text-xs text-amber-400 font-medium">{matchCount} match{matchCount !== 1 ? 'es' : ''}</span>}
                </div>

                <div className="flex items-center gap-3">
                  {uniqueDisplaySpeakers.length > 1 && (
                    <div className="flex items-center gap-1.5">
                      <SlidersHorizontal size={12} className="text-slate-500" />
                      <select value={speakerFilter} onChange={e => setSpeakerFilter(e.target.value)}
                        className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 cursor-pointer">
                        <option value="ALL">All Speakers ({uniqueDisplaySpeakers.length})</option>
                        {uniqueDisplaySpeakers.map(spk => <option key={spk} value={spk}>{spk}</option>)}
                      </select>
                    </div>
                  )}

                  {/* Sync Offset Control */}
                  <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1">
                    <Clock size={12} className={timeOffsetSec !== 0 ? 'text-indigo-400' : 'text-slate-500'} />
                    <span className="text-[11px] text-slate-400 font-medium">Sync:</span>
                    <input type="number" value={timeOffsetSec} step="0.1"
                      onChange={e => { const n = Number.parseFloat(e.target.value); setAndSaveTimeOffset(Number.isFinite(n) ? n : 0); }}
                      className="w-16 px-1 py-0.5 text-center text-xs font-mono font-bold bg-slate-900 border border-slate-700 rounded text-white focus:outline-none focus:border-indigo-500"
                      title="Offset in seconds (decimals supported, e.g. -21.35)" />
                    <span className="text-[11px] text-slate-400 font-mono">s</span>
                    <div className="flex items-center gap-0.5 ml-1">
                      {/* Labels and handlers intentionally ordered: -1s, -0.1s, +0.1s, +1s */}
                      <button onClick={() => setAndSaveTimeOffset(p => Number((p - 1).toFixed(3)))}
                        className="px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded transition-colors cursor-pointer" title="Shift transcript 1s earlier">-1s</button>
                      <button onClick={() => setAndSaveTimeOffset(p => Number((p - 0.1).toFixed(3)))}
                        className="px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded transition-colors cursor-pointer" title="Shift transcript 0.1s earlier">-0.1s</button>
                      <button onClick={() => setAndSaveTimeOffset(p => Number((p + 0.1).toFixed(3)))}
                        className="px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded transition-colors cursor-pointer" title="Shift transcript 0.1s later">+0.1s</button>
                      <button onClick={() => setAndSaveTimeOffset(p => Number((p + 1).toFixed(3)))}
                        className="px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded transition-colors cursor-pointer" title="Shift transcript 1s later">+1s</button>
                      {timeOffsetSec !== 0 && (
                        <button onClick={() => setAndSaveTimeOffset(0)}
                          className="px-1.5 py-0.5 text-[10px] font-medium text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded transition-colors cursor-pointer ml-0.5">Reset</button>
                      )}
                    </div>
                  </div>

                  <button onClick={() => setAutoScroll(!autoScroll)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg transition-colors border cursor-pointer ${autoScroll ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30 font-medium' : 'bg-slate-900 text-slate-500 border-slate-800'}`}>
                    <ArrowDownCircle size={12} /> Auto-Scroll {autoScroll ? 'ON' : 'OFF'}
                  </button>
                </div>
              </div>

              {/* Transcript Feed */}
              <div className="flex-1 overflow-y-auto p-4 md:p-8 bg-gradient-to-b from-slate-950 via-slate-950/95 to-slate-950">
                {transcriptLoading && (
                  <div className="flex flex-col items-center justify-center py-24 text-slate-400 gap-3">
                    <Loader size={26} className="animate-spin text-indigo-400" />
                    <span className="text-xs font-medium tracking-wide">Loading diarized transcript…</span>
                  </div>
                )}

                {transcriptError && (
                  <div className="max-w-2xl mx-auto p-4 bg-red-500/10 border border-red-500/30 rounded-2xl text-red-300 text-xs shadow-lg">
                    <p className="font-semibold flex items-center gap-2"><AlertCircle size={15} className="text-red-400" /> Could not load transcript</p>
                    <p className="mt-1 opacity-90 pl-6">{transcriptError}</p>
                  </div>
                )}

                {!transcriptLoading && !transcriptError && !transcriptRaw && (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-8 max-w-md mx-auto py-20">
                    <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mb-4 text-indigo-400 shadow-xl shadow-indigo-500/5">
                      <Sparkles size={28} />
                    </div>
                    <h4 className="text-base font-bold text-white mb-1.5">No Transcript Generated Yet</h4>
                    <p className="text-slate-400 text-xs mb-6 leading-relaxed">This Space has audio published, but no diarized transcript asset is available yet.</p>
                    {transcribeSuccess ? (
                      <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl text-emerald-300 text-xs mb-4 text-left w-full shadow-lg">
                        <p className="font-semibold flex items-center gap-1.5"><Check size={14} /> Job Dispatched</p>
                        <p className="mt-1 opacity-90">{transcribeSuccess}</p>
                      </div>
                    ) : (
                      <button onClick={handleGenerateTranscript} disabled={transcribing}
                        className="flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl shadow-lg shadow-indigo-600/25 transition-all hover:scale-105 cursor-pointer">
                        {transcribing ? <Loader size={14} className="animate-spin" /> : <Sparkles size={14} />}
                        {transcribing ? 'Dispatching to RTX 4060 Ti…' : '⚡ Transcribe Space with RTX 4060 Ti'}
                      </button>
                    )}
                  </div>
                )}

                {!transcriptLoading && !transcriptError && transcriptRaw && filteredUtterances.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-24 text-center text-slate-500">
                    <Search size={32} className="mb-3 text-slate-600" />
                    <p className="text-sm font-medium">No speaker turns match your search/filter.</p>
                    <button onClick={() => { setSearch(''); setSpeakerFilter('ALL'); }}
                      className="mt-3 text-xs text-indigo-400 hover:text-indigo-300 underline cursor-pointer">Reset filters</button>
                  </div>
                )}

                {!transcriptLoading && !transcriptError && filteredUtterances.length > 0 && (
                  <div className="max-w-3xl mx-auto space-y-3.5 pb-24">
                    {filteredUtterances.map((utterance) => {
                      const isPlayingThisUtterance = activeUtteranceId === utterance.id;
                      const theme = getSpeakerTheme(utterance.speaker, savedSpeakers);
                      const isEditingThisSpeaker = editingSpeakerKey === utterance.rawSpeaker;
                      const initialChar = utterance.speaker.replace(/^Speaker\s+/i, '').trim().charAt(0).toUpperCase() || 'S';

                      return (
                        <div
                          id={`utterance-card-${utterance.id}`}
                          key={utterance.id}
                          onClick={() => handlePlayUtterance(utterance.startSec)}
                          style={{ contentVisibility: 'auto', containIntrinsicSize: '120px' }}
                          className={`group flex items-start gap-3.5 p-4 rounded-2xl border transition-all cursor-pointer relative ${
                            isPlayingThisUtterance
                              ? 'bg-indigo-950/40 border-indigo-500/80 shadow-xl shadow-indigo-500/10 ring-1 ring-indigo-500/40'
                              : 'bg-slate-900/50 border-slate-800/80 hover:bg-slate-900 hover:border-slate-700/80 hover:shadow-md'
                          }`}
                        >
                          {/* Avatar */}
                          <div onClick={e => { e.stopPropagation(); setEditingSpeakerKey(utterance.rawSpeaker); setEditingSpeakerVal(utterance.speaker); }}
                            className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs flex-shrink-0 shadow-sm mt-0.5 transition-transform group-hover:scale-105 ${theme.avatar} cursor-pointer`}
                            title={`Click to rename ${utterance.speaker}`}>
                            {theme.emoji ? <span className="text-base select-none">{theme.emoji}</span> : <span>{initialChar}</span>}
                          </div>

                          {/* Body */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                              <div className="flex items-center gap-2 relative">

                                {/* Speaker tag / inline editor */}
                                {isEditingThisSpeaker ? (
                                  <div className="relative flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                                    <input type="text" autoFocus value={editingSpeakerVal}
                                      onChange={e => setEditingSpeakerVal(e.target.value)}
                                      onKeyDown={e => { if (e.key === 'Enter') saveSpeakerRename(utterance.rawSpeaker, editingSpeakerVal); if (e.key === 'Escape') setEditingSpeakerKey(null); }}
                                      placeholder={utterance.rawSpeaker}
                                      className="px-2.5 py-1 text-xs font-bold bg-slate-950 border-2 border-indigo-500 rounded-lg text-white focus:outline-none w-44 shadow-lg shadow-indigo-500/20" />
                                    <button onClick={() => saveSpeakerRename(utterance.rawSpeaker, editingSpeakerVal)} className="p-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md"><Check size={11} /></button>
                                    <button onClick={() => setEditingSpeakerKey(null)} className="p-1 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-md"><X size={11} /></button>
                                    {/* Quick-Pick Popover */}
                                    <div className="absolute left-0 top-full mt-2 w-64 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-40 p-2 space-y-1">
                                      <div className="flex items-center justify-between px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-800">
                                        <span className="flex items-center gap-1"><Star size={10} className="text-amber-400 fill-amber-400" /> Saved Speakers</span>
                                        <button onClick={() => setShowSavedSpeakersModal(true)} className="text-indigo-400 hover:text-indigo-300 font-normal lowercase cursor-pointer">manage</button>
                                      </div>
                                      <div className="max-h-48 overflow-y-auto space-y-0.5 pt-1">
                                        {savedSpeakers.filter(s => !editingSpeakerVal.trim() || s.name.toLowerCase().includes(editingSpeakerVal.toLowerCase())).map(s => (
                                          <button key={s.id || s.name} onClick={() => saveSpeakerRename(utterance.rawSpeaker, s.name)}
                                            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg hover:bg-slate-800 text-left text-xs transition-colors cursor-pointer">
                                            <div className="flex items-center gap-2">
                                              <span className="text-sm">{s.avatarEmoji || '🎙️'}</span>
                                              <span className="font-semibold text-slate-200 group-hover:text-white">{s.name}</span>
                                            </div>
                                            {s.role && <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">{s.role}</span>}
                                          </button>
                                        ))}
                                      </div>
                                      {editingSpeakerVal.trim() && !savedSpeakers.some(s => s.name.toLowerCase() === editingSpeakerVal.trim().toLowerCase()) && (
                                        <button onClick={() => { quickSaveToPermanent(editingSpeakerVal); saveSpeakerRename(utterance.rawSpeaker, editingSpeakerVal); }}
                                          className="w-full mt-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 text-[11px] font-semibold border border-indigo-500/30 cursor-pointer">
                                          <Plus size={12} /> Save "{editingSpeakerVal}" as Permanent
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                ) : (
                                  <button onClick={e => { e.stopPropagation(); setEditingSpeakerKey(utterance.rawSpeaker); setEditingSpeakerVal(utterance.speaker); }}
                                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg border text-xs font-semibold ${theme.badge} hover:ring-1 hover:ring-indigo-400/60 transition-all cursor-pointer group/tag`}>
                                    {theme.emoji ? <span className="text-xs">{theme.emoji}</span> : <span className={`w-1.5 h-1.5 rounded-full ${theme.dot}`} />}
                                    <span>{utterance.speaker}</span>
                                    <Pencil size={10} className="opacity-40 group-hover/tag:opacity-100 transition-opacity ml-0.5 text-slate-300" />
                                  </button>
                                )}

                                {/* Timestamp seek button */}
                                <button onClick={e => { e.stopPropagation(); handlePlayUtterance(utterance.startSec); }}
                                  className="inline-flex items-center gap-1 text-[11px] font-mono font-medium px-2 py-0.5 rounded-md bg-slate-800/80 hover:bg-indigo-500/20 text-slate-400 hover:text-indigo-300 border border-slate-700/60 transition-colors cursor-pointer">
                                  <Play size={9} className="text-indigo-400 fill-indigo-400/40" />
                                  <span>{utterance.startLabel}</span>
                                  {utterance.endLabel && <span className="text-slate-500 font-normal"> – {utterance.endLabel}</span>}
                                </button>

                                {/* 1-click sync calibration */}
                                {isPlaying && (
                                  <button onClick={e => { e.stopPropagation(); setAndSaveTimeOffset(Number((currentTime - utterance.rawStartSec).toFixed(3))); }}
                                    className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-indigo-500/15 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/30 cursor-pointer"
                                    title={`Align transcript to audio time ${formatSeconds(currentTime)}`}>
                                    <Clock size={10} className="text-indigo-400" /> Sync here ({formatSeconds(currentTime)})
                                  </button>
                                )}
                              </div>

                              <div className="flex items-center gap-2">
                                {typeof utterance.confidence === 'number' && (
                                  <span className={`text-[10px] font-mono ${utterance.confidence >= 0.9 ? 'text-emerald-500' : utterance.confidence >= 0.75 ? 'text-amber-500' : 'text-rose-400'}`}
                                    title="Confidence score">{(utterance.confidence * 100).toFixed(0)}%</span>
                                )}
                                {isPlayingThisUtterance && (
                                  <span className="flex items-center gap-1.5 text-[10px] font-bold text-indigo-400 uppercase tracking-wider bg-indigo-500/15 px-2.5 py-0.5 rounded-full border border-indigo-500/30 animate-pulse">
                                    <Volume2 size={11} /> Speaking Now
                                  </span>
                                )}
                              </div>
                            </div>

                            <p className={`text-[15px] leading-relaxed transition-colors select-text ${isPlayingThisUtterance ? 'text-white font-medium' : 'text-slate-100'}`}>
                              {highlightMatch(utterance.text, search)}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>)}
          </div>
        </div>
      )}

      {/* ── Rename Speakers Modal ── */}
      {showRenameModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"><Users size={16} /></div>
                <div>
                  <h3 className="text-base font-bold text-white">Rename Episode Speakers</h3>
                  <p className="text-[11px] text-slate-400">Click a saved speaker chip or type a custom name</p>
                </div>
              </div>
              <button onClick={() => setShowRenameModal(false)} className="p-1.5 text-slate-500 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"><X size={16} /></button>
            </div>

            {savedSpeakers.length > 0 && (
              <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl space-y-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                  <Star size={10} className="text-amber-400 fill-amber-400" /> Quick-Pick:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {savedSpeakers.map(s => (
                    <button key={s.id || s.name}
                      onClick={() => { const u = speakerStats.find(st => !speakerMap[st.rawSpeaker] && st.displayName !== s.name); if (u) saveSpeakerRename(u.rawSpeaker, s.name); }}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-700/80 rounded-lg text-xs text-slate-200 hover:text-white transition-colors cursor-pointer">
                      <span>{s.avatarEmoji || '🎙️'}</span><span className="font-semibold">{s.name}</span>
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
                      <input type="text" placeholder={rawSpeaker} value={speakerMap[rawSpeaker] || ''} onChange={e => saveSpeakerRename(rawSpeaker, e.target.value)}
                        className="px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 focus:border-indigo-500 rounded-lg text-white placeholder-slate-600 focus:outline-none w-44" />
                      {speakerMap[rawSpeaker] && (
                        <button onClick={() => quickSaveToPermanent(speakerMap[rawSpeaker])}
                          className="p-1.5 text-amber-400 hover:text-amber-300 hover:bg-amber-500/20 rounded-lg transition-colors border border-amber-500/20">
                          <Star size={12} className="fill-amber-400/40" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-800 gap-2">
              <button onClick={resetAllSpeakerNames} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-red-400 transition-colors cursor-pointer">
                <RotateCcw size={12} /> Reset
              </button>
              <div className="flex items-center gap-2">
                <button onClick={handleSaveToGitHub} disabled={savingGitHub || (!Object.keys(speakerMap).length && timeOffsetSec === 0)}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer shadow-lg shadow-emerald-600/20">
                  {savingGitHub ? <Loader size={12} className="animate-spin" /> : <Save size={12} />}
                  {savingGitHub ? 'Saving…' : 'Save to GitHub'}
                </button>
                <button onClick={() => setShowRenameModal(false)} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors cursor-pointer">Done</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Saved Speakers Modal ── */}
      {showSavedSpeakersModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20"><Star size={18} className="fill-amber-400/40" /></div>
                <div>
                  <h3 className="text-base font-bold text-white">Permanent Saved Speakers</h3>
                  <p className="text-xs text-slate-400">These profiles appear as quick-pick options on every space</p>
                </div>
              </div>
              <button onClick={() => setShowSavedSpeakersModal(false)} className="p-1.5 text-slate-500 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"><X size={16} /></button>
            </div>

            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {savedSpeakers.map(s => {
                const theme = getSpeakerTheme(s.name, savedSpeakers);
                return (
                  <div key={s.id || s.name} className="flex items-center justify-between p-3 bg-slate-950 border border-slate-800 rounded-xl">
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg shadow-sm ${theme.avatar}`}>{s.avatarEmoji || '🎙️'}</div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-white">{s.name}</span>
                          {s.role && <span className="px-2 py-0.5 text-[10px] rounded-full bg-slate-800 text-slate-300 font-medium border border-slate-700">{s.role}</span>}
                        </div>
                        <span className="text-[10px] text-slate-500 capitalize">{s.color || 'indigo'} theme</span>
                      </div>
                    </div>
                    <button onClick={() => deletePermanentSpeaker(s.id || s.name)} className="p-1.5 text-slate-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"><Trash2 size={14} /></button>
                  </div>
                );
              })}
            </div>

            <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl space-y-3">
              <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5"><UserPlus size={13} className="text-indigo-400" /> Add New Permanent Speaker</span>
              <div className="grid grid-cols-2 gap-2">
                <input type="text" placeholder="Speaker Name (e.g. Rick)" value={newSpeakerName} onChange={e => setNewSpeakerName(e.target.value)}
                  className="col-span-2 px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500" />
                <select value={newSpeakerRole} onChange={e => setNewSpeakerRole(e.target.value)}
                  className="px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-slate-300 focus:outline-none focus:border-indigo-500 cursor-pointer">
                  <option value="Host">Host</option><option value="Co-Host">Co-Host</option>
                  <option value="Special Guest">Special Guest</option><option value="Speaker">Speaker</option>
                </select>
                <select value={newSpeakerColor} onChange={e => setNewSpeakerColor(e.target.value)}
                  className="px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-slate-300 focus:outline-none focus:border-indigo-500 cursor-pointer">
                  <option value="indigo">Indigo</option><option value="purple">Purple</option><option value="emerald">Emerald</option>
                  <option value="sky">Sky Blue</option><option value="amber">Amber</option><option value="rose">Rose</option>
                  <option value="cyan">Cyan</option><option value="teal">Teal</option><option value="orange">Orange</option><option value="fuchsia">Fuchsia</option>
                </select>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap pt-1">
                <span className="text-[10px] text-slate-500 font-medium">Emoji:</span>
                {['🎙️', '👩‍🎨', '⚡', '🛸', '🎧', '🌸', '👑', '👽', '🤖', '🔥', '⭐', '💡', '💬', '🕵️'].map(emoji => (
                  <button key={emoji} type="button" onClick={() => setNewSpeakerEmoji(emoji)}
                    className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm transition-all cursor-pointer ${newSpeakerEmoji === emoji ? 'bg-indigo-600 text-white scale-110 shadow' : 'bg-slate-900 hover:bg-slate-800'}`}>
                    {emoji}
                  </button>
                ))}
              </div>
              <button onClick={() => { if (newSpeakerName.trim()) { addOrUpdatePermanentSpeaker({ id: newSpeakerName.trim().toLowerCase().replace(/\s+/g, '-'), name: newSpeakerName.trim(), avatarEmoji: newSpeakerEmoji, color: newSpeakerColor, role: newSpeakerRole }); setNewSpeakerName(''); } }}
                disabled={!newSpeakerName.trim()}
                className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-lg shadow-indigo-600/20">
                <Plus size={13} /> Add to Permanent Directory
              </button>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-800">
              <button onClick={() => setShowSavedSpeakersModal(false)} className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors cursor-pointer">Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TranscriptPanel;
