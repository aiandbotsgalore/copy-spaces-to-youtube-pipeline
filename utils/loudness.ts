/**
 * Integrated loudness per ITU-R BS.1770-4 / EBU R128 (K-weighting, 400 ms blocks with 75% overlap,
 * absolute gate at -70 LUFS, relative gate 10 LU below), and a master pass that brings a mix to a target
 * loudness under a sample-peak ceiling with a smooth look-ahead limiter. Pure functions over channel data.
 */

type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };

/** K-weighting filter pair for a sample rate (the libebur128 derivation of the BS.1770 filters). */
export function kWeighting(rate: number): [Biquad, Biquad] {
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / rate);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf: Biquad = { b0: (Vh + (Vb * K) / Q + K * K) / a0, b1: (2 * (K * K - Vh)) / a0, b2: (Vh - (Vb * K) / Q + K * K) / a0, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / rate);
  a0 = 1 + K / Q + K * K;
  const highpass: Biquad = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  return [shelf, highpass];
}

function filter(x: Float32Array, f: Biquad): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = f.b0 * x[i] + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
    y[i] = v;
  }
  return y;
}

/** Integrated loudness in LUFS of one to two channels (weights 1.0); -Infinity for silence. */
export function integratedLoudness(channels: Float32Array[], rate: number): number {
  const [shelf, hp] = kWeighting(rate);
  const weighted = channels.map(c => filter(filter(c, shelf), hp));
  const block = Math.round(0.4 * rate);
  const hop = Math.round(0.1 * rate);
  const len = channels[0]?.length || 0;
  if (len < block) {
    // shorter than one block: measure the whole signal as one block
    if (!len) return -Infinity;
    const z = weighted.reduce((s, w) => s + w.reduce((a, v) => a + v * v, 0) / len, 0);
    return z > 0 ? -0.691 + 10 * Math.log10(z) : -Infinity;
  }
  // prefix sums of squares per channel for O(n) block energies
  const prefix = weighted.map(w => {
    const p = new Float64Array(w.length + 1);
    for (let i = 0; i < w.length; i++) p[i + 1] = p[i] + w[i] * w[i];
    return p;
  });
  const z: number[] = [];
  for (let s = 0; s + block <= len; s += hop) z.push(prefix.reduce((acc, p) => acc + (p[s + block] - p[s]) / block, 0));
  const lk = (e: number) => -0.691 + 10 * Math.log10(e);
  const abs = z.filter(e => e > 0 && lk(e) > -70);
  if (!abs.length) return -Infinity;
  const relGate = lk(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const rel = abs.filter(e => lk(e) > relGate);
  return lk(rel.reduce((a, b) => a + b, 0) / rel.length);
}

export function samplePeak(channels: Float32Array[]): number {
  let p = 0;
  for (const c of channels) for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > p) p = a; }
  return p;
}
export const toDb = (amp: number) => (amp > 0 ? 20 * Math.log10(amp) : -Infinity);

/**
 * Look-ahead peak limiter in place: gain falls smoothly over `lookMs` before any sample that would exceed
 * the ceiling, and recovers with a `releaseMs` time constant. No sample ends above the ceiling.
 */
export function limitPeaks(channels: Float32Array[], rate: number, ceiling: number, lookMs = 2, releaseMs = 80): void {
  const n = channels[0]?.length || 0;
  if (!n) return;
  const L = Math.max(1, Math.round((lookMs / 1000) * rate));
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (const c of channels) { const a = Math.abs(c[i]); if (a > m) m = a; }
    need[i] = m > ceiling ? ceiling / m : 1;
  }
  // sliding minimum over [i, i + 2L] (monotonic deque), then a box average over L: the ramp reaches each
  // peak's gain by the time the peak plays
  const minW = new Float32Array(n);
  const dq: number[] = [];
  let head = 0;
  for (let j = 0; j < n + 2 * L; j++) {
    if (j < n) {
      while (dq.length > head && need[dq[dq.length - 1]] >= need[j]) dq.pop();
      dq.push(j);
    }
    const i = j - 2 * L;
    if (i >= 0) {
      while (dq[head] < i) head++;
      minW[i] = need[dq[head]];
    }
  }
  const rel = Math.exp(-1 / ((releaseMs / 1000) * rate));
  let acc = L; // the window starts full of gain 1 (samples before the start)
  let env = 1;
  for (let i = 0; i < n; i++) {
    acc += minW[i] - (i >= L ? minW[i - L] : 1);
    const avg = acc / L;
    const target = Math.min(avg, need[i]);
    env = target < env ? target : target + (env - target) * rel;
    for (const c of channels) c[i] *= env;
  }
}

/**
 * Brings channels (in place) to `targetLufs` integrated loudness with no sample above `peakDb`.
 * Limiting lowers loudness slightly, so gain and limiting are repeated a few times. Returns the measured result.
 */
export function masterToLoudness(channels: Float32Array[], rate: number, targetLufs = -16, peakDb = -1): { integratedLufs: number; samplePeakDb: number; gainDb: number } {
  const ceiling = Math.pow(10, peakDb / 20);
  let total = 0;
  let lufs = integratedLoudness(channels, rate);
  if (!Number.isFinite(lufs)) return { integratedLufs: lufs, samplePeakDb: toDb(samplePeak(channels)), gainDb: 0 };
  for (let pass = 0; pass < 4 && Math.abs(lufs - targetLufs) > 0.2; pass++) {
    const gDb = Math.max(-30, Math.min(30, targetLufs - lufs));
    const g = Math.pow(10, gDb / 20);
    for (const c of channels) for (let i = 0; i < c.length; i++) c[i] *= g;
    total += gDb;
    limitPeaks(channels, rate, ceiling);
    lufs = integratedLoudness(channels, rate);
  }
  // guarantee the ceiling exactly (float rounding in the limiter)
  for (const c of channels) for (let i = 0; i < c.length; i++) { if (c[i] > ceiling) c[i] = ceiling; else if (c[i] < -ceiling) c[i] = -ceiling; }
  return { integratedLufs: Math.round(lufs * 10) / 10, samplePeakDb: Math.round(toDb(samplePeak(channels)) * 10) / 10, gainDb: Math.round(total * 10) / 10 };
}
