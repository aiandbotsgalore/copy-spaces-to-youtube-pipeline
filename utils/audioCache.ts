/**
 * Audio Cache Manager (Browser Cache Storage & Blob Storage)
 * Provides offline caching and zero-latency instant scrubbing for massive Space audio files.
 */

const CACHE_NAME = 'spacepipe-audio-cache-v1';

// In-memory mapping of cached remote URLs to local Blob URLs for rapid playback
const activeBlobUrls = new Map<string, string>();

export async function isAudioCached(url: string): Promise<boolean> {
  if (!url || typeof window === 'undefined' || !('caches' in window)) return false;
  try {
    const cache = await caches.open(CACHE_NAME);
    const match = await cache.match(url);
    return !!match;
  } catch (err) {
    console.warn('Cache check failed:', err);
    return false;
  }
}

export async function cacheAudioFile(
  url: string,
  onProgress?: (progress: { loaded: number; total: number; percent: number }) => void
): Promise<string> {
  if (!url) throw new Error('Audio URL is required');
  if (typeof window === 'undefined' || !('caches' in window)) {
    throw new Error('Cache Storage API is not supported in this browser');
  }

  const cache = await caches.open(CACHE_NAME);
  const existing = await cache.match(url);
  if (existing) {
    const blob = await existing.blob();
    const blobUrl = URL.createObjectURL(blob);
    activeBlobUrls.set(url, blobUrl);
    return blobUrl;
  }

  const response = await fetch(url, { mode: 'cors' });
  if (!response.ok) {
    throw new Error(`Failed to fetch audio stream: ${response.status} ${response.statusText}`);
  }

  const contentLength = Number(response.headers.get('content-length')) || 0;
  
  if (response.body && onProgress && contentLength > 0) {
    const reader = response.body.getReader();
    let receivedLength = 0;
    const chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        receivedLength += value.length;
        onProgress({
          loaded: receivedLength,
          total: contentLength,
          percent: Math.min(100, Math.round((receivedLength / contentLength) * 100)),
        });
      }
    }

    const blob = new Blob(chunks, { type: response.headers.get('content-type') || 'audio/mpeg' });
    const cachedResponse = new Response(blob, {
      status: 200,
      headers: response.headers,
    });
    await cache.put(url, cachedResponse);

    const blobUrl = URL.createObjectURL(blob);
    activeBlobUrls.set(url, blobUrl);
    return blobUrl;
  } else {
    // Clone and put directly
    const clone = response.clone();
    await cache.put(url, clone);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    activeBlobUrls.set(url, blobUrl);
    if (onProgress) {
      onProgress({ loaded: blob.size, total: blob.size, percent: 100 });
    }
    return blobUrl;
  }
}

export async function getCachedAudioUrl(url: string): Promise<string | null> {
  if (!url || typeof window === 'undefined' || !('caches' in window)) return null;

  if (activeBlobUrls.has(url)) {
    return activeBlobUrls.get(url)!;
  }

  try {
    const cache = await caches.open(CACHE_NAME);
    const match = await cache.match(url);
    if (match) {
      const blob = await match.blob();
      const blobUrl = URL.createObjectURL(blob);
      activeBlobUrls.set(url, blobUrl);
      return blobUrl;
    }
  } catch (err) {
    console.warn('Error reading from audio cache:', err);
  }
  return null;
}

export async function removeCachedAudio(url: string): Promise<boolean> {
  if (!url || typeof window === 'undefined' || !('caches' in window)) return false;
  try {
    const cache = await caches.open(CACHE_NAME);
    const deleted = await cache.delete(url);
    if (activeBlobUrls.has(url)) {
      URL.revokeObjectURL(activeBlobUrls.get(url)!);
      activeBlobUrls.delete(url);
    }
    return deleted;
  } catch (err) {
    console.warn('Error deleting cached audio:', err);
    return false;
  }
}

export async function getAllCachedAudioKeys(): Promise<string[]> {
  if (typeof window === 'undefined' || !('caches' in window)) return [];
  try {
    const cache = await caches.open(CACHE_NAME);
    const requests = await cache.keys();
    return requests.map(r => r.url);
  } catch (err) {
    console.warn('Error listing cached audio:', err);
    return [];
  }
}

export async function clearAllAudioCache(): Promise<void> {
  if (typeof window === 'undefined' || !('caches' in window)) return;
  try {
    activeBlobUrls.forEach(blobUrl => URL.revokeObjectURL(blobUrl));
    activeBlobUrls.clear();
    await caches.delete(CACHE_NAME);
  } catch (err) {
    console.warn('Error clearing audio cache:', err);
  }
}
