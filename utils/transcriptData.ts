import type { Release } from '../types';

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

export interface TranscriptMetadata {
  model?: string;
  language?: string;
  confidence?: number | null;
  audioDurationSec?: number | null;
  transcriptId?: string;
}

export type ReleaseAssetLike = {
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
  duration_sec?: number | null;
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

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function parseTimeToSeconds(timeStr: string): number {
  if (!timeStr) return 0;
  const cleaned = timeStr.trim().replace(/^\[|\]$/g, '');
  const parts = cleaned.split(':').map(Number);
  if (parts.some(Number.isNaN)) return 0;
  if (parts.length === 3) return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
  if (parts.length === 2) return (parts[0] || 0) * 60 + (parts[1] || 0);
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function inferNumericTimestampScale(segments: any[]): 1 | 1000 {
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

export function readTimestampSeconds(segment: any, key: 'start' | 'end', scale: 1 | 1000): number | null {
  const explicitMs = segment?.[`${key}_ms`];
  if (typeof explicitMs === 'number' && Number.isFinite(explicitMs)) return explicitMs / 1000;
  const explicitSec = segment?.[`${key}_sec`] ?? segment?.[`${key}_seconds`];
  if (typeof explicitSec === 'number' && Number.isFinite(explicitSec)) return explicitSec;
  const value = segment?.[key] ?? segment?.[`${key}_time`];
  if (typeof value === 'number' && Number.isFinite(value)) return value / scale;
  if (typeof value === 'string') return parseTimeToSeconds(value);
  return null;
}

export function normalizeSpeakerLabel(value: unknown): string {
  const raw = String(value ?? 'A').trim() || 'A';
  if (/^Speaker\s+/i.test(raw)) return raw;
  return raw.length <= 3 ? `Speaker ${raw}` : raw;
}

export function isLikelyTranscriptAsset(asset: ReleaseAssetLike): boolean {
  const name = asset.name.toLowerCase();
  if (name.endsWith('.mp3') || name.endsWith('.m4a') || name.endsWith('.wav') || name.endsWith('.jpg') || name.endsWith('.png') || name.endsWith('.jpeg') || name.endsWith('.md')) {
    return false;
  }
  if (name.endsWith('_clips.json') || name === 'clips_catalog.json' || name.endsWith('_catalog.json')) {
    return false;
  }
  return /\.(json|txt)$/i.test(name);
}

export function transcriptAssetScore(asset: ReleaseAssetLike, releaseTag?: string): number {
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

export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function pickTranscriptAsset(release: Release, partNum = 1): Release['assets'][number] | undefined {
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

export function pickAudioMp3Asset(release?: Release | null): Release['assets'][number] | undefined {
  if (!release?.assets) return undefined;
  return release.assets.find(a => /\.(mp3|m4a|wav|aac)$/i.test(a.name));
}

export function parseTranscriptMetadata(rawContent: string): TranscriptMetadata {
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

export function formatSeconds(sec: number): string {
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

export const DEFAULT_SAVED_SPEAKERS: SavedSpeaker[] = [
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

export function getSpeakerTheme(displayName: string, savedSpeakers: SavedSpeaker[] = []) {
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

export function parseTranscriptData(rawContent: string): ParsedUtterance[] {
  if (!rawContent.trim()) return [];

  try {
    const json = JSON.parse(rawContent);
    const candidates: any[][] = [];
    const addCandidate = (value: unknown) => {
      if (Array.isArray(value) && value.length > 0) candidates.push(value);
    };
    addCandidate(json);
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

  if (/^\s*[\[{]/.test(rawContent)) return [];
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
