import { describe, it, expect } from 'vitest';
import { buildManifest, compileScript, NARRATOR_LABEL } from '../scriptCompile';
import { takeTextHash } from '../scriptAudio';
import { RenderError, renderCompiled } from '../scriptRender';
import type { Block, ScriptProject, ScriptVersion, StudioClip } from '../scriptTypes';

const clipA: StudioClip = { clipId: 'cA', title: 'Cut clip', speaker: 'Oor', releaseTag: 'T1', audioUrl: 'https://github.com/x/releases/download/T1/cA.mp3', durationSec: 20, text: 'a b c', audioOffsetSec: 0 };
const clipB: StudioClip = { clipId: 'cB', title: 'From the episode', speaker: 'Mary', releaseTag: 'T1', audioUrl: 'https://github.com/x/releases/download/T1/ep.mp3', durationSec: 10, text: 'd e f', audioOffsetSec: 300, episodeStartSec: 300 };
const project: ScriptProject = {
  id: 'prj_1', title: 'Cake', createdAt: 0, updatedAt: 0, format: 'narrative_doc', sourceTags: ['T1'], targetRuntimeSec: 60,
  transcriptHashes: {}, speakerNames: {}, clips: [clipA, clipB], excludedClips: [], headVersionId: 'v1',
};
const take = (id: string, text: string, sec: number): Block => ({ id, kind: 'narration', text, mode: 'live', claims: [], takeUrl: `/output/vox/take_${id}.mp3`, takeSec: sec, takeTextHash: takeTextHash(text) });
const clip = (id: string, clipId: string, inSec: number, outSec: number): Block => ({ id, kind: 'clip', clipId, keptText: 'b c', inSec, outSec, trimBasis: 'segment', fn: 'evidence', rationale: '' });
const version = (blocks: Block[]): ScriptVersion => ({ id: 'v1', parentId: null, projectId: 'prj_1', createdAt: 0, author: 'logan', segments: [{ id: 'seg', title: 'Open', scenes: [{ id: 'sc', title: 'The cake', purpose: '', blocks }] }] });

describe('compileScript', () => {
  it('maps clips, takes, pauses and music markers to a Montage timeline', () => {
    const v = version([
      { id: 'p0', kind: 'pause', sec: 1 },
      { id: 'm0', kind: 'music', cue: 'bed_in', note: 'low drone' },
      take('n1', 'Then the cake arrives.', 2.4),
      { id: 'p1', kind: 'pause', sec: 0.5 }, { id: 'p2', kind: 'pause', sec: 0.25 },
      clip('k1', 'cA', 2, 8),
      { id: 'm1', kind: 'music', cue: 'sting', note: 'after the laugh' },
      clip('k2', 'cB', 1, 4.5),
    ]);
    const c = compileScript(project, v);
    expect(c.ok).toBe(true);
    expect(c.blocked).toEqual([]);
    expect(c.leadingPauseSec).toBe(1);
    expect(c.items.map(i => [i.blockId, i.item.audioUrl, i.item.startSec, i.item.endSec, i.item.gapAfterSec])).toEqual([
      ['n1', '/output/vox/take_n1.mp3', 0, 2.4, 0.75],
      ['k1', clipA.audioUrl, 2, 8, 0],
      ['k2', clipB.audioUrl, 301, 304.5, 0],
    ]);
    expect(c.items[0].item.speaker).toBe(NARRATOR_LABEL);
    expect(c.items[1].item).toMatchObject({ windowVerified: true, sourceDurationSec: 20, keptText: 'b c', trimBasis: 'segment' });
    expect(c.items[2].item.sourceDurationSec).toBeUndefined(); // an episode file is longer than the clip
    expect(c.markers.map(m => [m.blockId, m.beforeItem])).toEqual([['m0', 0], ['m1', 2]]);

    const m = buildManifest(project, v, c, 123);
    expect(m.settings).toEqual({ targetLufs: -16, peakDb: -1, fadeMs: 18 });
    expect(m.items.map(i => [i.timelineStartSec, i.timelineEndSec])).toEqual([[0, 2.4], [3.15, 9.15], [9.15, 12.65]]);
    expect(m.totalSec).toBe(12.65);
    expect(m.musicMarkers.map(x => [x.cue, x.timelineSec])).toEqual([['bed_in', 0], ['sting', 9.15]]);
    expect(m.items[2]).toMatchObject({ originalAudioUrl: clipB.audioUrl, originalStartSec: 301, originalEndSec: 304.5 });

    // A transcript cut plays from a server-side cut of its window, clip-relative.
    const cut = compileScript(project, v, { clipAudioUrl: id => `/api/script/clip-audio?projectId=prj_1&clipId=${id}` });
    expect(cut.items[2].item).toMatchObject({ audioUrl: '/api/script/clip-audio?projectId=prj_1&clipId=cB', startSec: 1, endSec: 4.5, sourceDurationSec: 10 });
    expect(cut.items[1].item.audioUrl).toBe(clipA.audioUrl); // a cut clip file is used as it is
    expect(buildManifest(project, v, cut, 1).items[2]).toMatchObject({ sourceStartSec: 1, originalStartSec: 301 });
    const rendered = buildManifest(project, v, c, 123, [2.39, 6, 3.5]);
    expect(rendered.items[1].timelineStartSec).toBe(3.14);
  });
  it('blocks narration without a current take and clips without audio, naming them', () => {
    const stale = { ...take('n2', 'Old words.', 1), text: 'New words.' } as Block;
    const v = version([
      { id: 'n1', kind: 'narration', text: 'No take yet.', mode: 'live', claims: [] }, stale,
      clip('k1', 'gone', 0, 1), clip('k2', 'cA', 5, 25),
    ]);
    const c = compileScript({ ...project, clips: [clipA] }, v);
    expect(c.ok).toBe(false);
    expect(c.blocked.map(b => b.blockId)).toEqual(['n1', 'n2', 'k1', 'k2']);
    expect(c.blocked[0].reason).toMatch(/No Vox take yet/);
    expect(c.blocked[1].reason).toMatch(/older wording/);
    expect(c.blocked[3].reason).toMatch(/outside 0 to 20s/);
  });
});

describe('renderCompiled', () => {
  it('stops and names the block when a source cannot be fetched', async () => {
    const c = compileScript(project, version([take('n1', 'Then the cake arrives.', 2.4)]));
    const err = await renderCompiled(c.items, { audioCtx: {} as AudioContext, fetchAudio: async () => { throw new Error('HTTP 404'); } }).catch(e => e);
    expect(err).toBeInstanceOf(RenderError);
    expect(err.blockId).toBe('n1');
    expect(err.message).toMatch(/narration take for block n1: HTTP 404/);
  });
});
