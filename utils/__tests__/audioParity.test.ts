import { describe, it, expect } from 'vitest';
import { stitchAudioBuffers } from '../wavEncoder';
import { buildPlayablePlan, buildSequencePlan } from '../sequencePlan';
import { createSequencePlayer } from '../sequencePlayer';

const SR = 8000;

/** Minimal AudioBuffer/AudioContext fakes: enough for stitching and scheduling maths. */
function fakeBuffer(frames: number, channels = 1, fill = 0.5) {
  const data = Array.from({ length: channels }, () => new Float32Array(frames).fill(fill));
  return {
    length: frames,
    numberOfChannels: channels,
    sampleRate: SR,
    duration: frames / SR,
    getChannelData: (c: number) => data[c],
  } as unknown as AudioBuffer;
}
function fakeCtx() {
  return {
    sampleRate: SR,
    createBuffer: (channels: number, length: number, sampleRate: number) => ({
      length,
      numberOfChannels: channels,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: ((arrs: Float32Array[]) => (c: number) => arrs[c])(Array.from({ length: channels }, () => new Float32Array(length))),
    }),
  } as unknown as AudioContext;
}

describe('stitchAudioBuffers with per-join gaps', () => {
  const bufs = [fakeBuffer(SR * 2), fakeBuffer(SR * 3), fakeBuffer(Math.round(SR * 1.5))];
  const opts = { normalizePeak: false, antiClickFades: false };

  it('output length equals sum(clip frames) + sum(floor(gap*sr)) for mixed gaps', () => {
    const out = stitchAudioBuffers(fakeCtx(), bufs, { ...opts, gapsSec: [0.1, 0.8] });
    expect(out.length).toBe(SR * 2 + SR * 3 + SR * 1.5 + Math.floor(0.1 * SR) + Math.floor(0.8 * SR));
  });

  it('falls back to gapSec for joins not covered by gapsSec', () => {
    const out = stitchAudioBuffers(fakeCtx(), bufs, { ...opts, gapSec: 0.35, gapsSec: [0.1] });
    expect(out.length).toBe(SR * 6.5 + Math.floor(0.1 * SR) + Math.floor(0.35 * SR));
  });

  it('is unchanged when no gapsSec is given (backwards compatible)', () => {
    const out = stitchAudioBuffers(fakeCtx(), bufs, { ...opts, gapSec: 0.5 });
    expect(out.length).toBe(SR * 6.5 + 2 * Math.floor(0.5 * SR));
  });

  it('stays within 1 frame per join of the sequence plan total, and label times match the plan', () => {
    const clips = [
      { startSec: 0, endSec: 2, gapAfterSec: 0.1, audioUrl: 'a' },
      { startSec: 0, endSec: 3, gapAfterSec: 0.8, audioUrl: 'b' },
      { startSec: 0, endSec: 1.5, audioUrl: 'c' },
    ];
    const { plan } = buildPlayablePlan(clips, 0.35);
    const out = stitchAudioBuffers(fakeCtx(), bufs, { ...opts, gapsSec: plan.items.slice(0, -1).map(i => i.gapAfter) });
    expect(Math.abs(out.length - plan.totalSec * SR)).toBeLessThanOrEqual(2);
    // label for clip 2 starts exactly where the stitched audio places it
    expect(plan.items[1].timelineStart).toBeCloseTo((SR * 2 + Math.floor(0.1 * SR)) / SR, 2);
    expect(plan.items[2].timelineStart).toBeCloseTo((SR * 2 + Math.floor(0.1 * SR) + SR * 3 + Math.floor(0.8 * SR)) / SR, 2);
  });

  it('anti-click fades and normalisation do not change the length', () => {
    const out = stitchAudioBuffers(fakeCtx(), bufs, { gapsSec: [0.2, 0.2], antiClickFades: true, normalizePeak: true });
    expect(out.length).toBe(SR * 6.5 + 2 * Math.floor(0.2 * SR));
  });
});

describe('sequence player scheduling', () => {
  function schedCtx() {
    const started: Array<{ when: number; offset: number; dur: number; url?: string }> = [];
    const ramps: Array<{ type: string; v: number; t: number }> = [];
    const ctx: any = {
      state: 'running',
      currentTime: 10,
      destination: {},
      resume: async () => {},
      createGain: () => ({
        gain: {
          setValueAtTime: (v: number, t: number) => ramps.push({ type: 'set', v, t }),
          linearRampToValueAtTime: (v: number, t: number) => ramps.push({ type: 'ramp', v, t }),
        },
        connect: () => {},
      }),
      createBufferSource: () => {
        const s: any = {
          buffer: null,
          connect: () => {},
          disconnect: () => {},
          stop: () => {},
          start: (when: number, offset: number, dur: number) => started.push({ when, offset, dur }),
        };
        return s;
      },
    };
    return { ctx: ctx as AudioContext, started, ramps };
  }

  it('schedules each clip at timeline start + offset/duration from the plan, with gaps between', async () => {
    const { ctx, started, ramps } = schedCtx();
    const clips = [
      { startSec: 1.5, endSec: 5.5, gapAfterSec: 0.8, audioUrl: 'a' },
      { startSec: 0, endSec: 3, gapAfterSec: 0.1, audioUrl: 'b' },
      { startSec: 2, endSec: 4, audioUrl: 'c' },
    ];
    const plan = buildSequencePlan(clips, 0.35);
    const indices: number[] = [];
    const player = createSequencePlayer({
      plan,
      fadeMs: 18,
      ctx,
      decode: async () => fakeBuffer(SR * 10),
      callbacks: { onIndex: i => indices.push(i), onEnd: () => {}, onStatus: () => {}, onError: () => {} },
    });
    await player.start(0);
    player.stop();

    const t0 = 10 + 0.08;
    expect(started).toHaveLength(3);
    expect(started[0]).toMatchObject({ offset: 1.5, dur: 4 });
    expect(started[0].when).toBeCloseTo(t0, 6);
    expect(started[1].when).toBeCloseTo(t0 + 4 + 0.8, 6);
    expect(started[1]).toMatchObject({ offset: 0, dur: 3 });
    expect(started[2].when).toBeCloseTo(t0 + 4 + 0.8 + 3 + 0.1, 6);
    // 18 ms fade in at clip start and fade out ending at clip end
    expect(ramps.some(r => r.type === 'ramp' && r.v === 1 && Math.abs(r.t - (t0 + 0.018)) < 1e-9)).toBe(true);
    expect(ramps.some(r => r.type === 'ramp' && r.v === 0 && Math.abs(r.t - (t0 + 4)) < 1e-9)).toBe(true);
  });

  it('starts from a given plan index and skips clips that cannot be decoded without breaking timing', async () => {
    const { ctx, started } = schedCtx();
    const plan = buildSequencePlan(
      [
        { startSec: 0, endSec: 2, audioUrl: 'a' },
        { startSec: 0, endSec: 2, audioUrl: 'bad' },
        { startSec: 0, endSec: 2, audioUrl: 'c' },
      ],
      0.5
    );
    const errors: string[] = [];
    const player = createSequencePlayer({
      plan,
      fadeMs: 0,
      ctx,
      decode: async url => (url === 'bad' ? null : fakeBuffer(SR * 5)),
      callbacks: { onIndex: () => {}, onEnd: () => {}, onStatus: () => {}, onError: m => errors.push(m) },
    });
    await player.start(1);
    player.stop();
    expect(errors).toHaveLength(1);
    expect(started).toHaveLength(1); // only clip 'c' plays
  });

  it('a stop during decoding prevents scheduling', async () => {
    const { ctx, started } = schedCtx();
    const plan = buildSequencePlan([{ startSec: 0, endSec: 2, audioUrl: 'a' }], 0.35);
    let release: () => void = () => {};
    const gate = new Promise<void>(r => (release = r));
    const player = createSequencePlayer({
      plan,
      fadeMs: 0,
      ctx,
      decode: async () => {
        await gate;
        return fakeBuffer(SR * 5);
      },
      callbacks: { onIndex: () => {}, onEnd: () => {}, onStatus: () => {}, onError: () => {} },
    });
    const p = player.start(0);
    player.stop();
    release();
    await p;
    expect(started).toHaveLength(0);
  });
});
