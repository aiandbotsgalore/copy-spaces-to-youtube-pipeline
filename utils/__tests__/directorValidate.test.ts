import { describe, it, expect } from 'vitest';
import {
  normalizeText,
  findExcerpt,
  parseJsonLoose,
  validateGenerate,
  validateRefine,
  estimateRuntime,
  runtimeCheck,
  enforceRuntimeDrop,
  applyOps,
} from '../directorValidate';
import type { ClipLike, DirectorCandidate, DirectorCurrentItem, DirectorPick } from '../directorTypes';

const cand = (id: string, over: Partial<DirectorCandidate> = {}): DirectorCandidate => ({
  id,
  speaker: 'Angela',
  sourceTitle: 'Space',
  status: 'EXISTS',
  durationSec: 20,
  text: 'well you know this is the real statement that matters to everyone here',
  textTruncated: false,
  ...over,
});
const byId = (...cs: DirectorCandidate[]) => Object.fromEntries(cs.map(c => [c.id, c]));
const pick = (clipId: string, over: Partial<DirectorPick> = {}): DirectorPick => ({
  clipId,
  gapAfterSec: 0.35,
  tensionScore: 5,
  note: 'Speaker states a position.',
  ...over,
});

describe('text helpers', () => {
  it('normalises punctuation, case and apostrophes', () => {
    expect(normalizeText("She didn't — really!")).toBe('she didnt really');
  });
  it('finds contiguous excerpts only', () => {
    expect(findExcerpt('a b c d e', 'b c d')).not.toBeNull();
    expect(findExcerpt('a b c d e', 'b d')).toBeNull();
    expect(findExcerpt('a b c', '')).toBeNull();
  });
  it('parses JSON out of fences and surrounding prose', () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoose('Sure! Here you go: {"a":{"b":"}"}} thanks')).toEqual({ a: { b: '}' } });
    expect(parseJsonLoose('no json here')).toBeNull();
  });
});

describe('validateGenerate', () => {
  const ctx = { cutId: 'cut_a' as const, candidatesById: byId(cand('a'), cand('b', { speaker: 'Logan' }), cand('c')) };

  it('accepts a well-formed cut, clamps numbers, zeroes the last gap', () => {
    const r = validateGenerate(
      {
        cutId: 'cut_a',
        title: 'Chronological Record',
        tagline: 'Statements in date order.',
        picks: [
          { clipId: 'a', keptText: null, gapAfterSec: 9, tensionScore: 14, note: 'x' },
          { clipId: 'b', keptText: null, gapAfterSec: -1, tensionScore: 0, note: 'y' },
        ],
      },
      ctx
    );
    expect(r.errors).toEqual([]);
    const picks = r.value!.picks;
    expect(picks[0].gapAfterSec).toBe(1.5);
    expect(picks[0].tensionScore).toBe(10);
    expect(picks[1].tensionScore).toBe(1);
    expect(picks[1].gapAfterSec).toBe(0);
  });

  it('rejects unknown ids (this is also the exclusion filter) and duplicates', () => {
    const r = validateGenerate({ title: 't', tagline: '', picks: [{ clipId: 'AQ-0269' }, { clipId: 'a' }, { clipId: 'a' }] }, ctx);
    expect(r.errors.some(e => e.includes('unknown clipId "AQ-0269"'))).toBe(true);
    expect(r.errors.some(e => e.includes('more than once'))).toBe(true);
    expect(r.value).toBeUndefined();
  });

  it('rejects keptText that is not a contiguous excerpt, accepts one that is', () => {
    const bad = validateGenerate({ title: 't', picks: [{ clipId: 'a', keptText: 'this is NOT in the clip', gapAfterSec: 0.3, tensionScore: 5, note: '' }] }, ctx);
    expect(bad.errors.join(' ')).toContain('contiguous excerpt');
    const good = validateGenerate(
      { title: 't', picks: [{ clipId: 'a', keptText: 'this is the real statement that matters to everyone here', gapAfterSec: 0.3, tensionScore: 5, note: '' }] },
      ctx
    );
    expect(good.errors).toEqual([]);
    expect(good.value!.picks[0].keptText).toBeTruthy();
  });

  it('treats a keptText that keeps everything as no trim', () => {
    const r = validateGenerate({ title: 't', picks: [{ clipId: 'a', keptText: cand('a').text, gapAfterSec: 0.3, tensionScore: 5, note: '' }] }, ctx);
    expect(r.value!.picks[0].keptText).toBeUndefined();
  });

  it('ignores trims on truncated candidates with a warning', () => {
    const c2 = { cutId: 'cut_a' as const, candidatesById: byId(cand('a', { textTruncated: true })) };
    const r = validateGenerate({ title: 't', picks: [{ clipId: 'a', keptText: 'this is the real statement', gapAfterSec: 0.3, tensionScore: 5, note: '' }] }, c2);
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(' ')).toContain('truncated');
    expect(r.value!.picks[0].keptText).toBeUndefined();
  });

  it('flags loaded language in title, tagline and notes', () => {
    const r = validateGenerate(
      { title: 'The Scorched Earth Cut', tagline: 'A shocking exposé', picks: [{ clipId: 'a', gapAfterSec: 0.3, tensionScore: 5, note: 'She is a liar' }] },
      ctx
    );
    expect(r.errors.filter(e => e.includes('loaded language')).length).toBe(3);
  });

  it('warns about three consecutive clips from one speaker when several speakers exist', () => {
    const c3 = { cutId: 'cut_a' as const, candidatesById: byId(cand('a'), cand('c'), cand('d'), cand('b', { speaker: 'Logan' })) };
    const r = validateGenerate(
      { title: 't', picks: ['a', 'c', 'd', 'b'].map(id => ({ clipId: id, gapAfterSec: 0.3, tensionScore: 5, note: '' })) },
      c3
    );
    expect(r.errors).toEqual([]);
    expect(r.warnings.some(w => w.includes('consecutive'))).toBe(true);
  });

  it('rejects empty picks and non-objects', () => {
    expect(validateGenerate({ title: 't', picks: [] }, ctx).errors.length).toBeGreaterThan(0);
    expect(validateGenerate('nope', ctx).errors.length).toBeGreaterThan(0);
  });
});

describe('runtime enforcement', () => {
  const cands = byId(cand('a', { durationSec: 30 }), cand('b', { durationSec: 30 }), cand('c', { durationSec: 30 }), cand('d', { durationSec: 30 }));

  it('estimates runtime as clip durations plus gaps (trims shorten proportionally)', () => {
    const picks = [pick('a', { gapAfterSec: 0.5 }), pick('b', { gapAfterSec: 0 })];
    expect(estimateRuntime(picks, cands)).toBeCloseTo(60.5, 6);
    const trimmed = [pick('a', { gapAfterSec: 0, keptText: 'this is the real statement that matters to everyone here' })];
    expect(estimateRuntime(trimmed, cands)).toBeLessThan(30);
  });

  it('checks the +/-10% window', () => {
    expect(runtimeCheck(99, 90).ok).toBe(true);
    expect(runtimeCheck(100, 90).over).toBe(true);
    expect(runtimeCheck(80, 90).under).toBe(true);
  });

  it('drops the lowest-tension non-edge pick until within +10%, never touching first or last', () => {
    const picks = [
      pick('a', { tensionScore: 9 }),
      pick('b', { tensionScore: 2 }),
      pick('c', { tensionScore: 6 }),
      pick('d', { tensionScore: 8, gapAfterSec: 0 }),
    ];
    const { picks: out, dropped } = enforceRuntimeDrop(picks, cands, 90);
    expect(dropped).toEqual(['b']);
    expect(out.map(p => p.clipId)).toEqual(['a', 'c', 'd']);
    expect(out[0].clipId).toBe('a');
    expect(out[out.length - 1].gapAfterSec).toBe(0);
    expect(estimateRuntime(out, cands)).toBeLessThanOrEqual(99);
  });

  it('keeps at least two picks', () => {
    const picks = [pick('a'), pick('b'), pick('c')];
    const { picks: out } = enforceRuntimeDrop(picks, cands, 10);
    expect(out.length).toBe(2);
  });
});

describe('validateRefine', () => {
  const current: DirectorCurrentItem[] = [
    { index: 0, clipId: 'a', text: cand('a').text, startSec: 0, endSec: 20, durationSec: 20, gapAfterSec: 0.35, locked: false },
    { index: 1, clipId: 'b', text: cand('b').text, startSec: 0, endSec: 20, durationSec: 20, gapAfterSec: 0.35, locked: true },
    { index: 2, clipId: 'c', text: cand('c').text, startSec: 0, endSec: 20, durationSec: 20, gapAfterSec: 0, locked: false },
  ];
  const ctx = { current, candidatesById: byId(cand('a'), cand('b'), cand('c'), cand('n')) };
  const op = (o: any) => ({ toIndex: null, keptText: null, gapAfterSec: null, atIndex: null, withClipId: null, note: null, ...o });

  it('accepts valid ops and coerces flat nullable fields', () => {
    const r = validateRefine({ summary: 'Dropped one clip and lengthened a pause.', ops: [op({ op: 'drop', clipId: 'c' }), op({ op: 'setGap', clipId: 'a', gapAfterSec: 0.8 })] }, ctx);
    expect(r.errors).toEqual([]);
    expect(r.value!.ops).toEqual([{ op: 'drop', clipId: 'c' }, { op: 'setGap', clipId: 'a', gapAfterSec: 0.8 }]);
  });

  it('rejects locked and unknown targets', () => {
    const r = validateRefine({ summary: 's', ops: [op({ op: 'drop', clipId: 'b' }), op({ op: 'drop', clipId: 'zzz' })] }, ctx);
    expect(r.errors.some(e => e.includes('locked'))).toBe(true);
    expect(r.errors.some(e => e.includes('not in the current timeline'))).toBe(true);
  });

  it('validates insert/replace against candidates and current membership', () => {
    const ok = validateRefine({ summary: 's', ops: [op({ op: 'insert', clipId: 'n', atIndex: 1 }), op({ op: 'replace', clipId: 'c', withClipId: 'n' })] }, ctx);
    expect(ok.errors).toEqual([]);
    const bad = validateRefine({ summary: 's', ops: [op({ op: 'insert', clipId: 'a', atIndex: 0 }), op({ op: 'replace', clipId: 'c', withClipId: 'ghost' })] }, ctx);
    expect(bad.errors.length).toBe(2);
  });

  it('requires trims to be real excerpts and caps the number of ops', () => {
    const bad = validateRefine({ summary: 's', ops: [op({ op: 'trim', clipId: 'a', keptText: 'not in clip' })] }, ctx);
    expect(bad.errors.join(' ')).toContain('contiguous excerpt');
    const many = Array.from({ length: 20 }, () => op({ op: 'setGap', clipId: 'a', gapAfterSec: 0.4 }));
    const r = validateRefine({ summary: 's', ops: many }, ctx);
    expect(r.value!.ops).toHaveLength(12);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('applyOps', () => {
  const clip = (id: string, over: Partial<ClipLike> = {}): ClipLike => ({
    id,
    quote: `quote ${id}`,
    speaker: 'Angela',
    startSec: 0,
    endSec: 10,
    quoteId: `Q-${id}`,
    ...over,
  });
  const pool = { n: clip('n'), m: clip('m') };

  it('applies ops immutably and produces an accurate changelog', () => {
    const original = [clip('a'), clip('b'), clip('c')];
    const snapshot = JSON.stringify(original);
    const res = applyOps(
      original,
      [
        { op: 'drop', clipId: 'b' },
        { op: 'setGap', clipId: 'a', gapAfterSec: 0.8 },
        { op: 'insert', clipId: 'n', atIndex: 1, note: 'Inserted note' },
      ],
      { byId: pool }
    );
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(res.clips.map(c => c.id)).toEqual(['a', 'n', 'c']);
    expect(res.clips[0].gapAfterSec).toBe(0.8);
    expect(res.clips[1].directorNote).toBe('Inserted note');
    expect(res.changelog).toEqual(['Dropped #2 (Q-b)', 'Gap after #1 set to 0.80s', 'Inserted Q-n at #2']);
  });

  it('never changes locked clips', () => {
    const res = applyOps(
      [clip('a', { locked: true }), clip('b')],
      [
        { op: 'drop', clipId: 'a' },
        { op: 'setGap', clipId: 'a', gapAfterSec: 1 },
        { op: 'move', clipId: 'a', toIndex: 1 },
        { op: 'replace', clipId: 'a', withClipId: 'n' },
        { op: 'setNote', clipId: 'a', note: 'x' },
        { op: 'trim', clipId: 'a', keptText: 'quote' },
      ],
      { byId: pool }
    );
    expect(res.clips.map(c => c.id)).toEqual(['a', 'b']);
    expect(res.clips[0].gapAfterSec).toBeUndefined();
    expect(res.clips[0].directorNote).toBeUndefined();
    expect(res.rejected).toHaveLength(6);
    expect(res.pendingTrims).toHaveLength(0);
  });

  it('moves, replaces (inheriting gap and tension) and queues trims', () => {
    const res = applyOps(
      [clip('a', { gapAfterSec: 0.6, tensionScore: 7 }), clip('b'), clip('c')],
      [
        { op: 'move', clipId: 'c', toIndex: 0 },
        { op: 'replace', clipId: 'a', withClipId: 'm' },
        { op: 'trim', clipId: 'b', keptText: 'quote' },
      ],
      { byId: pool }
    );
    expect(res.clips.map(c => c.id)).toEqual(['c', 'm', 'b']);
    expect(res.clips[1].gapAfterSec).toBe(0.6);
    expect(res.clips[1].tensionScore).toBe(7);
    expect(res.pendingTrims).toEqual([{ clipId: 'b', keptText: 'quote' }]);
  });

  it('rejects inserting a clip that is already present', () => {
    const res = applyOps([clip('n')], [{ op: 'insert', clipId: 'n', atIndex: 0 }], { byId: pool });
    expect(res.clips).toHaveLength(1);
    expect(res.rejected).toHaveLength(1);
  });
});
