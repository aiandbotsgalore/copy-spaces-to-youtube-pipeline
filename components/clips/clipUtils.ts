import { getClipRecordedDate } from '../../utils/dates';
import { ClipItem } from '../../utils/contracts/clipCatalog';

export const formatEpisodeTitle = (ep?: string): string => {
  if (!ep) return 'Unknown Space';
  let clean = ep.replace(/^20\d{6}_[a-zA-Z0-9]+_/, '');
  clean = clean.replace(/_/g, ' ').replace(/-/g, ' ').trim();
  return clean || ep;
};

export const normalizeCategory = (cat?: string): string => {
  const c = (cat || '').trim();
  const lower = c.toLowerCase();
  if (lower.includes('humor') || lower.includes('banter')) return 'Humor & Banter';
  if (lower.includes('story') || lower.includes('stories') || lower.includes('wild')) return 'Wild Stories';
  if (lower.includes('rant')) return 'Passionate Rants';
  if (lower.includes('quote') || lower.includes('golden')) return 'Golden Quotes';
  if (lower.includes('highlight')) return 'Highlights';
  return c || 'Highlights';
};

export const CANONICAL_CATEGORY_ORDER = [
  'ALL',
  'Humor & Banter',
  'Wild Stories',
  'Passionate Rants',
  'Golden Quotes',
  'Highlights'
];

export const getCategoryColor = (cat: string) => {
  const canonical = normalizeCategory(cat);
  const c = canonical.toLowerCase();
  const dot =
    c.includes('rant') ? 'bg-rose-400'
    : c.includes('humor') || c.includes('banter') ? 'bg-amber-400'
    : c.includes('story') || c.includes('wild') ? 'bg-indigo-400'
    : c.includes('quote') || c.includes('golden') ? 'bg-slate-400'
    : 'bg-emerald-400';
  return {
    badge: 'bg-slate-800 text-slate-300 border-transparent',
    pill: 'text-slate-300 bg-slate-800 border-transparent',
    dot,
    icon: ''
  };
};

export const getAudioUrl = (clip: ClipItem): string => {
  if (clip.download_url && clip.download_url.startsWith('http')) {
    return clip.download_url;
  }
  if (clip.file_path) {
    if (clip.file_path.startsWith('http')) return clip.file_path;
    const base = ((import.meta as any).env?.BASE_URL || '/').replace(/\/$/, '');
    const cleanPath = clip.file_path.replace(/^\.?\/?public\//, '').replace(/^\.?\//, '');
    return `${base}/${cleanPath}`;
  }
  return '';
};
