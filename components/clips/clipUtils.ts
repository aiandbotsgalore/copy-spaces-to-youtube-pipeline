import { getClipRecordedDate } from '../../utils/dates';
import { ClipItem } from '../../utils/contracts/clipCatalog';

export const CLOUDFLARE_R2_BASE_URL = 'https://pub-b492226ab4ed45d692e9f14794366106.r2.dev';

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
  // Always route through Cloudflare R2 when we can derive an MP3 filename,
  // regardless of whether the catalog entry points to GitHub Releases or a
  // local path. GitHub release download URLs lack CORS headers and
  // Content-Type: audio/mpeg, so the browser <audio> element stalls under
  // the app's Cross-Origin-Embedder-Policy: require-corp header.
  const rawUrl = clip.download_url || clip.file_path || '';
  if (rawUrl) {
    const cleanFn = rawUrl.split(/[\\/]/).pop()?.split('?')[0] || '';
    if (cleanFn && (cleanFn.endsWith('.mp3') || cleanFn.endsWith('.wav'))) {
      // If the URL already points to our R2 CDN, return it as-is.
      if (rawUrl.startsWith(CLOUDFLARE_R2_BASE_URL)) return rawUrl;
      // Otherwise rewrite to R2 (covers GitHub Releases and local paths).
      return `${CLOUDFLARE_R2_BASE_URL}/${encodeURIComponent(cleanFn)}`;
    }
    // Non-audio URLs (e.g. fully-qualified external URLs to other hosts).
    if (rawUrl.startsWith('http')) return rawUrl;
  }
  if (clip.file_path && !clip.file_path.startsWith('http')) {
    const base = ((import.meta as any).env?.BASE_URL || '/').replace(/\/$/, '');
    const cleanPath = clip.file_path.replace(/^\.?\/?public\//, '').replace(/^\.?\//, '');
    return `${base}/${cleanPath}`;
  }
  return '';
};
