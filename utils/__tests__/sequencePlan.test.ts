import { describe, it, expect } from 'vitest';
import { buildSequencePlan, buildPlayablePlan, MIN_CLIP_SEC, resolveGap, formatClock } from '../sequencePlan';

const clip = (s: number, e: number, gap?: number, audioUrl: string | null = 'a.wav') => ({
  startSec: s,
  endSec: e,
  gapAfterSec: gap,
  audioUrl: audioUrl === null ? undefined : audioUrl,
});

describe('buildSequencePlan', () => {
  it('total equals sum of effective durations plus sum of gaps; last gap is 0', () => {
    const plan = buildSequencePlan([clip(0, 10), clip(5, 12.5), clip(100, 104)], 0.35);
    const durs = [10, 7.5, 4];
    expect(plan.clipsSec).toBeCloseTo(durs.reduce((a, b) => a + b, 0), 9);
    expect(plan.gapsSec).toBeCloseTo(0.7, 9);
    expect(plan.totalSec).toBeCloseTo(plan.clipsSec + plan.gapsSec, 9);
    expect(plan.items[2].gapAfter).toBe(0);
  });

  it('per-clip gapAfterSec overrides the global gap', () => {
    const plan = buildSequencePlan([clip(0, 5, 0.8), clip(0, 5, 0.1), clip(0, 5)], 0.35);
    expect(plan.items[0].gapAfter).toBe(0.8);
    expect(plan.items[1].gapAfter).toBe(0.1);
    expect(plan.items[2].gapAfter).toBe(0);
  });

  it('timeline positions accumulate clip durations and gaps', () => {
    const plan = buildSequencePlan([clip(0, 4, 0.5), clip(10, 13, 0.25), clip(0, 2)], 0.35);
    expect(plan.items[0].timelineStart).toBe(0);
    expect(plan.items[0].timelineEnd).toBe(4);
    expect(plan.items[1].timelineStart).toBeCloseTo(4.5, 9);
    expect(plan.items[1].timelineEnd).toBeCloseTo(7.5, 9);
    expect(plan.items[2].timelineStart).toBeCloseTo(7.75, 9);
  });

  it('enforces the minimum clip duration', () => {
    const plan = buildSequencePlan([clip(3, 3.01), clip(5, 4)], 0.35);
    expect(plan.items[0].effDur).toBeCloseTo(MIN_CLIP_SEC, 9);
    expect(plan.items[1].effDur).toBeCloseTo(MIN_CLIP_SEC, 9);
  });

  it('clamps non-finite and negative gaps', () => {
    expect(resolveGap({ startSec: 0, endSec: 1, gapAfterSec: -2 }, 0.35)).toBe(0);
    expect(resolveGap({ startSec: 0, endSec: 1, gapAfterSec: NaN }, 0.35)).toBe(0);
    expect(resolveGap({ startSec: 0, endSec: 1 }, 0.35)).toBe(0.35);
  });
});

describe('buildPlayablePlan', () => {
  it('drops clips without audio before computing gaps and remembers source indices', () => {
    const { plan, sourceIndex } = buildPlayablePlan([clip(0, 5), clip(0, 5, 0.9, null), clip(0, 5)], 0.35);
    expect(plan.items).toHaveLength(2);
    expect(sourceIndex).toEqual([0, 2]);
    expect(plan.items[0].gapAfter).toBe(0.35);
    expect(plan.items[1].timelineStart).toBeCloseTo(5.35, 9);
  });
});

describe('formatClock', () => {
  it('formats m:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(68.4)).toBe('1:08');
    expect(formatClock(125)).toBe('2:05');
  });
});
