import { describe, it, expect } from 'vitest';
import { resolveTrim, snapToSilence, snapToBoundary } from '../trimResolver';
import { findExcerpt } from '../directorValidate';
import type { ClipLike } from '../directorTypes';

const SR = 8000;
/** Speech-like tone with an optional silent stretch [silFrom, silTo] seconds. */
function audio(seconds: number, silences: Array<[number, number]> = []) {
  const n = Math.floor(seconds * SR);
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const inSil = silences.some(([a, b]) => t >= a && t <= b);
    d[i] = inSil ? 0 : 0.3 * Math.sin(2 * Math.PI * 220 * t) * (0.7 + 0.3 * Math.sin(2 * Math.PI * 3 * t));
  }
  return d;
}

const QUOTE = 'well you know this is the real statement that matters to everyone here';
const clip = (over: Partial<ClipLike> = {}): ClipLike => ({
  id: 'c',
  quote: QUOTE,
  speaker: 'Angela',
  audioUrl: 'x.wav',
  startSec: 0,
  endSec: 20,
  origStartSec: 0,
  origEndSec: 20,
  ...over,
});

describe('snapToSilence', () => {
  it('snaps to the centre of a real silence near the target', () => {
    const d = audio(10, [[4.9, 5.1]]);
    const t = snapToSilence(d, SR, 4.8);
    expect(t).not.toBeNull();
    expect(Math.abs((t as number) - 5.0)).toBeLessThan(0.06);
  });
  it('returns null when there is no silence within the radius', () => {
    expect(snapToSilence(audio(10), SR, 5)).toBeNull();
    expect(snapToSilence(audio(10, [[8, 8.5]]), SR, 3)).toBeNull();
  });
  it('returns null for digital silence / too-short audio', () => {
    expect(snapToSilence(new Float32Array(SR * 5), SR, 2)).toBeNull();
    expect(snapToSilence(new Float32Array(10), SR, 0.001)).toBeNull();
  });
});

describe('snapToBoundary', () => {
  it('snaps within the radius only', () => {
    expect(snapToBoundary([1, 2.5, 4], 2.3)).toBe(2.5);
    expect(snapToBoundary([1, 4], 2.5)).toBeNull();
  });
});

describe('resolveTrim', () => {
  const kept = 'this is the real statement that matters to everyone here';

  it('estimates proportionally when no audio is available', async () => {
    const r = await resolveTrim(clip(), kept);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const ex = findExcerpt(QUOTE, kept)!;
      expect(r.basis).toBe('estimated');
      expect(r.startSec).toBeCloseTo(20 * (ex.start / ex.length), 1);
      expect(r.endSec).toBe(20);
    }
  });

  it('snaps to real silence and reports the basis', async () => {
    const ex = findExcerpt(QUOTE, kept)!;
    const est = 20 * (ex.start / ex.length);
    const data = audio(20, [[est + 0.1, est + 0.3]]);
    const r = await resolveTrim(clip(), kept, { getChannel: async () => ({ data, sampleRate: SR }) });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.basis).toBe('silence');
      expect(Math.abs(r.startSec - (est + 0.2))).toBeLessThan(0.08);
    }
  });

  it('prefers segment boundaries when provided', async () => {
    const ex = findExcerpt(QUOTE, kept)!;
    const est = 20 * (ex.start / ex.length);
    const r = await resolveTrim(clip(), kept, { getSegmentBoundaries: async () => [est + 0.25] });
    expect(r.ok && r.basis).toBe('segment');
    expect(r.ok && r.startSec).toBeCloseTo(est + 0.25, 2);
  });

  it('is a no-op when the excerpt keeps everything', async () => {
    const r = await resolveTrim(clip(), QUOTE);
    expect(r.ok && r.noop).toBe(true);
  });

  it('rejects text that is not a contiguous excerpt', async () => {
    const r = await resolveTrim(clip(), 'something else entirely');
    expect(r.ok).toBe(false);
  });

  it('rejects trims that leave under 1.5 s', async () => {
    const r = await resolveTrim(clip({ endSec: 1.8, origEndSec: 1.8 }), kept);
    expect(r.ok).toBe(false);
  });

  it('rejects automatic trims that remove more than 35%', async () => {
    const r = await resolveTrim(clip(), 'to everyone here');
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.reason).toContain('35');
  });

  it('never extends beyond the original window', async () => {
    const data = audio(20, [[0.05, 0.4]]);
    const r = await resolveTrim(clip({ startSec: 2, origStartSec: 2, endSec: 18, origEndSec: 18 }), kept, {
      getChannel: async () => ({ data, sampleRate: SR }),
    });
    if (r.ok) {
      expect(r.startSec).toBeGreaterThanOrEqual(2);
      expect(r.endSec).toBeLessThanOrEqual(18);
    }
  });
});
