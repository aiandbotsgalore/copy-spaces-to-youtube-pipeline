/**
 * Data that must reach the script writer: highlight-catalog clips hosted off GitHub, stable catalog
 * clip ids, pinned document Sources (and the gate that checks claims citing them), and the project
 * rule sheet.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { catalogClipId, catalogClipReleaseTag, catalogClipsForRelease } from '../../server/scriptData';
import { addBoardSource, containsLoose, removeBoardSource } from '../../server/evidenceBoard';
import { createScriptStore } from '../../server/scriptStore';
import { withCharter } from '../../server/scriptEngine';
import { codeGates } from '../scriptGates';
import type { ScriptProject, Segment } from '../scriptTypes';

const R2 = (name: string) => `https://pub-0000.r2.dev/${name}`;
const catalogEntry = (over: Record<string, unknown> = {}) => ({
  title: 'A clip', category: 'Wild Story', start_seconds: '931.66', end_seconds: '1002.26', speakers: "['Logan']",
  transcript_snippet: 'Logan: words', episode: '20260916_1aJbdEmBBvrKX_Watching_the_hypocrisy', duration: '70.6',
  file_path: R2('15m31s_clip'), download_url: R2('15m31s_clip'), ...over,
});

const dirs: string[] = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-plumb-')); dirs.push(d); return d; };
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe('highlight catalog clips', () => {
  it('finds the release of an R2-hosted clip from its episode field', () => {
    expect(catalogClipReleaseTag(catalogEntry())).toBe('20260916_1aJbdEmBBvrKX');
  });
  it('still reads the release tag from a GitHub release URL', () => {
    const url = 'https://github.com/o/r/releases/download/20250716_1mnGegRZvDnxX/clip.mp3';
    expect(catalogClipReleaseTag(catalogEntry({ download_url: url, episode: '' }))).toBe('20250716_1mnGegRZvDnxX');
  });
  it('gives a clip the same id wherever it sits in the catalog', () => {
    const a = catalogEntry();
    const b = catalogEntry({ start_seconds: '10', end_seconds: '20', title: 'Other' });
    const root = tmp();
    fs.mkdirSync(path.join(root, 'public', 'clips'), { recursive: true });
    const file = path.join(root, 'public', 'clips', 'clips_catalog.json');
    fs.writeFileSync(file, JSON.stringify([a, b]));
    const first = catalogClipsForRelease(root, '20260916_1aJbdEmBBvrKX').clips.map(c => c.clipId);
    fs.writeFileSync(file, JSON.stringify([b, a]));
    const second = catalogClipsForRelease(root, '20260916_1aJbdEmBBvrKX').clips.map(c => c.clipId);
    expect(first).toHaveLength(2);
    expect(new Set(second)).toEqual(new Set(first));
    expect(catalogClipId(a)).not.toBe(catalogClipId(b));
    expect(catalogClipId(a)).toMatch(/^cat_[0-9a-f]{12}$/);
  });
});

const project = (): ScriptProject => ({
  id: 'prj_test', title: 'T', createdAt: 1, updatedAt: 1, format: 'investigative', sourceTags: [], targetRuntimeSec: 600,
  transcriptHashes: {}, speakerNames: {}, clips: [], excludedClips: [], headVersionId: null,
  evidenceDocs: [{ id: 'doc1', name: 'DMs July', content: 'July 15, 9:02 PM\nAngela: I will ruin   every single person\nthat he cares about.', addedAt: 1 }],
});

describe('pinned document sources', () => {
  it('pins an exact excerpt (whitespace may differ) and rejects words not in the document', () => {
    const store = createScriptStore(tmp());
    const p = project();
    store.saveProject(p);
    let n = 0;
    const board = addBoardSource(store, p, { docId: 'doc1', excerpt: 'I will ruin every single person that he cares about.' }, () => `src_${++n}`);
    expect(board.sources).toHaveLength(1);
    expect(board.sources[0].label).toContain('DMs July');
    expect(() => addBoardSource(store, p, { docId: 'doc1', excerpt: 'I will destroy everyone' }, () => 'x')).toThrow(/word for word/);
    expect(() => addBoardSource(store, p, { docId: 'nope', excerpt: 'July 15' }, () => 'x')).toThrow(/Unknown document/);
    // Pinning the same words again does not duplicate them.
    expect(addBoardSource(store, p, { docId: 'doc1', excerpt: 'I will ruin every single person that he cares about.' }, () => 'dup').sources).toHaveLength(1);
    expect(removeBoardSource(store, p, 'src_1').sources).toHaveLength(0);
  });
  it('matches loosely only on whitespace', () => {
    expect(containsLoose('a  b\nc', 'a b c')).toBe(true);
    expect(containsLoose('a b c', 'a c')).toBe(false);
    expect(containsLoose('a b c', '  ')).toBe(false);
  });
});

describe('code gate for claims that cite a document source', () => {
  const segments = (verbatim: string): Segment[] => [{ id: 'seg1', title: 'S', scenes: [{ id: 'sc1', title: 'Scene', purpose: 'p', blocks: [
    { id: 'b1', kind: 'narration', text: 'In a written message, according to the screenshots, Angela said she would ruin everyone he cared about.', mode: 'polished',
      claims: [{ releaseTag: '', segStart: 0, segEnd: 0, speaker: 'Document: DMs July', verbatim, quoteId: 'src_1', sourceId: 'src_1' }] },
  ] }] }];
  const ctx = { baseline: [], transcripts: {}, clipsById: {}, targetRuntimeSec: 600, format: 'investigative' as const, docSources: { src_1: 'I will ruin every single person that he cares about.' } };
  it('passes words that are in the pinned excerpt', () => {
    const g = codeGates(segments('ruin every single person'), ctx);
    expect(g.failures.filter(f => /document source/.test(f))).toEqual([]);
    expect(g.factual).toBe('pass');
  });
  it('fails words that are not in the pinned excerpt, or a source that was unpinned', () => {
    expect(codeGates(segments('destroy everyone'), ctx).factual).toBe('fail');
    expect(codeGates(segments('ruin every single person'), { ...ctx, docSources: {} }).factual).toBe('fail');
  });
});

describe('project rule sheet', () => {
  it('goes ahead of the shared rules and is omitted when empty', () => {
    expect(withCharter({ charter: '  ' }, '- shared')).toBe('- shared');
    const text = withCharter({ charter: 'Never narrate what Angela says on tape.' }, '- shared');
    expect(text.indexOf('Never narrate')).toBeLessThan(text.indexOf('- shared'));
    expect(text).toMatch(/override/);
  });
});
