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

interface Props {
  config: EnhancedConfig;
  initialReleaseId?: number | string | null;
}

export interface UtteranceWord {
  word: string;
  start: number;
  end: number;
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
  words?: UtteranceWord[];
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

export interface ExtractedClip {
  id: string;
  filename: string;
  title: string;
  quote: string;
  space_tag?: string;
  space_title?: string;
  timestamp?: string;
  size_bytes?: number;
  format?: string;
  url: string;
}

export interface SearchIndexSegment {
  start: number;
  end: number | null;
  speaker: string;
  text: string;
  _search?: string;
}

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

export interface ThematicCategory {
  id: string;
  name: string;
  emoji: string;
  description: string;
  keywords: string[];
}

export const THEMATIC_CATEGORIES: ThematicCategory[] = [
  {
    id: 'ALL',
    name: 'All Categories',
    emoji: '📋',
    description: 'All transcribed turns',
    keywords: [],
  },
  {
    id: 'DOXXING',
    name: 'Doxxing Admissions',
    emoji: '🎯',
    description: 'Admissions of releasing personal info, front door photos, addresses',
    keywords: ['dox', 'doxx', 'doxed', 'doxxing', 'front door', 'address', 'phone number', 'personal info', 'infiltrat', 'second device', 'screenshot'],
  },
  {
    id: 'LEGAL',
    name: 'Lawsuits & Bankruptcy',
    emoji: '⚖️',
    description: 'Threats to bankrupt, sue, drag through court, cease and desist',
    keywords: ['lawsuit', 'bankrupt', 'sue', 'court', 'attorney', 'cease and desist', 'damages', 'out of pocket', 'slap them with', 'powerpoint'],
  },
  {
    id: 'AUTHORITIES',
    name: 'Police, IC3 & CPS',
    emoji: '🚔',
    description: 'Law enforcement reports, federal filings, IC3, CPS, well checks',
    keywords: ['police', 'cop', 'ic3', 'cps', 'well check', 'investigat', 'federal', 'fbi', 'report', 'vital records'],
  },
  {
    id: 'SEXUAL_AI',
    name: 'AI Deepfakes & Predators',
    emoji: '⚠️',
    description: 'Accusations of generating AI porn, platforming predators, deepfakes of minors',
    keywords: ['predator', 'ai porn', 'deepfake', 'pedophile', 'nudes', 'minor', 'porn', 'fucking porn', 'sexual'],
  },
  {
    id: 'HAREM_CULT',
    name: 'AI Harem & Manipulation',
    emoji: '🕸️',
    description: 'Accusations of running an AI harem, triangulating women, psychological ops',
    keywords: ['harem', 'triangulat', 'impressionable', 'cult', 'manipulat', 'validation', 'back channels', 'proxy', 'psychological operations'],
  },
  {
    id: 'MILITARY_CIA',
    name: 'CIA & Military Claims',
    emoji: '🎖️',
    description: 'Claims of Green Beret family, Fort Bragg, CIA adoption, intelligence operations',
    keywords: ['cia', 'fort bragg', 'green beret', 'maggard', 'trafficking', 'military', 'kidnapped', 'vital records', 'rockefeller', 'secret forces'],
  },
];

export interface MentionTarget {
  id: string;
  name: string;
  keywords: string[];
}

export const MENTION_TARGETS: MentionTarget[] = [
  { id: 'ALL', name: 'All Subjects', keywords: [] },
  { id: 'LOGAN', name: '🎯 Logan / Logan Black', keywords: ['logan', 'logan black', 'black', 'logey'] },
  { id: 'SAV', name: '🎯 Savannah / Sav', keywords: ['sav', 'savannah'] },
  { id: 'SHANE', name: '🎯 Shane', keywords: ['shane'] },
  { id: 'CARLOS_GABE', name: '🎯 Carlos / Gabe', keywords: ['carlos', 'gabe'] },
  { id: 'AUTHORITIES', name: '🎯 Police / Lawsuits', keywords: ['police', 'cop', 'lawsuit', 'ic3', 'cps', 'bankrupt'] },
];

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
  const maxValue = values.reduce((max, v) => (v > max ? v : max), 0);
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
  if (name.endsWith('.mp3') || name.endsWith('.m4a') || name.endsWith('.wav') || name.endsWith('.jpg') || name.endsWith('.png') || name.endsWith('.jpeg') || name.endsWith('.md')) {
    return false;
  }
  if (name.endsWith('_clips.json') || name === 'clips_catalog.json' || name.endsWith('_catalog.json')) {
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

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function pickTranscriptAsset(release: Release, partNum = 1): Release['assets'][number] | undefined {
  const textAssets = release.assets.filter(a => isLikelyTranscriptAsset(a));
  if (!textAssets.length) return undefined;

  if (partNum > 0) {
    const numRegex = new RegExp(`(?:[_-]|\\b)part\\s*${partNum}(?:[._-]|$)`, 'i');
    const partAssets = textAssets.filter(a => numRegex.test(a.name));
    if (partAssets.length > 0) {
      return [...partAssets].sort((a, b) => transcriptAssetScore(b, release.tag_name) - transcriptAssetScore(a, release.tag_name))[0];
    }
  }

  return [...textAssets].sort((a, b) => transcriptAssetScore(b, release.tag_name) - transcriptAssetScore(a, release.tag_name))[0];
}

function pickAudioMp3Asset(release?: Release | null): Release['assets'][number] | undefined {
  if (!release?.assets) return undefined;
  return release.assets.find(a => /\.(mp3|m4a|wav|aac)$/i.test(a.name));
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

const SPEAKER_COLOR_MAP: Record<string, { bg: string; text: string; border: string; badge: string; dot: string; avatar: string }> = {
  indigo:  { bg: 'bg-indigo-950/70',  text: 'text-indigo-200',  border: 'border-indigo-500/50',  badge: 'bg-indigo-500/20 text-indigo-200 border border-indigo-400/60 font-bold shadow-sm shadow-indigo-950/50',  dot: 'bg-indigo-400 ring-2 ring-indigo-400/40',  avatar: 'bg-gradient-to-br from-indigo-500 to-indigo-700 text-white font-bold ring-2 ring-indigo-400/40 shadow-md shadow-indigo-950/60'  },
  purple:  { bg: 'bg-purple-950/70',  text: 'text-purple-200',  border: 'border-purple-500/50',  badge: 'bg-purple-500/20 text-purple-200 border border-purple-400/60 font-bold shadow-sm shadow-purple-950/50',  dot: 'bg-purple-400 ring-2 ring-purple-400/40',  avatar: 'bg-gradient-to-br from-purple-500 to-purple-700 text-white font-bold ring-2 ring-purple-400/40 shadow-md shadow-purple-950/60'  },
  emerald: { bg: 'bg-emerald-950/70', text: 'text-emerald-200', border: 'border-emerald-500/50', badge: 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/60 font-bold shadow-sm shadow-emerald-950/50', dot: 'bg-emerald-400 ring-2 ring-emerald-400/40', avatar: 'bg-gradient-to-br from-emerald-500 to-emerald-700 text-white font-bold ring-2 ring-emerald-400/40 shadow-md shadow-emerald-950/60' },
  sky:     { bg: 'bg-sky-950/70',     text: 'text-sky-200',     border: 'border-sky-500/50',     badge: 'bg-sky-500/20 text-sky-200 border border-sky-400/60 font-bold shadow-sm shadow-sky-950/50',             dot: 'bg-sky-400 ring-2 ring-sky-400/40',         avatar: 'bg-gradient-to-br from-sky-500 to-sky-700 text-white font-bold ring-2 ring-sky-400/40 shadow-md shadow-sky-950/60'     },
  amber:   { bg: 'bg-amber-950/70',   text: 'text-amber-200',   border: 'border-amber-500/50',   badge: 'bg-amber-500/20 text-amber-200 border border-amber-400/60 font-bold shadow-sm shadow-amber-950/50',       dot: 'bg-amber-400 ring-2 ring-amber-400/40',     avatar: 'bg-gradient-to-br from-amber-500 to-amber-700 text-white font-bold ring-2 ring-amber-400/40 shadow-md shadow-amber-950/60'   },
  rose:    { bg: 'bg-rose-950/70',    text: 'text-rose-200',    border: 'border-rose-500/50',    badge: 'bg-rose-500/20 text-rose-200 border border-rose-400/60 font-bold shadow-sm shadow-rose-950/50',           dot: 'bg-rose-400 ring-2 ring-rose-400/40',       avatar: 'bg-gradient-to-br from-rose-500 to-rose-700 text-white font-bold ring-2 ring-rose-400/40 shadow-md shadow-rose-950/60'    },
  cyan:    { bg: 'bg-cyan-950/70',    text: 'text-cyan-200',    border: 'border-cyan-500/50',    badge: 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/60 font-bold shadow-sm shadow-cyan-950/50',           dot: 'bg-cyan-400 ring-2 ring-cyan-400/40',       avatar: 'bg-gradient-to-br from-cyan-500 to-cyan-700 text-white font-bold ring-2 ring-cyan-400/40 shadow-md shadow-cyan-950/60'    },
  fuchsia: { bg: 'bg-fuchsia-950/70', text: 'text-fuchsia-200', border: 'border-fuchsia-500/50', badge: 'bg-fuchsia-500/20 text-fuchsia-200 border border-fuchsia-400/60 font-bold shadow-sm shadow-fuchsia-950/50', dot: 'bg-fuchsia-400 ring-2 ring-fuchsia-400/40', avatar: 'bg-gradient-to-br from-fuchsia-500 to-fuchsia-700 text-white font-bold ring-2 ring-fuchsia-400/40 shadow-md shadow-fuchsia-950/60' },
  teal:    { bg: 'bg-teal-950/70',    text: 'text-teal-200',    border: 'border-teal-500/50',    badge: 'bg-teal-500/20 text-teal-200 border border-teal-400/60 font-bold shadow-sm shadow-teal-950/50',           dot: 'bg-teal-400 ring-2 ring-teal-400/40',       avatar: 'bg-gradient-to-br from-teal-500 to-teal-700 text-white font-bold ring-2 ring-teal-400/40 shadow-md shadow-teal-950/60'    },
  orange:  { bg: 'bg-orange-950/70',  text: 'text-orange-200',  border: 'border-orange-500/50',  badge: 'bg-orange-500/20 text-orange-200 border border-orange-400/60 font-bold shadow-sm shadow-orange-950/50',    dot: 'bg-orange-400 ring-2 ring-orange-400/40',   avatar: 'bg-gradient-to-br from-orange-500 to-orange-700 text-white font-bold ring-2 ring-orange-400/40 shadow-md shadow-orange-950/60'  },
  pink:    { bg: 'bg-pink-950/70',    text: 'text-pink-200',    border: 'border-pink-500/50',    badge: 'bg-pink-500/20 text-pink-200 border border-pink-400/60 font-bold shadow-sm shadow-pink-950/50',           dot: 'bg-pink-400 ring-2 ring-pink-400/40',       avatar: 'bg-gradient-to-br from-pink-500 to-pink-700 text-white font-bold ring-2 ring-pink-400/40 shadow-md shadow-pink-950/60'    },
  lime:    { bg: 'bg-lime-950/70',    text: 'text-lime-200',    border: 'border-lime-500/50',    badge: 'bg-lime-500/20 text-lime-200 border border-lime-400/60 font-bold shadow-sm shadow-lime-950/50',           dot: 'bg-lime-400 ring-2 ring-lime-400/40',       avatar: 'bg-gradient-to-br from-lime-500 to-lime-700 text-slate-900 font-bold ring-2 ring-lime-400/40 shadow-md shadow-lime-950/60'  },
  violet:  { bg: 'bg-violet-950/70',  text: 'text-violet-200',  border: 'border-violet-500/50',  badge: 'bg-violet-500/20 text-violet-200 border border-violet-400/60 font-bold shadow-sm shadow-violet-950/50',    dot: 'bg-violet-400 ring-2 ring-violet-400/40',   avatar: 'bg-gradient-to-br from-violet-500 to-violet-700 text-white font-bold ring-2 ring-violet-400/40 shadow-md shadow-violet-950/60'  },
  yellow:  { bg: 'bg-yellow-950/70',  text: 'text-yellow-200',  border: 'border-yellow-500/50',  badge: 'bg-yellow-500/20 text-yellow-200 border border-yellow-400/60 font-bold shadow-sm shadow-yellow-950/50',    dot: 'bg-yellow-400 ring-2 ring-yellow-400/40',   avatar: 'bg-gradient-to-br from-yellow-500 to-yellow-600 text-slate-950 font-bold ring-2 ring-yellow-400/40 shadow-md shadow-yellow-950/60' },
  blue:    { bg: 'bg-blue-950/70',    text: 'text-blue-200',    border: 'border-blue-500/50',    badge: 'bg-blue-500/20 text-blue-200 border border-blue-400/60 font-bold shadow-sm shadow-blue-950/50',           dot: 'bg-blue-400 ring-2 ring-blue-400/40',       avatar: 'bg-gradient-to-br from-blue-500 to-blue-700 text-white font-bold ring-2 ring-blue-400/40 shadow-md shadow-blue-950/60'    },
  red:     { bg: 'bg-red-950/70',     text: 'text-red-200',     border: 'border-red-500/50',     badge: 'bg-red-500/20 text-red-200 border border-red-400/60 font-bold shadow-sm shadow-red-950/50',             dot: 'bg-red-400 ring-2 ring-red-400/40',         avatar: 'bg-gradient-to-br from-red-500 to-red-700 text-white font-bold ring-2 ring-red-400/40 shadow-md shadow-red-950/60'     },
};

const DEFAULT_SAVED_SPEAKERS: SavedSpeaker[] = [
  { id: 'logan',             name: 'Logan',             avatarEmoji: '🎙️', color: 'indigo',  role: 'Host'          },
  { id: 'rose',              name: 'Rose',              avatarEmoji: '🌹', color: 'rose',    role: 'Special Guest' },
  { id: 'angela',            name: 'Angela',            avatarEmoji: '🌸', color: 'pink',    role: 'Host'          },
  { id: 'oor',               name: 'Oor',               avatarEmoji: '⚡', color: 'sky',     role: 'Speaker'       },
  { id: 'brian',             name: 'Brian',             avatarEmoji: '🧠', color: 'teal',    role: 'Speaker'       },
  { id: 'conscious-culprit', name: 'ConsciousCulprit',  avatarEmoji: '👁️', color: 'purple',  role: 'Special Guest' },
  { id: 'teejay',            name: 'teejay',            avatarEmoji: '🎧', color: 'orange',  role: 'Speaker'       },
  { id: 'rotary',            name: 'Rotary',            avatarEmoji: '⚙️', color: 'amber',   role: 'Speaker'       },
  { id: 'linn',              name: 'Linn',              avatarEmoji: '💫', color: 'cyan',    role: 'Speaker'       },
  { id: 'eric-hecker',       name: 'Eric Hecker',       avatarEmoji: '🛸', color: 'emerald', role: 'Special Guest' },
  { id: 'god-sauce',         name: 'God Sauce',         avatarEmoji: '✨', color: 'amber',   role: 'Special Guest' },
  { id: 'mary',              name: 'Mary',              avatarEmoji: '👩‍🎨', color: 'violet',  role: 'Co-Host'       },
  { id: 'shane',             name: 'Shane',             avatarEmoji: '🔥', color: 'lime',    role: 'Co-Host'       },
  { id: 'rick-doty',         name: 'Rick Doty',         avatarEmoji: '🛸', color: 'emerald', role: 'Special Guest' },
  { id: 'tom',               name: 'Tom',               avatarEmoji: '🗣️', color: 'blue',    role: 'Speaker'       },
  { id: 'lana',              name: 'Lana',              avatarEmoji: '🌺', color: 'pink',    role: 'Speaker'       },
  { id: 'chan',              name: 'Chan',              avatarEmoji: '💬', color: 'yellow',  role: 'Speaker'       },
  { id: 'parr',              name: 'Parr',              avatarEmoji: '🎯', color: 'red',     role: 'Speaker'       },
  { id: 'dougie',            name: 'Dougie',            avatarEmoji: '💎', color: 'fuchsia', role: 'Speaker'       },
  { id: 'dr-snuggles',       name: 'Dr. Snuggles',      avatarEmoji: '🧸', color: 'teal',    role: 'Speaker'       },
  { id: 'sarah',             name: 'Sarah',             avatarEmoji: '🌟', color: 'amber',   role: 'Speaker'       },
];

// High-contrast alternating palette ensuring consecutive generic speakers (1, 2, 3... or A, B, C...) have contrasting hues
export const DYNAMIC_COLOR_ORDER = [
  'emerald',  // 1 / B -> vibrant emerald green
  'amber',    // 2 / C -> warm golden amber
  'purple',   // 3 / D -> rich royal purple
  'sky',      // 4 / E -> bright sky blue
  'rose',     // 5 / F -> vivid coral rose
  'teal',     // 6 / G -> luminous deep teal
  'orange',   // 7 / H -> fiery neon orange
  'fuchsia',  // 8 / I -> electric fuchsia magenta
  'lime',     // 9 / J -> bright electric lime
  'cyan',     // 10 / K -> glowing aqua cyan
  'indigo',   // 11 / L -> deep rich indigo
  'pink',     // 12 / M -> hot pink
  'violet',   // 13 / N -> electric violet
  'yellow',   // 14 / O -> sunny bright yellow
  'blue',     // 15 / P -> classic royal blue
  'red',      // 16 / Q -> vivid crimson red
];

export const DIVERSE_EMOJIS = ['⚡', '🌹', '🧠', '👁️', '💫', '🎧', '⚙️', '🛸', '✨', '🔥', '⭐', '💎', '🚀', '🎯', '💡', '🌈', '🦁', '🐺', '🦊', '🐻', '🦉'];

export function getAutoSpeakerColor(name: string): string {
  if (!name) return 'indigo';
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return DYNAMIC_COLOR_ORDER[Math.abs(hash) % DYNAMIC_COLOR_ORDER.length];
}

export function getAutoSpeakerEmoji(name: string): string {
  if (!name) return '🎙️';
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return DIVERSE_EMOJIS[Math.abs(hash) % DIVERSE_EMOJIS.length];
}

function getSpeakerTheme(displayName: string, savedSpeakers: SavedSpeaker[] = []) {
  if (!displayName) {
    return { ...SPEAKER_COLOR_MAP.indigo, emoji: undefined, role: undefined };
  }
  const cleanName = displayName.trim();
  const match = savedSpeakers.find(s => s.name.toLowerCase() === cleanName.toLowerCase());
  if (match) {
    let colorKey = match.color;
    let emoji = match.avatarEmoji;
    
    // Auto-heal legacy poisoned 'indigo' / generic '🎙️' saved entries for non-Logan speakers
    if ((colorKey === 'indigo' || !colorKey || !SPEAKER_COLOR_MAP[colorKey]) && cleanName.toLowerCase() !== 'logan') {
      const def = DEFAULT_SAVED_SPEAKERS.find(s => s.name.toLowerCase() === cleanName.toLowerCase());
      colorKey = def?.color || getAutoSpeakerColor(cleanName);
      if (emoji === '🎙️' || !emoji) {
        emoji = def?.avatarEmoji || getAutoSpeakerEmoji(cleanName);
      }
    }
    const resolvedColor = (colorKey && SPEAKER_COLOR_MAP[colorKey]) ? colorKey : getAutoSpeakerColor(cleanName);
    return { ...SPEAKER_COLOR_MAP[resolvedColor], emoji, role: match.role };
  }

  // Check official default speakers list
  const defaultMatch = DEFAULT_SAVED_SPEAKERS.find(s => s.name.toLowerCase() === cleanName.toLowerCase());
  if (defaultMatch && defaultMatch.color && SPEAKER_COLOR_MAP[defaultMatch.color]) {
    return { ...SPEAKER_COLOR_MAP[defaultMatch.color], emoji: defaultMatch.avatarEmoji, role: defaultMatch.role };
  }

  // Handle "Speaker 1", "Speaker 2", "Speaker_1", etc.
  const numMatch = cleanName.match(/^Speaker[\s_]+(\d+)$/i);
  if (numMatch) {
    const num = parseInt(numMatch[1], 10);
    // 1-indexed: Speaker 1 -> DYNAMIC_COLOR_ORDER[0] (emerald), Speaker 2 -> DYNAMIC_COLOR_ORDER[1] (amber), etc.
    const colorIdx = (num > 0 ? num - 1 : 0) % DYNAMIC_COLOR_ORDER.length;
    const colorKey = DYNAMIC_COLOR_ORDER[colorIdx];
    return { ...SPEAKER_COLOR_MAP[colorKey], emoji: undefined, role: undefined };
  }

  // Handle "Speaker A", "Speaker B", "Speaker_C", etc.
  const letterMatch = cleanName.match(/^Speaker[\s_]+([A-Z])$/i);
  if (letterMatch) {
    const charCode = letterMatch[1].toUpperCase().charCodeAt(0) - 65; // A=0, B=1, ...
    const colorKey = DYNAMIC_COLOR_ORDER[((charCode % DYNAMIC_COLOR_ORDER.length) + DYNAMIC_COLOR_ORDER.length) % DYNAMIC_COLOR_ORDER.length];
    return { ...SPEAKER_COLOR_MAP[colorKey], emoji: undefined, role: undefined };
  }

  // Stable deterministic hash for any other speaker name (e.g. "Rotary", "Dave", "Snuggles", "Sarah", "Presenter")
  const colorKey = getAutoSpeakerColor(cleanName);
  const emoji = getAutoSpeakerEmoji(cleanName);
  return { ...SPEAKER_COLOR_MAP[colorKey], emoji, role: undefined };
}

const POPULAR_SEARCH_TOPICS = [
  'aliens', 'Windex', 'bidet', 'Casper', 'psyop', 'Logan',
  'queen', 'conscious culprit', 'James Blunt', 'red panda',
  'masturbation', 'Spanish', 'crucible', 'Tunica'
];

function highlightMatch(text: string, query: string): React.ReactNode {
  return renderTranscriptMatch(text, query);
}

export interface WordTimingSource {
  text: string;
  startSec: number;
  endSec: number | null;
  words?: UtteranceWord[];
}

export function getUtteranceWords(source: WordTimingSource): UtteranceWord[] {
  if (source.words && source.words.length > 0) {
    return source.words;
  }
  const tokens = source.text.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];

  const start = source.startSec;
  const duration = (source.endSec !== null && source.endSec > start)
    ? source.endSec - start
    : Math.max(1.0, tokens.length * 0.38);

  const weights = tokens.map(token => {
    const clean = token.replace(/[^a-zA-Z0-9]/g, '');
    const len = Math.max(1, clean.length);
    let pause = 0;
    if (/[.?!]$/.test(token)) pause = 2.5;
    else if (/[,;:\-–—]$/.test(token)) pause = 1.2;
    return len + pause;
  });

  const totalWeight = weights.reduce((sum, w) => sum + w, 0) || 1;
  let runningStart = start;
  const result: UtteranceWord[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const wordDuration = (weights[i] / totalWeight) * duration;
    const wordStart = runningStart;
    const wordEnd = i === tokens.length - 1 ? (source.endSec ?? (start + duration)) : runningStart + wordDuration;
    result.push({
      word: tokens[i],
      start: Math.round(wordStart * 100) / 100,
      end: Math.round(wordEnd * 100) / 100,
    });
    runningStart += wordDuration;
  }

  return result;
}

const EPISODE_SEGMENTS_CACHE = new Map<string, SearchIndexSegment[]>();

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
        return await res.json();
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
    return EPISODE_SEGMENTS_CACHE.get(releaseTag)!;
  }
  const text = await fetchSingleEpisodeTranscript(releaseTag, owner, repo);
  if (!text) return [];
  try {
    const data = JSON.parse(text);
    const segs: SearchIndexSegment[] = Array.isArray(data.segments) ? data.segments : [];
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
          let parsedWords: UtteranceWord[] | undefined = undefined;
          if (Array.isArray(seg?.words) && seg.words.length > 0) {
            parsedWords = seg.words
              .map((w: any) => {
                const wText = String(w?.punctuated_word ?? w?.word ?? '').trim();
                const wStart = readTimestampSeconds(w, 'start', scale);
                const wEnd = readTimestampSeconds(w, 'end', scale);
                if (!wText || wStart === null) return null;
                return {
                  word: wText,
                  start: Math.max(0, wStart),
                  end: wEnd !== null && wEnd >= wStart ? wEnd : wStart + 0.3,
                };
              })
              .filter((w: UtteranceWord | null): w is UtteranceWord => w !== null);
            if (parsedWords && parsedWords.length === 0) parsedWords = undefined;
          }
          const wordCount = parsedWords ? parsedWords.length : text.split(/\s+/).filter(Boolean).length;
          return {
            id: `seg-${idx}-${Math.round(startSec * 1000)}`,
            startSec, endSec, rawStartSec: startSec, rawEndSec: endSec,
            startLabel: formatSeconds(startSec),
            endLabel: endSec !== null ? formatSeconds(endSec) : '',
            speaker: formattedSpeaker, rawSpeaker, text,
            raw: `[${formatSeconds(startSec)}${endSec !== null ? ` - ${formatSeconds(endSec)}` : ''}] ${formattedSpeaker}: ${text}`,
            confidence, wordCount,
            words: parsedWords,
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
  const [selectedId, setSelectedId] = useState<number | null>(typeof initialReleaseId === 'number' ? initialReleaseId : null);
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

  const currentLoadedIdRef = useRef<number | null>(null);
  const transcriptionPollRef = useRef<number | null>(null);
  const lastAutoScrolledUtteranceRef = useRef<string | null>(null);
  const targetScrollSecRef = useRef<number | null>(null);
  const targetScrollRef = useRef<{ releaseId: number; tag?: string; sec: number } | null>(null);

  const { play, seek, currentTime, isPlaying, current, togglePlay } = usePlayer();
  const { addClip } = useMontage();
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

  const selectedRelease = useMemo(() => effectiveReleases.find(r => r.id === selectedId), [effectiveReleases, selectedId]);
  // Open an episode requested by tag (e.g. from Investigative Radar) once releases are loaded
  useEffect(() => {
    if (typeof initialReleaseId !== 'string') return;
    const match = effectiveReleases.find(r => r.tag_name === initialReleaseId);
    if (match) setSelectedId(match.id);
  }, [initialReleaseId, effectiveReleases]);
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
      if (currentLoadedIdRef.current !== selectedId) {
        const rel = effectiveReleases.find(r => r.id === selectedId);
        if (rel) {
          currentLoadedIdRef.current = selectedId;
          setSelectedPartNum(1);
          loadTranscript(rel, undefined, 1);
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
    if (el) {
      lastAutoScrolledUtteranceRef.current = activeUtteranceId;
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
            <div className="mt-3 flex items-center gap-4 text-[11px] font-mono text-emerald-400 bg-emerald-950/30 px-3 py-1.5 rounded border border-emerald-900/50">
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
            className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-lg transition-all shadow-md shadow-indigo-600/20 cursor-pointer"
            title="Ask AI Copilot about this transcript and extract soundbites"
          >
            <Bot size={14} />
            <span>Ask Copilot</span>
          </button>

          <button onClick={fetchReleases} disabled={loading || !hasCredentials}
            className="flex items-center gap-2 px-3.5 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 rounded-lg transition-colors border border-slate-700 cursor-pointer">
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

          {/* ── Sidebar ── */}
          <div className="w-72 md:w-80 flex-shrink-0 border-r border-slate-800 overflow-y-auto bg-slate-950/70 divide-y divide-slate-900">
            {/* Global Search shortcut button */}
            <div className="p-2.5 bg-slate-900/60 border-b border-slate-800">
              <button
                onClick={() => {
                  setSearchScope('all');
                  loadGlobalIndex();
                }}
                className={`w-full text-left p-3 rounded-xl transition-all flex items-center justify-between gap-3 cursor-pointer border ${
                  searchScope === 'all'
                    ? 'bg-indigo-600/25 border-indigo-500/70 shadow-lg text-white ring-1 ring-indigo-500/40'
                    : 'bg-slate-900/90 hover:bg-slate-800/90 border-slate-800 text-slate-300 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    searchScope === 'all' ? 'bg-indigo-500 text-white shadow-md' : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
                  }`}>
                    <Globe size={16} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold truncate">Search All Transcripts</span>
                    </div>
                    <p className="text-[11px] text-slate-400 truncate">
                      {summaryIndex ? `${summaryIndex.length} episodes • ${totalGlobalSegments.toLocaleString()} turns` : (globalIndex ? `${globalIndex.length} episodes • ${totalGlobalSegments.toLocaleString()} turns` : '241 episodes • 359,000+ turns')}
                    </p>
                  </div>
                </div>
                <ArrowRight size={13} className={searchScope === 'all' ? 'text-indigo-400' : 'text-slate-500'} />
              </button>
            </div>

            <div className="p-3 bg-slate-900/50 border-b border-slate-800 flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Select Episode ({effectiveReleases.length})</span>
            </div>
            {effectiveReleases.map(release => {
              const hasTxt = !!pickTranscriptAsset(release) || (summaryIndex?.some(ep => (ep.release_id === release.id || ep.release_tag === release.tag_name) && (ep.segment_count || 0) > 0) ?? false) || (globalIndex?.some(ep => (ep.release_id === release.id || ep.release_tag === release.tag_name) && ep.segments?.length > 0) ?? false);
              const isSelected = searchScope === 'current' && selectedId === release.id;
              const isPlayingThis = current?.id === release.id && isPlaying;
              return (
                <button key={release.id} onClick={() => { setSearchScope('current'); loadTranscript(release); }}
                  className={`w-full text-left p-3.5 transition-all flex items-start gap-3 group relative cursor-pointer ${isSelected ? 'bg-indigo-600/15 border-l-4 border-l-indigo-500 text-white' : 'hover:bg-slate-900/80 text-slate-300'}`}>
                  <div className={`mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${isPlayingThis ? 'bg-indigo-500 text-white animate-pulse' : isSelected ? 'bg-indigo-500/20 text-indigo-400' : 'bg-slate-800 text-slate-400 group-hover:text-slate-300'}`}>
                    {isPlayingThis ? <Volume2 size={13} /> : <FileText size={13} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-semibold truncate ${isSelected ? 'text-white font-bold' : 'text-slate-300'}`}>{release.name || release.tag_name}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-[11px] text-slate-400">{getEpisodeRecordedDate(release).displayDate}</span>
                      {hasTxt
                        ? <span className="px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded text-[11px] font-medium">Transcript Ready</span>
                        : <span className="px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded text-[11px]">Audio Only</span>}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* ── Main View ── */}
          <div className="flex-1 flex flex-col min-w-0 bg-slate-950">
            {searchScope === 'all' ? (
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
                  {/* Episode Player Header */}
                  <div className="p-4 md:px-6 bg-slate-900/90 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {mp3Asset && (
                        <button onClick={handlePlayEpisodeToggle}
                          className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-md transition-all cursor-pointer ${isCurrentEpisodePlaying ? 'bg-indigo-500 text-white' : 'bg-indigo-600 hover:bg-indigo-500 text-white hover:scale-105'}`}
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
                          {transcriptMetadata.model && <><span>•</span><span className="text-slate-300" title="Speech-to-text model">{transcriptMetadata.model}</span></>}
                          {transcriptMetadata.language && <><span>•</span><span className="text-slate-400 uppercase">{transcriptMetadata.language}</span></>}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      {mp3Asset && (
                        <button
                          onClick={handleToggleCacheCurrentAudio}
                          disabled={isCachingCurrentAudio}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border cursor-pointer shadow-sm ${
                            isCurrentAudioCached
                              ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300 hover:bg-rose-950/40 hover:text-rose-300 hover:border-rose-500/40'
                              : 'bg-indigo-600/20 border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/30 hover:text-white'
                          }`}
                          title={
                            isCurrentAudioCached
                              ? 'Audio cached in browser storage (0ms seek latency). Click to purge cache.'
                              : 'Cache full MP3 into browser CacheStorage for instant offline scrubbing'
                          }
                        >
                          {isCachingCurrentAudio ? (
                            <>
                              <Loader size={12} className="animate-spin text-indigo-400" />
                              <span>Caching {currentAudioCachePct}%…</span>
                            </>
                          ) : isCurrentAudioCached ? (
                            <>
                              <CheckCircle2 size={12} className="text-emerald-400" />
                              <span>Audio Cached (0ms)</span>
                            </>
                          ) : (
                            <>
                              <HardDriveDownload size={12} className="text-indigo-400" />
                              <span>Cache Audio</span>
                            </>
                          )}
                        </button>
                      )}

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
                        className="p-1.5 text-slate-400 hover:text-slate-300 hover:bg-slate-800 rounded-lg transition-colors border border-slate-800">
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
                    <div className="mx-4 md:mx-6 mt-3 flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-xs">
                      <AlertCircle size={15} className="text-rose-400 flex-shrink-0" /><span>{saveGitHubError}</span>
                    </div>
                  )}

                  {/* Filter & Sync Toolbar */}
                  <div className="p-3 md:px-6 bg-slate-900/50 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-[280px]">
                      {/* Scope Toggle */}
                      <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800">
                        <button
                          onClick={() => { setSearchScope('all'); loadGlobalIndex(); }}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium text-slate-400 hover:text-white cursor-pointer transition-colors"
                          title="Search all episodes"
                        >
                          <Globe size={12} className="text-indigo-400" /> All Transcripts ({summaryIndex?.length || globalIndex?.length || 241})
                        </button>
                        <button
                          onClick={() => setSearchScope('current')}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-indigo-600 text-white shadow cursor-pointer transition-colors"
                        >
                          <FileText size={12} /> This Episode
                        </button>
                      </div>

                      <div className="relative flex-1 max-w-sm">
                        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input type="text" placeholder="Search this episode text or speaker…" value={search} onChange={e => setSearch(e.target.value)}
                          className="w-full pl-8 pr-7 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors" />
                        {search && (
                          <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-0.5 cursor-pointer">
                            <X size={12} />
                          </button>
                        )}
                      </div>
                      {search && <span className="text-xs text-amber-400 font-medium">{matchCount} match{matchCount !== 1 ? 'es' : ''}</span>}
                    </div>

                    <div className="flex items-center gap-3">
                      {uniqueDisplaySpeakers.length > 1 && (
                        <div className="flex items-center gap-1.5">
                          <SlidersHorizontal size={12} className="text-slate-400" />
                          <select value={speakerFilter} onChange={e => setSpeakerFilter(e.target.value)}
                            className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 cursor-pointer">
                            <option value="ALL">All Speakers ({uniqueDisplaySpeakers.length})</option>
                            {uniqueDisplaySpeakers.map(spk => <option key={spk} value={spk}>{spk}</option>)}
                          </select>
                        </div>
                      )}

                      {/* Audio Playback Seek Sync (fixes VBR audio seeking lead/lag without changing transcript text) */}
                      <div className="flex items-center gap-1.5 bg-slate-950 border border-indigo-500/30 rounded-lg px-2.5 py-1"
                        title="Calibrate audio playback seek offset (e.g. +15s if audio plays 15s before text)">
                        <Headphones size={12} className={audioSeekOffsetSec !== 0 ? 'text-indigo-400' : 'text-slate-400'} />
                        <span className="text-[11px] text-slate-400 font-medium">Audio Seek:</span>
                        <input type="number" value={audioSeekOffsetSec} step="0.5"
                          onChange={e => { const n = Number.parseFloat(e.target.value); setAndSaveAudioSeekOffset(Number.isFinite(n) ? n : 0); }}
                          className="w-14 px-1 py-0.5 text-center text-xs font-mono font-bold bg-slate-900 border border-slate-700 rounded text-indigo-300 focus:outline-none focus:border-indigo-500"
                          title="Audio seek compensation offset in seconds" />
                        <span className="text-[11px] text-slate-400 font-mono">s</span>
                        <div className="flex items-center gap-0.5 ml-1">
                          <button onClick={() => setAndSaveAudioSeekOffset(0)}
                            className={`px-1.5 py-0.5 text-[11px] font-semibold rounded transition-colors cursor-pointer ${audioSeekOffsetSec === 0 ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700'}`}
                            title="Exact 0s seek">0s</button>
                          <button onClick={() => setAndSaveAudioSeekOffset(15)}
                            className={`px-1.5 py-0.5 text-[11px] font-bold rounded transition-colors cursor-pointer ${audioSeekOffsetSec === 15 ? 'bg-indigo-600 text-white ring-1 ring-indigo-400' : 'text-amber-300 hover:text-white bg-indigo-950/60 border border-indigo-500/40 hover:bg-indigo-900'}`}
                            title="Compensate for 15s audio lead (+15s)">+15s</button>
                          <button onClick={() => setAndSaveAudioSeekOffset(p => Number((p - 1).toFixed(1)))}
                            className="px-1.5 py-0.5 text-[11px] font-semibold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded transition-colors cursor-pointer" title="Nudge seek back -1.0s">-1s</button>
                          <button onClick={() => setAndSaveAudioSeekOffset(p => Number((p + 1).toFixed(1)))}
                            className="px-1.5 py-0.5 text-[11px] font-semibold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded transition-colors cursor-pointer" title="Nudge seek forward +1.0s">+1s</button>
                        </div>
                      </div>

                      {/* Sync Offset Control */}
                      <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1">
                        <Clock size={12} className={timeOffsetSec !== 0 ? 'text-indigo-400' : 'text-slate-400'} />
                        <span className="text-[11px] text-slate-400 font-medium">Sync:</span>
                        <input type="number" value={timeOffsetSec} step="0.1"
                          onChange={e => { const n = Number.parseFloat(e.target.value); setAndSaveTimeOffset(Number.isFinite(n) ? n : 0); }}
                          className="w-16 px-1 py-0.5 text-center text-xs font-mono font-bold bg-slate-900 border border-slate-700 rounded text-white focus:outline-none focus:border-indigo-500"
                          title="Offset in seconds (decimals supported, e.g. -21.35)" />
                        <span className="text-[11px] text-slate-400 font-mono">s</span>
                        <div className="flex items-center gap-0.5 ml-1">
                          <button onClick={() => setAndSaveTimeOffset(p => Number((p - 1).toFixed(3)))}
                            className="px-1.5 py-0.5 text-[11px] font-semibold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded transition-colors cursor-pointer" title="Shift transcript 1s earlier">-1s</button>
                          <button onClick={() => setAndSaveTimeOffset(p => Number((p - 0.1).toFixed(3)))}
                            className="px-1.5 py-0.5 text-[11px] font-semibold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded transition-colors cursor-pointer" title="Shift transcript 0.1s earlier">-0.1s</button>
                          <button onClick={() => setAndSaveTimeOffset(p => Number((p + 0.1).toFixed(3)))}
                            className="px-1.5 py-0.5 text-[11px] font-semibold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded transition-colors cursor-pointer" title="Shift transcript 0.1s later">+0.1s</button>
                          <button onClick={() => setAndSaveTimeOffset(p => Number((p + 1).toFixed(3)))}
                            className="px-1.5 py-0.5 text-[11px] font-semibold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded transition-colors cursor-pointer" title="Shift transcript 1s later">+1s</button>
                          {timeOffsetSec !== 0 && (
                            <button onClick={() => setAndSaveTimeOffset(0)}
                              className="px-1.5 py-0.5 text-[11px] font-medium text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded transition-colors cursor-pointer ml-0.5">Reset</button>
                          )}
                        </div>
                      </div>

                      <button onClick={() => setAutoScroll(!autoScroll)}
                        className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg transition-colors border cursor-pointer ${autoScroll ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30 font-medium' : 'bg-slate-900 text-slate-400 border-slate-800'}`}>
                        <ArrowDownCircle size={12} /> Auto-Scroll {autoScroll ? 'ON' : 'OFF'}
                      </button>
                    </div>
                  </div>

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

                  {/* Transcript Feed */}
                  <div className="flex-1 overflow-y-auto p-4 md:p-8 bg-slate-950">
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
                      <div className="flex-1 flex flex-col items-center justify-center text-center p-8 max-w-md mx-auto py-20">
                        <div className="w-16 h-16 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mb-4 text-indigo-400 shadow-xl">
                          {activePart?.mp3Asset ? <Headphones size={28} /> : <Sparkles size={28} />}
                        </div>
                        <h4 className="text-base font-bold text-white mb-1.5">
                          {episodeParts.length > 1 && activePart ? `Queued for Auto-Transcription (${activePart.label})` : 'Queued for Automatic Transcription'}
                        </h4>
                        <p className="text-slate-400 text-xs mb-6 leading-relaxed">
                          {episodeParts.length > 1 && activePart
                            ? `Audio for ${activePart.label} is available to play. It is queued in the automatic transcription pipeline (newest to oldest). You can also prioritize it right now.`
                            : 'This episode has audio published and is queued in the automatic transcription pipeline. You can also prioritize it right now to process it immediately.'}
                        </p>
                        {transcribeSuccess ? (
                          <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-300 text-xs mb-4 text-left w-full shadow-lg">
                            <p className="font-semibold flex items-center gap-1.5"><Check size={14} /> Job Dispatched</p>
                            <p className="mt-1 opacity-90">{transcribeSuccess}</p>
                          </div>
                        ) : (
                          <div className="flex flex-col sm:flex-row items-center gap-3">
                            {activePart?.mp3Asset && (
                              <button
                                onClick={handlePlayEpisodeToggle}
                                className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg shadow-lg transition-all hover:scale-105 cursor-pointer"
                              >
                                {isCurrentEpisodePlaying ? <Pause size={14} /> : <Play size={14} />}
                                {isCurrentEpisodePlaying ? `Pause ${activePart.label}` : `Play ${activePart.label} Audio`}
                              </button>
                            )}
                            <button onClick={handleGenerateTranscript} disabled={transcribing}
                              className="flex items-center gap-2 px-5 py-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg border border-slate-700 shadow-md transition-all hover:scale-105 cursor-pointer">
                              {transcribing ? <Loader size={14} className="animate-spin" /> : <Sparkles size={14} className="text-amber-400" />}
                              {transcribing ? 'Dispatching priority job…' : (episodeParts.length > 1 && activePart ? `⚡ Prioritize ${activePart.label}` : '⚡ Prioritize This Episode')}
                            </button>
                          </div>
                        )}
                      </div>
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
                      <div className="max-w-3xl mx-auto space-y-3.5 pb-24">
                        {/* Dynamic Episode Confrontation & Density Heatmap */}
                        {conversationHeatmap.length > 0 && (
                          <div className="p-3 bg-slate-900/90 border border-slate-800 rounded-xl shadow-sm mb-4">
                            <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                              <div className="flex items-center gap-2">
                                <BarChart3 size={13} className="text-indigo-400" />
                                <span className="font-semibold text-slate-200">Episode Timeline Heatmap</span>
                                <span className="text-[11px] text-slate-400">({utterances.length} turns mapped)</span>
                              </div>
                              <div className="flex items-center gap-3 text-[11px]">
                                <span className="flex items-center gap-1.5 text-slate-400">
                                  <span className="w-2 h-2 rounded-sm bg-indigo-500 inline-block" /> Speech Density
                                </span>
                                <span className="flex items-center gap-1.5 text-rose-400 font-medium">
                                  <span className="w-2 h-2 rounded-sm bg-rose-500 inline-block" /> Confrontation / Mentions
                                </span>
                              </div>
                            </div>
                            <div className="flex items-end gap-[3px] h-10 w-full bg-slate-950/70 p-1.5 rounded-xl border border-slate-800/80 overflow-hidden">
                              {conversationHeatmap.map((bucket) => {
                                const heightPct = Math.max(18, Math.round(bucket.density * 100));
                                return (
                                  <button
                                    key={bucket.index}
                                    type="button"
                                    onClick={() => handlePlayUtterance(bucket.startSec)}
                                    className={`flex-1 rounded-sm transition-all hover:scale-y-110 hover:brightness-125 cursor-pointer relative group ${
                                      bucket.isHot
                                        ? 'bg-rose-500 hover:bg-rose-400 shadow-sm'
                                        : bucket.density > 0.6
                                        ? 'bg-indigo-500 hover:bg-indigo-400'
                                        : bucket.density > 0.2
                                        ? 'bg-indigo-700/60 hover:bg-indigo-600'
                                        : 'bg-slate-800/60 hover:bg-slate-700'
                                    }`}
                                    style={{ height: `${heightPct}%` }}
                                    title={`Seek to ${bucket.label} (${bucket.count} turns${bucket.mentionCount > 0 ? `, ${bucket.mentionCount} mentions` : ''})`}
                                  />
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {filteredUtterances.map((utterance) => {
                          const isPlayingThisUtterance = activeUtteranceId === utterance.id;
                          const theme = getSpeakerTheme(utterance.speaker, savedSpeakers);
                          const initialChar = utterance.speaker.replace(/^Speaker\s+/i, '').trim().charAt(0).toUpperCase() || 'S';

                          let activeWordIndex = -1;
                          let utteranceWords: UtteranceWord[] = [];
                          if (isPlayingThisUtterance) {
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
                            <div
                              id={`utterance-card-${utterance.id}`}
                              key={utterance.id}
                              onClick={() => handlePlayUtterance(utterance.startSec)}
                              className={`group flex items-start gap-3.5 p-4 rounded-xl border transition-all cursor-pointer relative ${
                                isPlayingThisUtterance
                                  ? 'bg-indigo-950/40 border-indigo-500/80 shadow-xl ring-1 ring-indigo-500/40'
                                  : 'bg-slate-900/50 border-slate-800/80 hover:bg-slate-900 hover:border-slate-700/80 hover:shadow-md'
                              }`}
                            >
                              {/* Avatar */}
                              <div
                                onClick={e => { e.stopPropagation(); openQuickRename(utterance.rawSpeaker, utterance.speaker); }}
                                className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs flex-shrink-0 shadow-sm mt-0.5 transition-transform group-hover:scale-105 ${theme.avatar} cursor-pointer hover:ring-2 hover:ring-indigo-400`}
                                title={`Click to rename ${utterance.speaker}`}>
                                {theme.emoji ? <span className="text-base select-none">{theme.emoji}</span> : <span>{initialChar}</span>}
                              </div>

                              {/* Body */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                                  <div className="flex items-center gap-2 relative">

                                    {/* Speaker Tag */}
                                    <button
                                      type="button"
                                      onClick={e => { e.stopPropagation(); openQuickRename(utterance.rawSpeaker, utterance.speaker); }}
                                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg border text-xs font-bold ${theme.badge} hover:ring-2 hover:ring-indigo-400/60 hover:brightness-110 transition-all cursor-pointer group/tag shadow-sm`}
                                      title={`Click to rename ${utterance.speaker} across this episode`}
                                    >
                                      {theme.emoji ? <span className="text-xs">{theme.emoji}</span> : <span className={`w-1.5 h-1.5 rounded-full ${theme.dot}`} />}
                                      <span>{utterance.speaker}</span>
                                      <Pencil size={10} className="opacity-50 group-hover/tag:opacity-100 transition-opacity ml-0.5 text-slate-200" />
                                    </button>

                                    {/* Timestamp seek button */}
                                    <button onClick={e => { e.stopPropagation(); handlePlayUtterance(utterance.startSec); }}
                                      className="inline-flex items-center gap-1 text-[11px] font-mono font-medium px-2 py-0.5 rounded-md bg-slate-800/80 hover:bg-indigo-500/20 text-slate-400 hover:text-indigo-300 border border-slate-700/60 transition-colors cursor-pointer">
                                      <Play size={9} className="text-indigo-400 fill-indigo-400/40" />
                                      <span>{utterance.startLabel}</span>
                                      {utterance.endLabel && <span className="text-slate-400 font-normal"> – {utterance.endLabel}</span>}
                                    </button>

                                    {/* 1-click audio seek sync calibration */}
                                    {isPlaying && (
                                      <button onClick={e => {
                                          e.stopPropagation();
                                          const diff = Math.round((currentTime - utterance.startSec) * 10) / 10;
                                          setAndSaveAudioSeekOffset(diff);
                                        }}
                                        className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1 text-[11px] font-mono px-1.5 py-0.5 rounded-md bg-indigo-500/15 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/30 cursor-pointer"
                                        title={`Align audio playback seek to this turn (${Math.round((currentTime - utterance.startSec) * 10) / 10 > 0 ? `+${Math.round((currentTime - utterance.startSec) * 10) / 10}s` : `${Math.round((currentTime - utterance.startSec) * 10) / 10}s`} offset)`}>
                                        <Clock size={10} className="text-indigo-400" />
                                        Sync audio ({Math.round((currentTime - utterance.startSec) * 10) / 10 > 0 ? `+${Math.round((currentTime - utterance.startSec) * 10) / 10}s` : `${Math.round((currentTime - utterance.startSec) * 10) / 10}s`})
                                      </button>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <button
                                      type="button"
                                      onClick={e => {
                                        e.stopPropagation();
                                        openQuickSlicer({
                                          speaker: utterance.speaker,
                                          quote: utterance.text,
                                          sourceTitle: selectedRelease?.name || 'Space Episode',
                                          sourceTag: selectedRelease?.tag_name || '',
                                          audioUrl: mp3Asset?.browser_download_url,
                                          startSec: utterance.startSec,
                                          endSec: utterance.endSec !== null && utterance.endSec > utterance.startSec ? utterance.endSec : utterance.startSec + 15,
                                          words: utterance.words,
                                        });
                                      }}
                                      className="opacity-70 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 hover:text-white border border-amber-500/30 cursor-pointer"
                                      title="Fine-tune boundaries and slice audio clip"
                                    >
                                      <Scissors size={10} className="text-amber-400" />
                                      <span>Slice</span>
                                    </button>

                                    <button
                                      type="button"
                                      onClick={e => {
                                        e.stopPropagation();
                                        handleAddTurnToMontage(
                                          utterance.speaker,
                                          utterance.text,
                                          utterance.startSec,
                                          utterance.endSec,
                                          mp3Asset?.browser_download_url,
                                          selectedRelease?.name,
                                          selectedRelease?.tag_name
                                        );
                                      }}
                                      className="opacity-70 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 hover:text-white border border-indigo-500/30 cursor-pointer"
                                      title="Add turn to Montage Reel Builder"
                                    >
                                      <Film size={10} className="text-indigo-400" />
                                      <span>+ Reel</span>
                                    </button>

                                    {typeof utterance.confidence === 'number' && (
                                      <span className={`text-[11px] font-mono ${utterance.confidence >= 0.9 ? 'text-emerald-500' : utterance.confidence >= 0.75 ? 'text-amber-500' : 'text-rose-400'}`}
                                        title="Confidence score">{(utterance.confidence * 100).toFixed(0)}%</span>
                                    )}
                                    {isPlayingThisUtterance && (
                                      <span className="flex items-center gap-1.5 text-[11px] font-bold text-indigo-400 uppercase tracking-wider bg-indigo-500/15 px-2.5 py-0.5 rounded-full border border-indigo-500/30 animate-pulse">
                                        <Volume2 size={11} /> Speaking Now
                                      </span>
                                    )}
                                  </div>
                                </div>

                                {isPlayingThisUtterance ? (
                                  <p className="text-[15px] leading-relaxed transition-colors select-text text-slate-100">
                                    {utteranceWords.map((w, wIdx) => {
                                      const isActiveWord = wIdx === activeWordIndex;
                                      const isPastWord = activeWordIndex >= 0 && wIdx < activeWordIndex;
                                      return (
                                        <React.Fragment key={wIdx}>
                                          <span
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handlePlayUtterance(w.start);
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
                                  <p className={`text-[15px] leading-relaxed transition-colors select-text ${isPlayingThisUtterance ? 'text-white font-medium' : 'text-slate-100'}`}>
                                    {highlightMatch(utterance.text, search)}
                                  </p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
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
