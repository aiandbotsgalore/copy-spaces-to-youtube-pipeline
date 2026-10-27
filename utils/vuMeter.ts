// Real level metering helpers for the Vox Studio VU meter.
// Levels are computed from actual PCM samples read from a Web Audio AnalyserNode.

/** Lowest level shown on the meter, in dBFS. Anything quieter reads as 0. */
export const VU_FLOOR_DB = -60;

/** Root-mean-square of a block of samples in the range [-1, 1]. */
export function rms(samples: ArrayLike<number>): number {
  const n = samples.length;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = samples[i];
    sum += v * v;
  }
  return Math.sqrt(sum / n);
}

/** Converts a linear amplitude to dBFS (-Infinity for silence). */
export function toDbfs(amplitude: number): number {
  return amplitude > 0 ? 20 * Math.log10(amplitude) : -Infinity;
}

/**
 * Maps a block of samples to a meter position in [0, 1]:
 * 0 at or below VU_FLOOR_DB, 1 at 0 dBFS, linear in dB between.
 */
export function meterLevel(samples: ArrayLike<number>, floorDb: number = VU_FLOOR_DB): number {
  const db = toDbfs(rms(samples));
  if (!Number.isFinite(db) || db <= floorDb) return 0;
  if (db >= 0) return 1;
  return (db - floorDb) / -floorDb;
}

/** True when the URL is served from the page's own origin (Web Audio can read its samples). */
export function isSameOriginUrl(url: string, pageOrigin: string): boolean {
  try {
    return new URL(url, pageOrigin).origin === new URL(pageOrigin).origin;
  } catch {
    return false;
  }
}
