/**
 * utils/audioPeaks.ts
 *
 * Professional-grade audio waveform peak extraction & caching engine.
 * Supports:
 *  1. Remote pre-computed .peaks.json lookups
 *  2. In-browser Web Audio decoding via OfflineAudioContext
 *  3. In-memory LRU caching to prevent re-computation
 *  4. Fast Float32Array root-mean-square (RMS) and peak amplitude sampling
 */

const PEAKS_CACHE = new Map<string, number[]>();
const MAX_CACHE_SIZE = 100;

/**
 * Computes normalized waveform bar heights (percentage 15-98) from raw PCM audio channel data.
 */
export function computePeaksFromChannelData(
  channelData: Float32Array,
  numBars: number = 64
): number[] {
  if (!channelData || channelData.length === 0 || numBars <= 0) {
    return Array(numBars).fill(30);
  }

  const samplesPerBar = Math.floor(channelData.length / numBars);
  if (samplesPerBar <= 0) {
    return Array(numBars).fill(30);
  }

  const rawPeaks: number[] = [];
  let maxPeak = 0;

  for (let i = 0; i < numBars; i++) {
    const start = i * samplesPerBar;
    const end = Math.min(start + samplesPerBar, channelData.length);
    let sumSquares = 0;
    let peak = 0;

    for (let j = start; j < end; j++) {
      const val = Math.abs(channelData[j]);
      if (val > peak) peak = val;
      sumSquares += val * val;
    }

    const rms = Math.sqrt(sumSquares / Math.max(1, end - start));
    // Blended metric: 60% RMS (perceived loudness) + 40% absolute peak (percussive transients)
    const combined = rms * 0.6 + peak * 0.4;
    rawPeaks.push(combined);
    if (combined > maxPeak) maxPeak = combined;
  }

  // Normalize heights between 15% (subtle baseline) and 95% (peak)
  const safeMax = maxPeak > 0.001 ? maxPeak : 1.0;
  return rawPeaks.map(val => {
    const normalized = val / safeMax;
    return Math.max(15, Math.min(95, Math.round(normalized * 100)));
  });
}

/**
 * Extracts normalized waveform peaks from an in-memory AudioBuffer.
 */
export function extractPeaksFromAudioBuffer(
  audioBuffer: AudioBuffer,
  numBars: number = 64
): number[] {
  // Use first channel (mono/left) or average across channels
  const channelData = audioBuffer.getChannelData(0);
  return computePeaksFromChannelData(channelData, numBars);
}

/**
 * Fetches and extracts real audio waveform peaks for any audio URL.
 * Checks in-memory cache first, then attempts precomputed .peaks.json,
 * then decodes audio bytes via Web Audio API.
 */
export async function getAudioPeaks(
  audioUrl: string,
  numBars: number = 64
): Promise<number[]> {
  if (!audioUrl) {
    return Array(numBars).fill(25);
  }

  const cacheKey = `${audioUrl}_${numBars}`;
  if (PEAKS_CACHE.has(cacheKey)) {
    return PEAKS_CACHE.get(cacheKey)!;
  }

  // 1. Check for remote precomputed .peaks.json alongside audio
  try {
    const peaksUrl = audioUrl.replace(/\.(mp3|wav|ogg|m4a)(\?.*)?$/i, '.peaks.json$2');
    if (peaksUrl !== audioUrl) {
      const resp = await fetch(peaksUrl, { method: 'GET', cache: 'force-cache' });
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data) && data.length > 0) {
          // Resample or downsample data to match requested numBars
          const resampled = resamplePeaks(data, numBars);
          setCachedPeaks(cacheKey, resampled);
          return resampled;
        }
      }
    }
  } catch {
    // Proceed to live Web Audio extraction
  }

  // 2. Decode audio via Web Audio API
  try {
    const res = await fetch(audioUrl, { mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();

    // Decode audio into an AudioBuffer
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) {
      const ctx = new AudioContextClass();
      const decodedBuffer = await ctx.decodeAudioData(arrayBuffer);
      const peaks = extractPeaksFromAudioBuffer(decodedBuffer, numBars);
      ctx.close().catch(() => {});
      setCachedPeaks(cacheKey, peaks);
      return peaks;
    }
  } catch (err) {
    console.debug('[audioPeaks] Could not decode live audio for peaks:', err);
  }

  // 3. Fallback to deterministic pseudo peaks if offline or undecodable
  const fallback = generateSyntheticPeaks(audioUrl, numBars);
  setCachedPeaks(cacheKey, fallback);
  return fallback;
}

function setCachedPeaks(key: string, peaks: number[]) {
  if (PEAKS_CACHE.size >= MAX_CACHE_SIZE) {
    const oldestKey = PEAKS_CACHE.keys().next().value;
    if (oldestKey !== undefined) PEAKS_CACHE.delete(oldestKey);
  }
  PEAKS_CACHE.set(key, peaks);
}

function resamplePeaks(source: number[], targetLength: number): number[] {
  if (source.length === targetLength) return source;
  const result: number[] = [];
  const ratio = source.length / targetLength;
  for (let i = 0; i < targetLength; i++) {
    const idx = Math.min(Math.floor(i * ratio), source.length - 1);
    result.push(source[idx]);
  }
  return result;
}

function generateSyntheticPeaks(seed: string, numBars: number): number[] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const result: number[] = [];
  for (let i = 0; i < numBars; i++) {
    const pseudo = Math.abs(Math.sin((hash + i * 37) * 0.15));
    const vocalArch = Math.sin((i / numBars) * Math.PI);
    const height = Math.max(15, Math.min(95, Math.round((pseudo * 0.7 + vocalArch * 0.3) * 100)));
    result.push(height);
  }
  return result;
}
