import { describe, it, expect } from 'vitest';
import { parseWavHeaderDuration, reconcileWindow, mapLimit } from '../clipProbe';
import type { ClipLike } from '../directorTypes';

function wavHeader(opts: { byteRate: number; dataSize: number; extraChunk?: boolean }) {
  const parts: number[] = [];
  const u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  const u16 = (n: number) => [n & 255, (n >> 8) & 255];
  const str = (s: string) => Array.from(s).map(c => c.charCodeAt(0));
  parts.push(...str('RIFF'), ...u32(36 + opts.dataSize), ...str('WAVE'));
  if (opts.extraChunk) parts.push(...str('LIST'), ...u32(4), ...str('INFO'));
  parts.push(...str('fmt '), ...u32(16), ...u16(1), ...u16(2), ...u32(44100), ...u32(opts.byteRate), ...u16(4), ...u16(16));
  parts.push(...str('data'), ...u32(opts.dataSize));
  return new Uint8Array(parts);
}

const base = (over: Partial<ClipLike> = {}): ClipLike => ({
  id: 'c1',
  quote: 'q',
  speaker: 's',
  startSec: 0,
  endSec: 30,
  ...over,
});

describe('parseWavHeaderDuration', () => {
  it('reads duration from header data size', () => {
    const h = wavHeader({ byteRate: 176400, dataSize: 176400 * 12 });
    expect(parseWavHeaderDuration(h)).toBeCloseTo(12, 6);
  });
  it('skips extra chunks', () => {
    const h = wavHeader({ byteRate: 176400, dataSize: 176400 * 5, extraChunk: true });
    expect(parseWavHeaderDuration(h)).toBeCloseTo(5, 6);
  });
  it('derives size from the file length when the data size is a streaming placeholder', () => {
    const h = wavHeader({ byteRate: 176400, dataSize: 0xffffffff });
    expect(parseWavHeaderDuration(h, 44 + 176400 * 3)).toBeCloseTo(3, 6);
  });
  it('returns null for non-WAV or short input', () => {
    expect(parseWavHeaderDuration(new Uint8Array(10))).toBeNull();
    expect(parseWavHeaderDuration(new Uint8Array(64))).toBeNull();
  });
});

describe('reconcileWindow', () => {
  it('turns a placeholder (manifest 0..30) window into the whole real file', () => {
    const r = reconcileWindow(base({ windowPlaceholder: true }), 41.237);
    expect(r.startSec).toBe(0);
    expect(r.endSec).toBe(41.24);
    expect(r.windowVerified).toBe(true);
    expect(r.windowPlaceholder).toBe(false);
    expect(r.origEndSec).toBe(41.24);
  });

  it('converts an episode-relative window on a pre-cut file to a file-relative one and keeps episode times', () => {
    const r = reconcileWindow(base({ startSec: 5625.6, endSec: 5694.2 }), 68.6);
    expect(r.startSec).toBe(0);
    expect(r.endSec).toBe(68.6);
    expect(r.episodeStartSec).toBe(5625.6);
    expect(r.episodeEndSec).toBe(5694.2);
    expect(r.windowVerified).toBe(true);
  });

  it('uses the whole file when the episode span is longer than the file', () => {
    const r = reconcileWindow(base({ startSec: 2000, endSec: 2060 }), 55); // span 60 > D
    expect(r.endSec).toBe(55);
  });

  it('keeps the catalog span when the file is clearly longer than the span', () => {
    const r = reconcileWindow(base({ startSec: 2000, endSec: 2030 }), 55); // span 30, D 55
    expect(r.startSec).toBe(0);
    expect(r.endSec).toBe(30);
  });

  it('leaves a window that is already inside the file untouched (full-episode file case)', () => {
    const r = reconcileWindow(base({ startSec: 2255.2, endSec: 2341.6 }), 7200);
    expect(r.startSec).toBe(2255.2);
    expect(r.endSec).toBe(2341.6);
    expect(r.episodeStartSec).toBeUndefined();
    expect(r.windowVerified).toBe(true);
    expect(r.origStartSec).toBe(2255.2);
  });

  it('is idempotent once verified and ignores bad durations', () => {
    const once = reconcileWindow(base({ startSec: 5625.6, endSec: 5694.2 }), 68.6);
    const twice = reconcileWindow(once, 9999);
    expect(twice.startSec).toBe(0);
    expect(twice.endSec).toBe(68.6);
    const c = base();
    expect(reconcileWindow(c, NaN)).toBe(c);
    expect(reconcileWindow(c, 0)).toBe(c);
  });
});

describe('mapLimit', () => {
  it('never exceeds the concurrency limit and keeps order', async () => {
    let active = 0;
    let max = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async n => {
      active++;
      max = Math.max(max, active);
      await new Promise(r => setTimeout(r, 5));
      active--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(max).toBeLessThanOrEqual(3);
  });
});
