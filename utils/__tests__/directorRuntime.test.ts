import { describe, it, expect, vi } from 'vitest';
import { generateCuts, refineTimeline } from '../directorRuntime';
import type { RuntimeDeps } from '../directorRuntime';
import type { ClipLike, DirectorRequest, DirectorResult } from '../directorTypes';

const QUOTE = 'Alpha beta gamma delta epsilon zeta eta theta iota kappa.';
const mk = (id: string, extra: Partial<ClipLike> = {}): ClipLike => ({
  id,
  quote: QUOTE,
  speaker: 'Speaker',
  sourceTitle: 'Ep',
  audioUrl: `clips/${id}.wav`,
  startSec: 0,
  endSec: 30,
  status: 'EXISTS',
  category: 'Context',
  ...extra,
});
const pool = [mk('a'), mk('b'), mk('c')];
const opts = { isBlacklisted: () => false, hardExcludePhrase: 'never-matches-xyz', defaultGapSec: 0.35, targetSec: 90 };

const gen = (picks: any[], cutId: string): DirectorResult => ({
  ok: true,
  mode: 'generate',
  cut: { cutId: cutId as any, title: 'T', tagline: 'tag', picks },
  warnings: [],
  usage: { promptTokens: 1, completionTokens: 1 },
  model: 'claude-sonnet-5.5',
  ms: 5,
});
const pick = (clipId: string, extra: any = {}) => ({ clipId, keptText: null, gapAfterSec: 0.5, tensionScore: 4, note: 'n', ...extra });

const deps = (call: RuntimeDeps['call']): RuntimeDeps => ({ call, probe: async () => 30, trim: {} });

describe('generateCuts', () => {
  it('returns three outcomes with provenance, gaps, notes and real runtime', async () => {
    const call = vi.fn(async (req: DirectorRequest) => gen([pick('a'), pick('b', { gapAfterSec: 1 })], req.cutId));
    const r = await generateCuts({ pool, userPrompt: 'x', ...opts }, deps(call));
    expect(r.ok).toBe(true);
    if (r.ok !== true) return;
    expect(call).toHaveBeenCalledTimes(3);
    const a = r.outcomes.cut_a;
    expect(a.ok).toBe(true);
    if (a.ok !== true) return;
    expect(a.clips.map(c => c.id)).toEqual(['a', 'b']);
    expect(a.clips[0].gapAfterSec).toBe(0.5);
    expect(a.clips[0].director?.cutId).toBe('cut_a');
    expect(a.clips[0].directorNote).toBe('n');
    // 30 + 0.5 + 30 (last gap does not count)
    expect(a.runtimeSec).toBeCloseTo(60.5, 2);
  });

  it('applies a trim and remembers the original window', async () => {
    const kept = 'beta gamma delta epsilon zeta eta theta iota kappa.';
    const call = async (req: DirectorRequest) => gen([pick('a', { keptText: kept })], req.cutId);
    const r = await generateCuts({ pool, userPrompt: 'x', ...opts }, deps(call));
    if (r.ok !== true) throw new Error('expected ok');
    const o = r.outcomes.cut_b;
    if (o.ok !== true) throw new Error('expected ok');
    const c = o.clips[0];
    expect(c.startSec).toBeGreaterThan(0);
    expect(c.endSec).toBe(30);
    expect(c.origStartSec).toBe(0);
    expect(c.origEndSec).toBe(30);
    expect(c.trimBasis).toBe('estimated');
  });

  it('keeps a clip whole and notes why when the excerpt is not contiguous', async () => {
    const call = async (req: DirectorRequest) => gen([pick('a', { keptText: 'something never said' })], req.cutId);
    const r = await generateCuts({ pool, userPrompt: 'x', ...opts }, deps(call));
    if (r.ok !== true) throw new Error('expected ok');
    const o = r.outcomes.cut_a;
    if (o.ok !== true) throw new Error('expected ok');
    expect(o.clips[0].startSec).toBe(0);
    expect(o.warnings.join(' ')).toMatch(/whole/);
  });

  it('isolates a failing cut from the others', async () => {
    const call = async (req: DirectorRequest): Promise<DirectorResult> =>
      req.cutId === 'cut_b' ? { ok: false, code: 'TIMEOUT', message: 'slow' } : gen([pick('a')], req.cutId);
    const r = await generateCuts({ pool, userPrompt: 'x', ...opts }, deps(call));
    if (r.ok !== true) throw new Error('expected ok');
    expect(r.outcomes.cut_a.ok).toBe(true);
    expect(r.outcomes.cut_b.ok).toBe(false);
    expect(r.outcomes.cut_c.ok).toBe(true);
  });

  it('never calls the model when nothing is eligible', async () => {
    const call = vi.fn();
    const r = await generateCuts({ pool: [mk('a', { isExcluded: true })], userPrompt: 'x', ...opts }, deps(call as any));
    expect(r.ok).toBe(false);
    expect(call).not.toHaveBeenCalled();
  });

  it('never sends clips with an unknown real duration', async () => {
    const call = vi.fn();
    const d: RuntimeDeps = { call: call as any, probe: async () => null, trim: {} };
    const r = await generateCuts({ pool, userPrompt: 'x', ...opts }, d);
    expect(r.ok).toBe(false);
    expect(call).not.toHaveBeenCalled();
  });
});

describe('refineTimeline', () => {
  const timeline = [mk('a', { windowVerified: true, locked: true }), mk('b', { windowVerified: true })];
  const refineOk = (ops: any[]): DirectorResult => ({
    ok: true,
    mode: 'refine',
    refine: { ops, summary: 'done' },
    warnings: [],
    usage: { promptTokens: 1, completionTokens: 1 },
    model: 'claude-sonnet-5.5',
    ms: 1,
  });

  it('applies ops, protects locked clips and reports what was rejected', async () => {
    const call = async () => refineOk([{ op: 'drop', clipId: 'a' }, { op: 'setGap', clipId: 'b', gapAfterSec: 0.9 }]);
    const r = await refineTimeline(
      { cutId: 'cut_a', clips: timeline, pool, userPrompt: 'x', instruction: 'drop first', ...opts },
      deps(call)
    );
    if (r.ok !== true) throw new Error('expected ok');
    expect(r.clips.map(c => c.id)).toEqual(['a', 'b']);
    expect(r.clips[1].gapAfterSec).toBe(0.9);
    expect(r.rejected.join(' ')).toMatch(/locked/);
  });

  it('inserts a candidate that is not yet on the timeline', async () => {
    const call = async () => refineOk([{ op: 'insert', clipId: 'c', atIndex: 1 }]);
    const r = await refineTimeline(
      { cutId: 'cut_a', clips: timeline, pool, userPrompt: 'x', instruction: 'add c', ...opts },
      deps(call)
    );
    if (r.ok !== true) throw new Error('expected ok');
    expect(r.clips.map(c => c.id)).toEqual(['a', 'c', 'b']);
  });

  it('passes through upstream failures', async () => {
    const call = async (): Promise<DirectorResult> => ({ ok: false, code: 'RATE_LIMIT', message: 'slow down' });
    const r = await refineTimeline(
      { cutId: 'cut_a', clips: timeline, pool, userPrompt: 'x', instruction: 'x', ...opts },
      deps(call)
    );
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.code).toBe('RATE_LIMIT');
  });
});
