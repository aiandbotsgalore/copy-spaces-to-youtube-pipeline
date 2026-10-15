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
