/**
 * Phase 1: the shared evidence library (one file per recording) holds what was learned about each AQ
 * quote once (location, text check, audio, speaker confirmation). Project boards hold only references.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createScriptStore } from '../../server/scriptStore';
import { createQuoteLibrary } from '../../server/quoteLibrary';
import { LOCATOR_VERSION } from '../quoteLocate';
import { setBoardItem, getBoard } from '../../server/evidenceBoard';
import type { ScriptProject } from '../scriptTypes';

const q = (id: string, tag: string, text: string, extra: Record<string, unknown> = {}) => ({
  quote_id: id, release_tag: tag, exact_quote: text, speaker: 'Angela', category: 'Threat', target: 'Logan',
  source_in: null, source_out: null, cut_in: null, cut_out: null, needs_audio_alignment: true, transcript_search_window: '', master_clip_filename: null, ...extra,
});
const corpus = [
  q('AQ-0001', 'tagA', 'I called you out for what you did.'),
  q('AQ-0002', 'tagA', 'I stand by it.', { source_in: 20.5, source_out: 22, cut_in: 19, cut_out: 23.5, needs_audio_alignment: false }),
  q('AQ-0003', 'tagA', 'Nobody on this show ever said anything like this sentence.'),
  q('AQ-0004', 'tagMissing', 'There is no transcript for this one.'),
];
const segsA = [
  { start: 10, end: 15, speaker: 'Speaker 1', text: 'I called you out, um, for what you did.' },
  { start: 20, end: 25, speaker: 'Speaker 1', text: 'And I stand by it.' },
];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-lib-'));
  fs.mkdirSync(path.join(root, 'docs', 'documentary', 'data'), { recursive: true });
  fs.mkdirSync(path.join(root, 'public', 'transcripts', 'episodes'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'documentary', 'data', 'angela_quotes_master.json'), JSON.stringify(corpus));
  fs.writeFileSync(path.join(root, 'public', 'transcripts', 'episodes', 'tagA.json'), JSON.stringify({ title: 'A', segments: segsA }));
  const store = createScriptStore(root);
  let t = 1000;
  const lib = createQuoteLibrary(root, store, { now: () => t++ });
  return { root, store, lib };
}
const md5 = (f: string) => createHash('md5').update(fs.readFileSync(f)).digest('hex');
const project = (id: string): ScriptProject => ({ id, title: id, createdAt: 1, updatedAt: 1, format: null, sourceTags: ['tagA'], targetRuntimeSec: 600, transcriptHashes: {}, speakerNames: {}, clips: [], excludedClips: [], headVersionId: null, thesis: 'Why?' });

describe('evidence library: AQ import', () => {
  it('stores one library file per recording, with every AQ quote located, checked and given corpus audio', () => {
    const { root, store, lib } = fixture();
    const master = path.join(root, 'docs', 'documentary', 'data', 'angela_quotes_master.json');
    const before = md5(master);
    const r = lib.syncAq();
    expect(r).toMatchObject({ quotes: 4, located: 2, exact: 1, differs: 1, unlocated: 2, updated: ['tagA', 'tagMissing'] });
    expect(md5(master)).toBe(before);
    const a = store.getLibrary('tagA')!;
    expect(a.aqLinks.map(l => l.aqId)).toEqual(['AQ-0001', 'AQ-0002', 'AQ-0003']);
    expect(a.aqLinks[0]).toMatchObject({ utteranceIds: ['u0'], speakerLabels: ['Speaker 1'], text: { status: 'differs', transcriptSpan: 'I called you out, um, for what you did' }, audio: { status: 'none' } });
    expect(a.aqLinks[1]).toMatchObject({ utteranceIds: ['u1'], text: { status: 'exact' }, audio: { status: 'verified', source: 'corpus_cut', startSec: 19, endSec: 23.5 } });
    expect(a.aqLinks[2]).toMatchObject({ utteranceIds: [], text: { status: 'unlocated', note: expect.stringMatching(/best match/) } });
    expect(store.getLibrary('tagMissing')!.aqLinks[0].text).toMatchObject({ status: 'unlocated', note: 'No transcript file for tagMissing.' });
    expect(a.quotes).toEqual([]);
  });

  it('computes once: a second sync with unchanged transcripts writes nothing', () => {
    const { store, lib } = fixture();
    lib.syncAq();
    const file = store.libraryPath('tagA');
    const mtime = fs.statSync(file).mtimeMs;
    const text = fs.readFileSync(file, 'utf8');
    expect(lib.syncAq().updated).toEqual([]);
    expect(fs.readFileSync(file, 'utf8')).toBe(text);
    expect(fs.statSync(file).mtimeMs).toBe(mtime);
  });

  it('re-checks text when the transcript changes, keeping speaker confirmations and reviewed audio', () => {
    const { root, store, lib } = fixture();
    lib.syncAq();
    lib.confirmSpeaker('aq:AQ-0001', 'Angela');
    const libA = store.getLibrary('tagA')!;
    libA.aqLinks[0].audio = { status: 'verified', source: 'manual', startSec: 10.2, endSec: 14.8, reviewedAt: 5 };
    store.saveLibrary(libA);
    fs.writeFileSync(path.join(root, 'public', 'transcripts', 'episodes', 'tagA.json'), JSON.stringify({ title: 'A', segments: [{ start: 10, end: 15, speaker: 'Speaker 1', text: 'I called you out for what you did.' }, segsA[1]] }));
    expect(lib.syncAq().updated).toEqual(['tagA']);
    const link = store.getLibrary('tagA')!.aqLinks[0];
    expect(link.text.status).toBe('exact');
    expect(link).toMatchObject({ speakerConfirmed: true, speakerName: 'Angela', audio: { source: 'manual', startSec: 10.2 } });
  });

  it('re-checks text made by an older locator version, keeping speaker confirmations', () => {
    const { store, lib } = fixture();
    lib.syncAq();
    lib.confirmSpeaker('aq:AQ-0001', 'Angela');
    const libA = store.getLibrary('tagA')!;
    expect(libA.aqLinks[0].text.locator).toBe(LOCATOR_VERSION);
    libA.aqLinks[0].text = { ...libA.aqLinks[0].text, locator: LOCATOR_VERSION - 1, transcriptSpan: 'stale' };
    store.saveLibrary(libA);
    expect(lib.syncAq().updated).toEqual(['tagA']);
    const link = store.getLibrary('tagA')!.aqLinks[0];
    expect(link.text).toMatchObject({ transcriptSpan: 'I called you out, um, for what you did', locator: LOCATOR_VERSION });
    expect(link).toMatchObject({ speakerConfirmed: true, speakerName: 'Angela' });
  });

  it('confirms or clears a speaker once for every project, and lists entries with the live corpus record', () => {
    const { lib } = fixture();
    lib.syncAq();
    lib.confirmSpeaker('aq:AQ-0002', 'Angela');
    const e = lib.entries().find(x => x.ref === 'aq:AQ-0002')!;
    expect(e.corpus.exact_quote).toBe('I stand by it.');
    expect(e.link).toMatchObject({ speakerConfirmed: true, speakerName: 'Angela' });
    lib.confirmSpeaker('aq:AQ-0002', null);
    expect(lib.entries().find(x => x.ref === 'aq:AQ-0002')!.link).toMatchObject({ speakerConfirmed: false });
    expect(() => lib.confirmSpeaker('aq:AQ-9999', 'X')).toThrow(/Unknown quote/);
  });
});

describe('evidence library: data warnings', () => {
  it('warns when corpus cut points do not overlap where the quote was located, without changing them', () => {
    const { root, lib } = fixture();
    const odd = [...corpus.slice(0, 3), q('AQ-0005', 'tagA', 'I called you out for what you did.', { cut_in: 500, cut_out: 505, needs_audio_alignment: false })];
    fs.writeFileSync(path.join(root, 'docs', 'documentary', 'data', 'angela_quotes_master.json'), JSON.stringify(odd));
    lib.syncAq();
    const e = lib.entries().find(x => x.aqId === 'AQ-0005')!;
    expect(e.link!.audio).toEqual({ status: 'verified', source: 'corpus_cut', startSec: 500, endSec: 505 });
    expect(e.warnings).toEqual(['Corpus cut points (500.0 to 505.0 s) do not overlap where the quote was located in the transcript (10.0 to 15.0 s). Listen before using this audio.']);
    expect(lib.entries().find(x => x.aqId === 'AQ-0002')!.warnings).toEqual([]);
  });
});

describe('evidence board', () => {
  it('starring one quote in two projects stores the quote once; boards hold only the reference', () => {
    const { store, lib } = fixture();
    lib.syncAq();
    const libFile = fs.readFileSync(store.libraryPath('tagA'), 'utf8');
    for (const p of [project('prj_one'), project('prj_two')]) { store.saveProject(p); setBoardItem(store, p, 'aq:AQ-0002', { starred: true }, lib.hasRef, () => 7); }
    expect(fs.readFileSync(store.libraryPath('tagA'), 'utf8')).toBe(libFile);
    for (const id of ['prj_one', 'prj_two']) expect(getBoard(store, id)!.items).toEqual([{ ref: 'aq:AQ-0002', starred: true, addedAt: 7 }]);
    expect(getBoard(store, 'prj_one')).toMatchObject({ version: 1, question: 'Why?', tapeBalance: 'balanced', recordings: [{ releaseTag: 'tagA', status: 'candidate' }] });
  });

  it('only writes that project\'s board.json', () => {
    const { store, lib } = fixture();
    lib.syncAq();
    const a = project('prj_one'), b = project('prj_two');
    store.saveProject(a); store.saveProject(b);
    const otherBefore = fs.readdirSync(store.projectDir('prj_two'));
    setBoardItem(store, a, 'aq:AQ-0001', { excluded: true, note: 'Context is unclear.' }, lib.hasRef);
    expect(fs.readdirSync(store.projectDir('prj_one')).sort()).toEqual(['board.json', 'project.json']);
    expect(fs.readdirSync(store.projectDir('prj_two'))).toEqual(otherBefore);
  });

  it('removes an item once it has no star, exclusion or note, and refuses unknown refs', () => {
    const { store, lib } = fixture();
    lib.syncAq();
    const p = project('prj_one');
    store.saveProject(p);
    setBoardItem(store, p, 'aq:AQ-0001', { starred: true, note: 'Key.' }, lib.hasRef);
    setBoardItem(store, p, 'aq:AQ-0001', { starred: false, note: '' }, lib.hasRef);
    expect(getBoard(store, p.id)!.items).toEqual([]);
    expect(() => setBoardItem(store, p, 'aq:AQ-9999', { starred: true }, lib.hasRef)).toThrow(/Unknown quote/);
  });
});
