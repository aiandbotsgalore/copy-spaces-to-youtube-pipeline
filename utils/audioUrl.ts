/**
 * Browser-side audio URL routing. Cross-origin GitHub release assets cannot be fetch()ed directly (no CORS headers),
 * so Web Audio decoding, WAV export and duration probing go through the local /api/montage/audio proxy.
 * Same-origin URLs, blob: URLs and unknown hosts are left untouched.
 */
export const AUDIO_PROXY_PATH = '/api/montage/audio';

export function needsAudioProxy(url: string, pageOrigin?: string): boolean {
  if (!url || !/^https:\/\//i.test(url)) return false;
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    const githubHost = h === 'github.com' || h === 'githubusercontent.com' || h.endsWith('.githubusercontent.com');
    if (!githubHost) return false;
    const origin = pageOrigin ?? (typeof location !== 'undefined' ? location.origin : '');
    return u.origin !== origin;
  } catch {
    return false;
  }
}

/** The URL to use when the browser must read the bytes (fetch / decodeAudioData / metadata probe). */
export function toFetchableUrl(url: string, pageOrigin?: string): string {
  return needsAudioProxy(url, pageOrigin) ? `${AUDIO_PROXY_PATH}?url=${encodeURIComponent(url)}` : url;
}

export function getEdgeSlicerBaseUrl(): string {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_EDGE_SLICER_URL) {
      return String(import.meta.env.VITE_EDGE_SLICER_URL).trim().replace(/\/+$/, '');
    }
  } catch {}
  return '';
}

/**
 * Resolves an audio URL to a sliced proxy URL if start/end timestamps are provided,
 * preventing multi-gigabyte monolithic file downloads into Web Audio memory.
 * If VITE_EDGE_SLICER_URL is configured, routes directly to the Cloudflare Worker edge slicer.
 */
export function toSliceableUrl(
  url: string,
  startSec?: number,
  endSec?: number,
  durationSec?: number,
  pageOrigin?: string
): string {
  if (!url) return '';
  if (
    startSec !== undefined &&
    endSec !== undefined &&
    Number.isFinite(startSec) &&
    Number.isFinite(endSec) &&
    endSec > startSec &&
    (startSec > 0 || (durationSec && durationSec > 180))
  ) {
    const params = new URLSearchParams({
      url,
      start: String(startSec),
      end: String(endSec),
    });
    if (durationSec && Number.isFinite(durationSec) && durationSec > 0) {
      params.set('dur', String(durationSec));
    }
    const edgeBase = getEdgeSlicerBaseUrl();
    if (edgeBase) {
      return `${edgeBase}/slice?${params.toString()}`;
    }
    return `${AUDIO_PROXY_PATH}?${params.toString()}`;
  }
  return toFetchableUrl(url, pageOrigin);
}
