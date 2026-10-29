/**
 * Phase 1 acceptance and data checks, on a temporary copy of .spacepipe-studio (the AQ master file,
 * transcripts and public/clips/angela are read through links and checked unchanged afterwards).
 *
 * - all 283 AQ quotes visible with their original corpus records (35 fields)
 * - master md5 3ff45f905a859d04779bc7578de2c96d and public/clips/angela unchanged
 * - every quote located, or flagged unlocated with a reason
 * - the 116 corpus cut points preserved exactly, marked as corpus supplied (not independently checked)
 * - starring one quote in two projects stores it once; other projects' files unchanged
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseCutSec } from '../../server/quoteCorpus';
import { changedPaths, md5File, REPO, removeTempRoot, startStudio, STUDIO, tempStudioRoot, treeHashes } from './helpers';

const MASTER = path.join(REPO, 'docs', 'documentary', 'data', 'angela_quotes_master.json');
const MASTER_MD5 = '3ff45f905a859d04779bc7578de2c96d';
const CLIPS = path.join(REPO, 'public', 'clips', 'angela');
const master = JSON.parse(fs.readFileSync(MASTER, 'utf8')) as any[];

const clipsBefore = treeHashes(CLIPS);
const liveBefore = treeHashes(STUDIO);
let root = '';
let studio: Awaited<ReturnType<typeof startStudio>>;
let entries: any[] = [];

beforeAll(async () => {
  expect(md5File(MASTER)).toBe(MASTER_MD5);
  root = tempStudioRoot();
  studio = await startStudio(root);
});
afterAll(() => { studio?.close(); if (root) removeTempRoot(root); });

describe('Phase 1 acceptance', () => {
  it('imports the corpus and shows all 283 quotes with their original corpus records', async () => {
    const r = await studio.api('GET', '/library');
    expect(r.status).toBe(200);
    entries = r.json.entries;
    console.log('sync', JSON.stringify(r.json.sync));
    expect(entries).toHaveLength(283);
    for (const q of master) {
      const e = entries.find(x => x.aqId === q.quote_id);
      expect(e, q.quote_id).toBeTruthy();
      expect(e.corpus).toEqual(q);
      expect(Object.keys(e.corpus)).toHaveLength(35);
    }
  });

  it('locates every quote, or flags it unlocated with a reason', () => {
    const by: Record<string, number> = {};
    for (const e of entries) {
      by[e.link.text.status] = (by[e.link.text.status] || 0) + 1;
      if (e.link.text.status === 'unlocated') {
        expect(e.link.text.note, e.aqId).toBeTruthy();
        expect(e.link.utteranceIds).toEqual([]);
        console.log(`unlocated ${e.aqId}: ${e.link.text.note}`);
      } else {
        expect(e.link.utteranceIds.length, e.aqId).toBeGreaterThan(0);
        if (e.link.text.status === 'differs') expect(e.link.text.transcriptSpan, e.aqId).toBeTruthy();
      }
    }
    console.log('text checks', JSON.stringify(by));
  });

  it('preserves the 116 corpus cut points exactly, as corpus supplied audio', () => {
    const cut = master.filter(q => q.needs_audio_alignment === false);
    expect(cut).toHaveLength(116);
    for (const q of cut) {
      const e = entries.find(x => x.aqId === q.quote_id);
      expect(e.link.audio, q.quote_id).toEqual({ status: 'verified', source: 'corpus_cut', startSec: parseCutSec(q.cut_in), endSec: parseCutSec(q.cut_out) });
      if (typeof q.cut_in === 'number') expect(e.link.audio.startSec).toBe(q.cut_in);
      if (typeof q.cut_out === 'number') expect(e.link.audio.endSec).toBe(q.cut_out);
      expect(e.corpus.cut_in).toBe(q.cut_in);
      expect(e.corpus.cut_out).toBe(q.cut_out);
    }
    const rest = entries.filter(e => !cut.some(q => q.quote_id === e.aqId));
    expect(rest).toHaveLength(167);
    for (const e of rest) expect(e.link.audio.status, e.aqId).toBe('none');
  });

  it('data check: corpus cut points sit on the located utterances', () => {
    const off: string[] = [];
    for (const e of entries) {
      const a = e.link.audio;
      if (a.source !== 'corpus_cut' || e.link.text.status === 'unlocated') continue;
      if (a.endSec < e.link.segStart - 2 || a.startSec > e.link.segEnd + 2) off.push(`${e.aqId} cut ${a.startSec}-${a.endSec}s, located ${e.link.segStart}-${e.link.segEnd}s`);
    }
    console.log(`cut points outside the located utterances (+-2 s): ${off.length}`);
    for (const o of off) console.log(`  ${o}`);
    // Each one is shown as a warning beside the quote; the corpus values stay as they are.
    const warned = entries.filter(e => e.warnings.some((w: string) => /Corpus cut points/.test(w))).length;
    expect(warned).toBe(off.length);
  });

  it('data check: existing WAVs are linked', () => {
    const linked = entries.filter(e => e.clipFile);
    console.log(`WAV links: ${linked.length} (${linked.filter(e => e.clipFile.from === 'master').length} from the master file, ${linked.filter(e => e.clipFile.from === 'manifest').length} from the manifest)`);
    for (const e of linked) expect(fs.existsSync(path.join(CLIPS, e.clipFile.filename)), e.clipFile.filename).toBe(true);
    expect(linked.length).toBe(108);
  });

  it('starring one quote in two projects stores it once and leaves other projects unchanged', async () => {
    const projects = (await studio.api('GET', '/projects')).json.projects as any[];
    const [a, b] = projects.filter(p => !/ZZ AUDIT/.test(p.title)).length >= 2 ? projects.filter(p => !/ZZ AUDIT/.test(p.title)) : projects;
    const libDir = path.join(root, '.spacepipe-studio', 'library');
    const before = treeHashes(path.join(root, '.spacepipe-studio'));
    for (const p of [a, b]) {
      const r = await studio.api('POST', '/board/item', { projectId: p.id, ref: 'aq:AQ-0031', starred: true });
      expect(r.status).toBe(200);
    }
    const changed = changedPaths(before, treeHashes(path.join(root, '.spacepipe-studio')));
    expect(changed).toEqual([`projects/${a.id}/board.json`, `projects/${b.id}/board.json`].sort());
    const holders = fs.readdirSync(libDir).filter(f => fs.readFileSync(path.join(libDir, f), 'utf8').includes('"AQ-0031"'));
    expect(holders).toHaveLength(1);
    for (const p of [a, b]) {
      const board = (await studio.api('GET', `/board?projectId=${p.id}`)).json.board;
      expect(board.items).toEqual([{ ref: 'aq:AQ-0031', starred: true, addedAt: expect.any(Number) }]);
    }
  });

  it('left the master file, the Angela clips and the live studio folder untouched', () => {
    expect(md5File(MASTER)).toBe(MASTER_MD5);
    expect(changedPaths(clipsBefore, treeHashes(CLIPS))).toEqual([]);
    expect(changedPaths(liveBefore, treeHashes(STUDIO))).toEqual([]);
  });
});
