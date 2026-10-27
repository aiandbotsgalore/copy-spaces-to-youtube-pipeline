import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  batchTurns, buildStyleCard, cardFreshness, draftStyle, isLogan, readCard, readNarrationExamples, sampleTurns, scanCorpus, verifyTraits, voiceSummary,
} from '../../server/scriptStyle';
import { createScriptStore } from '../../server/scriptStore';
import type { CompleteResult } from '../../server/scriptProviders';

let root = '';
const ep = (tag: string, segs: [string, number, number, string][]) =>
  fs.writeFileSync(path.join(root, 'public', 'transcripts', 'episodes', `${tag}.json`), JSON.stringify({ release_tag: tag, title: `T ${tag}`, segments: segs.map(([speaker, start, end, text]) => ({ speaker, start, end, text })) }));
const long = (n: number, w = 'word') => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ');

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-style-'));
  fs.mkdirSync(path.join(root, 'public', 'transcripts', 'episodes'), { recursive: true });
  fs.mkdirSync(path.join(root, 'speaker_samples', 'Logan', 'narration_examples'), { recursive: true });
  fs.writeFileSync(path.join(root, 'speaker_samples', 'Logan', 'narration_examples', 'gary.txt'), 'Logan: Every generation produces a story that people desperately want to be true. Gary McKinnon is that story.');
  fs.writeFileSync(path.join(root, 'public', 'voice_profiles.json'), JSON.stringify({ profiles: { Logan: { name: 'Logan' } } }));
  ep('20260101_aaaa', [
    ['Logan', 0, 4, 'So here is the thing. Who actually checked that?'],
    ['Logan', 5, 9, `Let me be real with you. ${long(45)}.`],   // joined with the first: gap 1 s
    ['Speaker 1', 10, 14, 'I think you are wrong about all of it.'],
    ['Logan', 15, 18, 'Fair enough. Let me be real with you.'],
  ]);
  ep('20260201_bbbb', [
    ['Logan Black', 0, 30, `Let me be real with you. ${long(60, 'alpha')}?`],
    ['Speaker 2', 31, 40, 'Okay.'],
  ]);
  ep('20260301_cccc', [
    ['Speaker 3', 0, 30, `Let me be real with you. ${long(50, 'beta')}.`],
    ['Speaker 1', 31, 40, 'Nobody here is Logan.'],
  ]);
  ep('20260401_dddd', [['Speaker 1', 0, 5, 'No Logan in this one.']]);
});

describe('who is Logan', () => {
  it('matches the voice profile name and aliases', () => {
    expect(isLogan('Logan', ['Logan'])).toBe(true);
    expect(isLogan('Logan Black', ['Logan'])).toBe(true);
    expect(isLogan('logan', ['Logan'])).toBe(true);
    expect(isLogan('Loganberry', ['Logan'])).toBe(false);
    expect(isLogan('Speaker 1', ['Logan'])).toBe(false);
  });
});

describe('corpus scan', () => {
  it('measures every Logan segment in code, after Logan\'s renames', async () => {
    const scan = await scanCorpus(root, { '20260301_cccc': { 'Speaker 3': 'Logan' } });
    expect(scan.stats).toMatchObject({ recordingsScanned: 4, recordingsWithLogan: 3, segments: 5, firstDate: '2026-01-01', lastDate: '2026-03-01' });
    expect(scan.recordingTags.sort()).toEqual(['20260101_aaaa', '20260201_bbbb', '20260301_cccc']);
    // Consecutive Logan segments within 3 s join into one turn.
    expect(scan.turnsByTag.get('20260101_aaaa')!.map(t => t.words)).toEqual([9 + 6 + 45, 8]);
    expect(scan.stats.topOpeners[0].opener).toBe('let me');
    expect(scan.stats.questionShare).toBeGreaterThan(0);
    expect(scan.stats.words).toBe(60 + 8 + 66 + 56);
  });
  it('without the rename the third recording has no Logan', async () => {
    expect((await scanCorpus(root)).stats.recordingsWithLogan).toBe(2);
  });
  it('samples longer turns deterministically, spread over recordings, and batches them with dates', async () => {
    const scan = await scanCorpus(root, { '20260301_cccc': { 'Speaker 3': 'Logan' } });
    const a = sampleTurns(scan.turnsByTag);
    expect(a).toEqual(sampleTurns(scan.turnsByTag));
    expect(new Set(a.map(t => t.tag)).size).toBe(3);
    expect(a.every(t => t.words >= 40)).toBe(true);
    const small = sampleTurns(scan.turnsByTag, 700);
    expect(small.length).toBeLessThan(a.length);
    expect(batchTurns(a, 600).length).toBeGreaterThan(1);
    expect(batchTurns(a)[0]).toMatch(/^\[2026-01-01\] /);
  });
});

describe('style card', () => {
  it('drops examples that are not in the source', () => {
    const v = verifyTraits([{ trait: 'Asks who checked', examples: ['Who actually checked that?', 'An invented line he never said'] }, { trait: '', examples: [] }], 'So here is the thing. Who actually checked that?', 10);
    expect(v).toEqual({ traits: [{ trait: 'Asks who checked', examples: ['Who actually checked that?'] }], dropped: 1 });
  });

  it('builds from batches plus the narration examples, with honest coverage, and feeds the draft and critic', async () => {
    const store = createScriptStore(root);
    const scan = await scanCorpus(root, { '20260301_cccc': { 'Speaker 3': 'Logan' } });
    const prompts: string[] = [];
    const call = async (_role: 'analyst', prompt: any, label: string): Promise<CompleteResult> => {
      prompts.push(`${label}\n${prompt.system}\n${prompt.user}`);
      const json = label.startsWith('style traits')
        ? { traits: [{ trait: 'Opens with a frame', examples: ['Let me be real with you', 'never said this'] }], avoid: ['Academic hedging'] }
        : {
          live: { summary: 'Direct, conversational.', traits: [{ trait: 'Opens with a frame', examples: ['Let me be real with you'] }, { trait: 'Made up', examples: ['not in any turn'] }] },
          polished: { summary: 'Measured and sceptical.', traits: [{ trait: 'Big framing first', examples: ['Every generation produces a story', 'not in the narration'] }] },
          avoid: ['Academic hedging'],
        };
      return { ok: true, json, provider: 'claude_cli', model: 'sonnet', durationMs: 5 };
    };
    const card = await buildStyleCard({ root, store, call, scan, now: () => Date.UTC(2026, 9, 27) });
    expect(prompts[0]).toMatch(/Measured in code over all 5 segments/);
    expect(prompts[0]).toContain('[2026-02-01]');
    expect(prompts.at(-1)).toContain('Every generation produces a story');
    expect(card.live.traits).toEqual([{ trait: 'Opens with a frame', examples: ['Let me be real with you'] }, { trait: 'Made up', examples: [] }]);
    expect(card.polished.traits[0].examples).toEqual(['Every generation produces a story']);
    expect(card.coverage).toMatchObject({ segmentsMeasured: 5, recordingsWithLogan: 3, recordingsRead: 3, narrationFiles: ['gary.txt'], examplesDropped: 3, batchesFailed: [] });
    expect(card.text).toMatch(/^Logan's style card \(built 2026-10-27; 5 segments from 3 recordings measured in code; \d+ of his turns from 3 recordings read by the model/);
    expect(card.text).toContain('LIVE (how Logan talks in his Spaces): Direct, conversational.');
    expect(card.text).toContain('POLISHED');
    expect(readCard(store)?.sourceHash).toBe(scan.sourceHash);
    expect(draftStyle(store, root).styleCard).toContain('Excerpt of Logan\'s written narration:\n## gary.txt\nEvery generation');
    expect(voiceSummary(store)).toContain('Polished: Measured and sceptical.');

    const narr = readNarrationExamples(root).hash;
    expect(cardFreshness(card, scan, narr).fresh).toBe(true);
    expect(cardFreshness(card, scan, 'other').reason).toBe('The narration examples changed.');
    expect(cardFreshness(card, { recordingTags: [...scan.recordingTags, 'x1', 'x2'] }, narr)).toMatchObject({ fresh: false, newRecordings: 2 });
    expect(cardFreshness(null, scan, narr)).toMatchObject({ fresh: false, reason: 'No style card yet.' });
  });

  it('a failed batch is reported in coverage; no Logan speech is an error', async () => {
    const store = createScriptStore(root);
    const scan = await scanCorpus(root, { '20260301_cccc': { 'Speaker 3': 'Logan' } });
    let n = 0;
    const call = async (_r: 'analyst', _p: any, label: string): Promise<CompleteResult> => {
      if (label.startsWith('style traits') && n++ === 0) return { ok: false, code: 'BAD_OUTPUT', message: 'not JSON', rawOutput: '', durationMs: 1, provider: 'claude_cli', model: 'sonnet' };
      return { ok: true, json: label.startsWith('style traits') ? { traits: [], avoid: [] } : { live: { summary: 's', traits: [] }, polished: { summary: 'p', traits: [] }, avoid: [] }, provider: 'claude_cli', model: 'sonnet', durationMs: 1 };
    };
    const card = await buildStyleCard({ root, store, call, scan, batchChars: 600 });
    expect(card.coverage.batches).toBeGreaterThan(1);
    expect(card.coverage.batchesFailed).toEqual(['batch 1: BAD_OUTPUT: not JSON']);
    expect(card.coverage.recordingsRead).toBeLessThan(3);
    n = 0;
    await expect(buildStyleCard({ root, store, call, scan })).rejects.toMatchObject({ code: 'STYLE_FAILED' });
    const none = await scanCorpus(root, {});
    none.turnsByTag.clear();
    await expect(buildStyleCard({ root, store, call, scan: none })).rejects.toMatchObject({ code: 'NO_LOGAN_SPEECH' });
  });
});

describe('the card reaches every writing role', () => {
  it('draft, revise and critique prompts carry the card, rules and voice; multi-recording notes only when there are several', async () => {
    const P = await import('../../server/scriptPrompts');
    const c = P.critiquePrompt({ format: 'narrative_doc', segment: '{}', neighbours: '', localNotes: '', memory: '- Name the speaker.', voice: 'Live: quick.' });
    expect(c.user).toContain("Logan's voice (narration that does not sound like this is an authenticity problem):\nLive: quick.");
    expect(c.version).toBe('critique.v3');
    const r = P.revisePrompt({ format: null, scene: '{}', critique: '{}', neighbours: '', evidence: '', clips: '[]', styleRules: '- r', lockedIds: [], styleCard: 'CARD', recordings: '' });
    expect(r.user).toContain('Style card:\nCARD');
    expect(r.system).not.toContain('several recordings');
    const d = P.draftPrompt({ format: null, segmentTitle: 's', scenes: '[]', styleCard: 'CARD', approvedPassages: '', evidence: '', clips: '[]', memory: '', recordings: 'E1 = recorded 2026-01-01: A (a)', thesis: 'Why?' });
    expect(d.system).toContain('E1.u92 is utterance u92 of recording E1');
    expect(d.system).toContain('Thesis question Logan set for this episode: Why?');
  });
});
