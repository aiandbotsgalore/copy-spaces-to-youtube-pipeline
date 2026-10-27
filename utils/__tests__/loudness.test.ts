import { describe, it, expect } from 'vitest';
import { integratedLoudness, limitPeaks, masterToLoudness, samplePeak, toDb } from '../loudness';

const sine = (freq: number, amp: number, sec: number, rate: number) => Float32Array.from({ length: Math.round(sec * rate) }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / rate));

describe('BS.1770 integrated loudness', () => {
  it('matches the reference: a full-scale 997 Hz sine on one channel is -3.01 LUFS', () => {
    for (const rate of [44100, 48000]) expect(integratedLoudness([sine(997, 1, 5, rate)], rate)).toBeCloseTo(-3.01, 1);
  });
  it('is 6 dB lower at half amplitude and +3 dB with a second equal channel', () => {
    const a = sine(997, 0.5, 5, 48000);
    expect(integratedLoudness([a], 48000)).toBeCloseTo(-9.03, 1);
    expect(integratedLoudness([a, a], 48000)).toBeCloseTo(-6.02, 1);
  });
  it('gates out silence', () => {
    const s = sine(997, 0.5, 4, 48000);
    const withSilence = new Float32Array(s.length * 2);
    withSilence.set(s, 0);
    expect(integratedLoudness([withSilence], 48000)).toBeCloseTo(-9.03, 0);
    expect(integratedLoudness([new Float32Array(48000)], 48000)).toBe(-Infinity);
  });
});

describe('mastering', () => {
  it('limits peaks to the ceiling', () => {
    const c = sine(200, 1, 1, 48000);
    limitPeaks([c], 48000, 0.5);
    expect(samplePeak([c])).toBeLessThanOrEqual(0.5 + 1e-6);
  });
  it('reaches -16 LUFS with no sample above -1 dBFS, even for peaky material', () => {
    const rate = 48000;
    const quiet = sine(440, 0.05, 6, rate);
    for (let k = 0; k < 6; k++) for (let i = 0; i < 200; i++) quiet[k * rate + i] += 0.9 * Math.sin(i / 3); // sharp transients
    const ch = [quiet, Float32Array.from(quiet)];
    const r = masterToLoudness(ch, rate, -16, -1);
    expect(r.integratedLufs).toBeGreaterThan(-16.3);
    expect(r.integratedLufs).toBeLessThan(-15.7);
    expect(toDb(samplePeak(ch))).toBeLessThanOrEqual(-1 + 1e-6);
    expect(integratedLoudness(ch, rate)).toBeCloseTo(r.integratedLufs, 0);
  });
});
