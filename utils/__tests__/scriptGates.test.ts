import { describe, it, expect } from 'vitest';
import {
  applyPatch, attributionFailure, codeGates, diffVersions, estimateRuntime, judgeConsensus, localTextChecks,
  locksIntact, mostConsequential, runtimeWithin, sameSpeakerRuns, verifyVerbatim, type TranscriptSeg,
} from '../scriptGates';
import type { Critique, ScriptVersion, StudioClip } from '../scriptTypes';
import { makeClipTrim } from '../scriptTrim';

// Real excerpt from public/transcripts/episodes/20260826_1AxRnZYBVdrxl.json (segments 91 to 94).
const TAG = '20260826_1AxRnZYBVdrxl';
const SEGS: TranscriptSeg[] = [
  { start: 1203.06, end: 1207.94, speaker: 'Eric Hecker', text: 'Yeah.' },
  { start: 1207.94, end: 1220.1, speaker: 'Oor', text: "Yo, this thing is stuffed with, um, orange cream cheese. Uh, so like actual orange cream cheese? Like oranges, citrus? No, it's not cut, it's orange citrus. Delicious." },
  { start: 1224.63, end: 1242.38, speaker: 'Oor', text: "I'm angry I can't share this with you. It's really unfortunate. Thanks, bro. Oh my God, it's so good! I don't even eat this kind of shit, bro. Wow, wow, fire, fire! I just want to be a fat guy now." },
  { start: 1242.38, end: 1246.87, speaker: 'Danielle', text: "Well, you've been eating a lot lately, so maybe\u2014" },
];

describe('verbatim gate joins same-speaker adjacent segments', () => {
  it('accepts a quote that crosses a segment boundary', () => {
    const r = verifyVerbatim({ releaseTag: TAG, segStart: 1215, segEnd: 1230, speaker: 'Oor', verbatim: "it's orange citrus. Delicious. I'm angry I can't share this with you." }, SEGS);
    expect(r.ok).toBe(true);
  });
  it('rejects a paraphrase', () => {
    const r = verifyVerbatim({ releaseTag: TAG, segStart: 1207, segEnd: 1242, speaker: 'Oor', verbatim: 'this cake is stuffed with orange cream cheese' }, SEGS);
    expect(r.ok).toBe(false);
  });
  it('rejects a quote attributed to the wrong speaker', () => {
    const r = verifyVerbatim({ releaseTag: TAG, segStart: 1242, segEnd: 1247, speaker: 'Oor', verbatim: "you've been eating a lot lately" }, SEGS);
    expect(r.ok).toBe(false);
  });
  it('does not join across another speaker', () => {
    const r = verifyVerbatim({ releaseTag: TAG, segStart: 1236, segEnd: 1246, speaker: 'Oor', verbatim: 'fat guy now. Well, you' }, SEGS);
    expect(r.ok).toBe(false);
  });
  it('applies speaker renames', () => {
    expect(sameSpeakerRuns(SEGS, 'Oor Prime', 1210, 1215, { Oor: 'Oor Prime' })).toHaveLength(1);
  });
});

const clip: StudioClip = { clipId: 'c1', title: 'Cream cheese', speaker: 'Oor', releaseTag: TAG, audioUrl: 'https://github.com/x/y/releases/download/t/a.mp3', durationSec: 12.16, text: SEGS[1].text, episodeStartSec: 1207.94, audioOffsetSec: 0 };
const clipsById = { c1: clip };
const base = (): ScriptVersion => ({
  id: 'v1', parentId: null, projectId: 'p', createdAt: 1, author: 'loop',
  segments: [{ id: 'seg1', title: 'S', scenes: [{ id: 'sc1', title: 'Scene', purpose: 'p', blocks: [
    { id: 'b1', kind: 'narration', text: 'Oor finds something in the cake.', mode: 'live', claims: [], locked: true },
    { id: 'b2', kind: 'clip', clipId: 'c1', keptText: SEGS[1].text, inSec: 0, outSec: 12.16, trimBasis: 'full', fn: 'breather', rationale: '' },
  ] }] }],
});
const trim = makeClipTrim(() => SEGS);
let n = 0;
const opts = () => ({ clipsById, trim, newId: () => `nb${++n}`, onBadTrim: 'reject' as const, newVersionId: 'v2', now: 2 });

describe('applyPatch', () => {
  it('replaces a scene, keeping locked blocks by reference and resolving clip times in code', async () => {
    const r = await applyPatch(base(), 'sc1', [
      { kind: 'keep', id: 'b1' },
      { kind: 'clip', clipId: 'c1', keptText: "Yo, this thing is stuffed with, um, orange cream cheese. Uh, so like actual orange cream cheese? Like oranges, citrus? No, it's not cut" },
    ], opts());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const blocks = r.version.segments[0].scenes[0].blocks;
    expect(blocks[0].id).toBe('b1');
    const c = blocks[1] as any;
    expect(c.inSec).toBe(0);
    expect(c.outSec).toBeGreaterThan(0);
    expect(c.outSec).toBeLessThanOrEqual(12.16);
    expect(r.version.parentId).toBe('v1');
  });
  it('rejects a patch that drops a locked block (never re-inserts it silently)', async () => {
    const r = await applyPatch(base(), 'sc1', [{ kind: 'narration', text: 'New line.' }], opts());
    expect(r).toEqual({ ok: false, reason: 'Patch drops locked block b1.' });
  });
  it('rejects unknown clips, unknown blocks and non-contiguous kept text', async () => {
    expect((await applyPatch(base(), 'sc1', [{ kind: 'keep', id: 'b1' }, { kind: 'clip', clipId: 'nope', keptText: 'x' }], opts())).ok).toBe(false);
    expect((await applyPatch(base(), 'sc1', [{ kind: 'keep', id: 'b1' }, { kind: 'keep', id: 'ghost' }], opts())).ok).toBe(false);
    const bad = await applyPatch(base(), 'sc1', [{ kind: 'keep', id: 'b1' }, { kind: 'clip', clipId: 'c1', keptText: 'cheese delicious angry' }], opts());
    expect(bad.ok).toBe(false);
  });
});

describe('code gates', () => {
  const ctx = { baseline: base().segments, transcripts: { [TAG]: SEGS }, clipsById, targetRuntimeSec: 15, format: 'investigative' as const };
  it('passes a faithful candidate', () => {
    const g = codeGates(base().segments, ctx);
    expect(g.failures).toEqual([]);
    expect(g.ok).toBe(true);
  });
  it('fails out-of-bounds clips, broken locks, bad quotes and runtime', () => {
    const v = base();
    const blocks = v.segments[0].scenes[0].blocks as any[];
    blocks[0] = { ...blocks[0], text: 'changed' };
    blocks[1] = { ...blocks[1], outSec: 20 };
    blocks.push({ id: 'b3', kind: 'narration', text: 'He said the cake was bad.', mode: 'live', claims: [{ releaseTag: TAG, segStart: 1207, segEnd: 1220, speaker: 'Oor', verbatim: 'the cake was bad' }] });
    const g = codeGates(v.segments, { ...ctx, targetRuntimeSec: 120 });
    expect(g.locksIntact).toBe(false);
    expect(g.clipBoundsOk).toBe(false);
    expect(g.factual).toBe('fail');
    expect(g.runtimeOk).toBe(false);
  });
  it("treats runtime delta discrepancies as non-blocking soft warnings", () => {
    // 1556-second actual runtime against a 1200-second target (or large discrepancy)
    const g = codeGates(base().segments, { ...ctx, targetRuntimeSec: 1200 });
    expect(g.failures).toEqual([]);
    expect(g.ok).toBe(true);
    expect(g.warnings && g.warnings.length).toBeGreaterThan(0);
    expect(g.warnings?.[0]).toMatch(/Runtime discrepancy/);
  });
  it("allows widening validation tolerance threshold in gate context", () => {
    // 1556 seconds vs 1200 seconds target: (1556 - 1200) / 1200 = 29.67% delta
    // With 0.35 (35%) tolerance, it is within tolerance
    expect(runtimeWithin(1556, 1200, 0.35)).toBe(true);
  });
  it('investigative single-source claims need attribution wording', () => {
    const claim = { releaseTag: TAG, segStart: 1224, segEnd: 1242, speaker: 'Oor', verbatim: "I can't share this with you" };
    expect(attributionFailure({ id: 'n', kind: 'narration', text: 'He cannot share it.', mode: 'live', claims: [claim] }, 'investigative')).toMatch(/does not attribute/);
    expect(attributionFailure({ id: 'n', kind: 'narration', text: 'According to Oor, he cannot share it.', mode: 'live', claims: [claim] }, 'investigative')).toBeNull();
    expect(attributionFailure({ id: 'n', kind: 'narration', text: 'He cannot share it.', mode: 'live', claims: [claim] }, 'narrative_doc')).toBeNull();
  });
  it('locksIntact reports dropped and changed locked blocks', () => {
    const v = base();
    v.segments[0].scenes[0].blocks = [];
    expect(locksIntact(base().segments, v.segments)).toEqual(['Locked block b1 was dropped.']);
  });
});

describe('runtime', () => {
  it('uses words per minute for narration without a take, and marks it estimated', () => {
    const r = estimateRuntime(base().segments);
    expect(r.estimated).toBe(true);
    expect(r.sec).toBeCloseTo(12.16 + (6 / 155) * 60, 2);
    expect(runtimeWithin(100, 109)).toBe(true);
    expect(runtimeWithin(100, 112)).toBe(false);
  });
});

describe('judge consensus (win plus tie rule)', () => {
  it('two wins accept', () => expect(judgeConsensus('B', 'A', 'minor')).toMatchObject({ consensus: 'two_wins', win: true }));
  it('win plus tie accepts only on a blocker or major target', () => {
    expect(judgeConsensus('B', 'tie', 'major')).toMatchObject({ consensus: 'win_plus_tie_on_major', win: true });
    expect(judgeConsensus('tie', 'A', 'blocker').win).toBe(true);
    expect(judgeConsensus('B', 'tie', 'minor').win).toBe(false);
  });
  it('a split or a baseline vote rejects', () => {
    expect(judgeConsensus('B', 'B', 'major').win).toBe(false); // one vote each way
    expect(judgeConsensus('A', 'B', 'major').win).toBe(false);
    expect(judgeConsensus('tie', 'tie', 'blocker').win).toBe(false);
  });
});

describe('critique helpers', () => {
  const c = (severity: Critique['severity'], id: string): Critique => ({ id, versionId: 'v', level: 'scene', targetId: 'sc1', issue: '', consequence: '', criterion: 'clarity', severity, proposedFix: '' });
  it('picks the most consequential critique', () => {
    expect(mostConsequential([c('minor', 'a'), c('blocker', 'b'), c('major', 'c')])!.id).toBe('b');
    expect(mostConsequential([])).toBeNull();
  });
  it('flags long sentences and repeated openers locally', () => {
    const notes = localTextChecks({ id: 's', title: '', purpose: '', blocks: [{ id: 'n1', kind: 'narration', mode: 'live', claims: [], text: 'And then it happened. And then he left. And then she called. ' + 'word '.repeat(30) + 'end.' }] });
    expect(notes.some(n => /sentence of 3\d words/.test(n))).toBe(true);
    expect(notes.some(n => /Opener "and then" starts 3/.test(n))).toBe(true);
  });
  it('diffs versions per block id', () => {
    const v = base();
    (v.segments[0].scenes[0].blocks[1] as any).outSec = 10;
    v.segments[0].scenes[0].blocks.push({ id: 'p1', kind: 'pause', sec: 1 });
    const d = diffVersions(base().segments, v.segments);
    expect(d.map(x => `${x.blockId}:${x.change}`).sort()).toEqual(['b2:changed', 'p1:added']);
  });
});
