import { describe, it, expect } from 'vitest';
import { formatChecks, newHardFindings, rubricText, dateOfTag, FORMAT_SPECS } from '../scriptFormats';
import { codeGates, reorderScenes, episodeOutlineView } from '../scriptGates';
import type { Block, Segment } from '../scriptTypes';
import { EPISODE_FORMATS } from '../scriptTypes';

const TAG = '20260826_1AxRnZYBVdrxl';
const clip = (id: string, sec: number, fn: any = 'evidence'): Block => ({ id, kind: 'clip', clipId: `c_${id}`, keptText: 'x', inSec: 0, outSec: sec, trimBasis: 'full', fn, rationale: '' });
const narr = (id: string, text: string, claims: any[] = []): Block => ({ id, kind: 'narration', text, mode: 'live', claims });
const seg = (...scenes: { id: string; blocks: Block[] }[]): Segment[] => [{ id: 'seg1', title: 'S', scenes: scenes.map(s => ({ id: s.id, title: s.id, purpose: '', blocks: s.blocks })) }];
const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ') + '.';

describe('format rubrics', () => {
  it('every format has a structure and defined criteria', () => {
    for (const f of EPISODE_FORMATS) {
      expect(FORMAT_SPECS[f].structure.length).toBeGreaterThan(10);
      expect(rubricText(f).split('\n')).toHaveLength(FORMAT_SPECS[f].criteria.length);
    }
  });
  it('best-of: narration must stay under 15% of runtime', () => {
    // 31 words at 155 wpm = 12 s narration vs 60 s clip -> 16.7%
    expect(formatChecks(seg({ id: 'a', blocks: [narr('n', words(31)), clip('c', 60)] }), 'best_of').hard[0].key).toBe('best_of:narration_share');
    expect(formatChecks(seg({ id: 'a', blocks: [narr('n', words(20)), clip('c', 60)] }), 'best_of').hard).toEqual([]);
  });
  it('short highlight: 30 to 90 s and at most one setup line', () => {
    const r = formatChecks(seg({ id: 'a', blocks: [narr('n1', 'Setup.'), clip('c', 120), narr('n2', 'And another.')] }), 'short_highlight');
    expect(r.hard.map(f => f.key).sort()).toEqual(['short:runtime', 'short:setup_lines']);
    expect(formatChecks(seg({ id: 'a', blocks: [narr('n1', 'Setup.'), clip('c', 45)] }), 'short_highlight').hard).toEqual([]);
  });
  it('investigative: single-source claims need attribution; claims need an evidence clip', () => {
    const claim = { releaseTag: TAG, segStart: 1, segEnd: 2, speaker: 'Oor', verbatim: 'x' };
    const r = formatChecks(seg({ id: 'a', blocks: [narr('n', 'The cake was orange.', [claim])] }), 'investigative');
    expect(r.hard.map(f => f.key)).toEqual(['inv:attr:n']);
    expect(r.soft.map(f => f.key)).toContain('inv:evidence:a');
    const two = { ...claim, speaker: 'Mary' };
    expect(formatChecks(seg({ id: 'a', blocks: [narr('n', 'The cake was orange.', [claim, two]), clip('c', 10)] }), 'investigative').hard).toEqual([]);
  });
  it('thematic: every clip needs a dated recording', () => {
    const s = seg({ id: 'a', blocks: [clip('c1', 10), clip('c2', 10)] });
    const r = formatChecks(s, 'thematic_multi', { clipTags: { c_c1: TAG, c_c2: 'no-date-tag' }, sourceCount: 1 });
    expect(r.hard.map(f => f.key)).toEqual(['thm:date:c2']);
    expect(r.soft.map(f => f.key)).toEqual(['thm:sources']);
    expect(dateOfTag(TAG)).toBe('2026-08-26');
  });
  it('interview, commentary and narrative notes are soft', () => {
    const i = formatChecks(seg({ id: 'a', blocks: [narr('n1', words(70)), narr('n2', 'Then.'), clip('c', 10)] }), 'interview');
    expect(i.hard).toEqual([]);
    expect(i.soft.map(f => f.key)).toEqual(['int:long:n1', 'int:double:n1']);
    expect(formatChecks(seg({ id: 'a', blocks: [narr('n', 'This is wrong.')] }), 'commentary').soft).toHaveLength(1);
    expect(formatChecks(seg({ id: 'a', blocks: [narr('n', 'In my view this is wrong.')] }), 'commentary').soft).toHaveLength(0);
    const d = formatChecks(seg({ id: 'a', blocks: [narr('n', 'It ended.')] }, { id: 'b', blocks: [clip('c', 5)] }), 'narrative_doc');
    expect(d.soft.map(f => f.key)).toEqual(['doc:open:a']);
  });
  it('only new hard findings fail a candidate', () => {
    const base = formatChecks(seg({ id: 'a', blocks: [narr('n', words(31)), clip('c', 60)] }), 'best_of');
    const cand = formatChecks(seg({ id: 'a', blocks: [narr('n', words(40)), clip('c', 60)] }), 'best_of');
    expect(newHardFindings(cand, base)).toEqual([]);
    const ctx = { baseline: seg({ id: 'a', blocks: [narr('n', words(5)), clip('c', 60)] }), transcripts: {}, clipsById: { c_c: { clipId: 'c_c', title: '', speaker: '', releaseTag: TAG, audioUrl: '', durationSec: 60, text: 'x' } }, targetRuntimeSec: 0, format: 'best_of' as const, formatCheck: (s: Segment[]) => formatChecks(s, 'best_of') };
    const worse = seg({ id: 'a', blocks: [narr('n', words(31)), clip('c', 60)] });
    const g = codeGates(worse, { ...ctx, changedBlockIds: new Set(['n']) });
    expect(g.ok).toBe(false);
    expect(g.failures[0]).toMatch(/Best-of: narration is 17%/);
  });
});

describe('scene reordering (episode pass)', () => {
  const segs: Segment[] = [
    { id: 's1', title: 'One', scenes: [{ id: 'a', title: 'A', purpose: '', blocks: [narr('n1', 'First?')] }, { id: 'b', title: 'B', purpose: '', blocks: [] }] },
    { id: 's2', title: 'Two', scenes: [{ id: 'c', title: 'C', purpose: '', blocks: [clip('x', 4)] }] },
  ];
  it('moves scenes, also between segments, without touching blocks', () => {
    const r = reorderScenes(segs, [{ segmentId: 's2', sceneIds: ['c', 'a'] }, { segmentId: 's1', sceneIds: ['b'] }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.segments.map(s => `${s.id}:${s.scenes.map(x => x.id).join(',')}`)).toEqual(['s2:c,a', 's1:b']);
    expect(r.segments[0].scenes[1]).toBe(segs[0].scenes[0]);
    expect(r.moved.sort()).toEqual(['a', 'b', 'c']);
  });
  it('rejects dropped, duplicated, unknown and unchanged orders', () => {
    expect(reorderScenes(segs, [{ segmentId: 's1', sceneIds: ['a', 'b'] }, { segmentId: 's2', sceneIds: [] }])).toMatchObject({ ok: false, reason: expect.stringMatching(/drops c/) });
    expect(reorderScenes(segs, [{ segmentId: 's1', sceneIds: ['a', 'a'] }, { segmentId: 's2', sceneIds: ['c'] }]).ok).toBe(false);
    expect(reorderScenes(segs, [{ segmentId: 's1', sceneIds: ['a', 'b', 'z'] }, { segmentId: 's2', sceneIds: ['c'] }]).ok).toBe(false);
    expect(reorderScenes(segs, [{ segmentId: 's1', sceneIds: ['a', 'b', 'c'] }]).ok).toBe(false);
    expect(reorderScenes(segs, [{ segmentId: 's1', sceneIds: ['a', 'b'] }, { segmentId: 's2', sceneIds: ['c'] }])).toMatchObject({ ok: false, reason: 'The proposed order is the current order.' });
  });
  it('the judge view carries no ids', () => {
    const v = JSON.stringify(episodeOutlineView(segs, false));
    expect(v).not.toMatch(/"(segmentId|sceneId)"/);
    expect(JSON.stringify(episodeOutlineView(segs, true))).toMatch(/"sceneId":"a"/);
  });
});
