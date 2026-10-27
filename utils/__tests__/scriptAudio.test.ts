import { describe, it, expect } from 'vitest';
import { attachTakes, countTakes, hasValidTake, narrationInScope, spokenChecks, spokenSceneView, takeTextHash, type TakeIndex } from '../scriptAudio';
import { blockSeconds, changedBlockIds, locksIntact } from '../scriptGates';
import type { Block, Scene, Segment } from '../scriptTypes';

const narr = (id: string, text: string, extra: Partial<Extract<Block, { kind: 'narration' }>> = {}): Block => ({ id, kind: 'narration', text, mode: 'live', claims: [], ...extra });
const seg = (blocks: Block[], sceneId = 'sc1'): Segment[] => [{ id: 'seg1', title: 'S', scenes: [{ id: sceneId, title: 'Scene', purpose: 'p', blocks }] }];

describe('take hashes', () => {
  it('is stable, ignores whitespace, and changes with the words', () => {
    expect(takeTextHash('Hello  there.\n')).toBe(takeTextHash(' Hello there.'));
    expect(takeTextHash('Hello there.')).not.toBe(takeTextHash('Hello there!'));
    expect(takeTextHash('Hello there.')).toMatch(/^[0-9a-f]{16}$/);
    expect(takeTextHash('Hello there.', 'Someone else')).not.toBe(takeTextHash('Hello there.'));
  });
  it('accepts a take only while the text still matches', () => {
    const text = 'The cake arrives.';
    const ok = narr('b1', text, { takeUrl: '/output/vox/take_x.mp3', takeSec: 1.4, takeTextHash: takeTextHash(text) });
    expect(hasValidTake(ok)).toBe(true);
    expect(blockSeconds(ok)).toEqual({ sec: 1.4, estimated: false });
    const stale = { ...ok, text: 'The cake arrives late.' } as Block;
    expect(hasValidTake(stale)).toBe(false);
    expect(blockSeconds(stale).estimated).toBe(true);
  });
});

describe('attachTakes', () => {
  const text = 'Then the cake arrives.';
  const index: TakeIndex = { [takeTextHash(text)]: { hash: takeTextHash(text), url: '/output/vox/take_a.mp3', sec: 1.9, createdAt: 1, voice: 'Logan', model: 'm' } };
  it('sets real durations from the index and strips stale or injected take fields', () => {
    const segs = seg([narr('b1', text), narr('b2', 'Other words.', { takeUrl: '/elsewhere.mp3', takeSec: 9, takeTextHash: 'bogus' }), { id: 'p', kind: 'pause', sec: 1 }]);
    const out = attachTakes(segs, index);
    const [b1, b2] = out[0].scenes[0].blocks as any[];
    expect(b1).toMatchObject({ takeUrl: '/output/vox/take_a.mp3', takeSec: 1.9, takeTextHash: takeTextHash(text) });
    expect(b2.takeUrl).toBeUndefined();
    expect(countTakes(out)).toEqual({ withTake: 1, narration: 2 });
  });
  it('take fields are not content: no lock break and no changed block', () => {
    const base = seg([narr('b1', text, { locked: true })]);
    const withTake = attachTakes(base, index);
    expect(locksIntact(base, withTake)).toEqual([]);
    expect(changedBlockIds(base, withTake).size).toBe(0);
  });
  it('scopes narration to one scene', () => {
    const segs: Segment[] = [{ id: 's', title: 'S', scenes: [
      { id: 'a', title: 'A', purpose: '', blocks: [narr('n1', 'One.'), narr('n2', '  ')] },
      { id: 'b', title: 'B', purpose: '', blocks: [narr('n3', 'Three.')] },
    ] }];
    expect(narrationInScope(segs).map(b => b.id)).toEqual(['n1', 'n3']);
    expect(narrationInScope(segs, 'b').map(b => b.id)).toEqual(['n3']);
  });
});

describe('spoken checks', () => {
  const withTake = (id: string, text: string, sec: number) => narr(id, text, { takeUrl: `/output/vox/${id}.mp3`, takeSec: sec, takeTextHash: takeTextHash(text) });
  it('flags rushed and dragging takes from real durations only', () => {
    const rushed = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen';
    const scene: Scene = { id: 'sc', title: 'T', purpose: '', blocks: [withTake('fast', rushed, 3), withTake('slow', 'Just four words here.', 4), narr('est', rushed)] };
    const notes = spokenChecks(scene);
    expect(notes.some(n => n.includes('Block fast is rushed') && n.includes('5.3 words per second'))).toBe(true);
    expect(notes.some(n => n.includes('Block slow drags'))).toBe(true);
    expect(notes.some(n => n.includes('Block est'))).toBe(false);
  });
  it('flags repeated openers and long narration without a breath point', () => {
    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    const scene: Scene = { id: 'sc', title: 'T', purpose: '', blocks: [narr('a', `And then ${long}`), narr('b', `And then ${long}`)] };
    const notes = spokenChecks(scene);
    expect(notes).toContain('2 narration lines in this scene open with "and then".');
    expect(notes.some(n => n.startsWith('Narration from block a runs'))).toBe(true);
    const broken: Scene = { ...scene, blocks: [narr('a', long), { id: 'p', kind: 'pause', sec: 1 }, narr('b', long)] };
    expect(spokenChecks(broken).some(n => n.includes('no pause'))).toBe(false);
  });
  it('the spoken view says where each length came from', () => {
    const scene: Scene = { id: 'sc', title: 'T', purpose: 'p', blocks: [
      withTake('a', 'Measured line here.', 1.5), narr('b', 'Estimated line.'),
      { id: 'c', kind: 'clip', clipId: 'k', keptText: 'Hi.', inSec: 1, outSec: 3.5, trimBasis: 'segment', fn: 'breather', rationale: '' },
      { id: 'p', kind: 'pause', sec: 0.8 }, { id: 'm', kind: 'music', cue: 'sting', note: 'hit' },
      narr('l', 'Locked.', { locked: true }),
    ] };
    const v = spokenSceneView(scene, { k: { speaker: 'Oor' } });
    expect(v.blocks.map(b => [b.id, b.durationSource, b.seconds])).toEqual([['a', 'vox', 1.5], ['b', 'estimated', 0.8], ['c', 'clip', 2.5], ['p', 'pause', 0.8], ['m', 'marker', 0]]);
    expect(v.blocks[0].wordsPerSec).toBe(2);
    expect(v.blocks[2].speaker).toBe('Oor');
  });
});
