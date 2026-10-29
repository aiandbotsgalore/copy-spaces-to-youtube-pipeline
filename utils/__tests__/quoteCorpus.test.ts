/**
 * Phase 1: the AQ corpus adapter reads angela_quotes_master.json without ever writing it, exposes every
 * corpus field as is, and turns corpus cut points into audio boundaries marked as corpus supplied.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { aqClipFiles, corpusAudio, corpusWindow, loadAqCorpus, parseCutSec } from '../../server/quoteCorpus';

const base = {
  episode_title: 'T', episode_id: 'E', date: '2026-09-30', speaker: 'Angela', speaker_attribution_confidence: 'HIGH', source_file: 'x',
  duration: null, search_phrase: 'p', context_before: 'b', context_after: 'a', category: 'Threat', target: 'Logan', why_it_matters: 'w', recommendation: 'ESSENTIAL',
  montage_ready: false, context_warning: false, existing_master_clip: false, master_clip_filename: null, master_clip_existing_id: null, master_clip_relationship: 'NEW',
  master_clip_metadata_mismatch: false, pre_or_post_fallout: 'POST-FALLOUT', contradiction_candidate: false, related_quote_ids: [], verification_status: 'VERIFIED', notes: '',
};
const corpus = [
  { ...base, quote_id: 'AQ-0001', release_tag: 'tagA', exact_quote: 'First quote.', transcript_search_window: '00:01:00–00:04:33', source_in: null, source_out: null, cut_in: null, cut_out: null, needs_audio_alignment: true },
  { ...base, quote_id: 'AQ-0002', release_tag: 'tagA', exact_quote: 'Second quote.', transcript_search_window: '', source_in: 59.705, source_out: 64.362, cut_in: 58.205, cut_out: 65.862, needs_audio_alignment: false, master_clip_filename: '01_Evidence.wav' },
  { ...base, quote_id: 'AQ-0003', release_tag: 'tagB', exact_quote: 'Third quote.', transcript_search_window: '', source_in: '02:13:30.590', source_out: '02:13:37.390', cut_in: '02:13:30.340', cut_out: '02:13:37.890', needs_audio_alignment: false },
];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-aq-'));
  fs.mkdirSync(path.join(root, 'docs', 'documentary', 'data'), { recursive: true });
  fs.mkdirSync(path.join(root, 'public', 'clips', 'angela'), { recursive: true });
  const master = path.join(root, 'docs', 'documentary', 'data', 'angela_quotes_master.json');
  fs.writeFileSync(master, JSON.stringify(corpus, null, 2));
  fs.writeFileSync(path.join(root, 'public', 'clips', 'angela', '01_Evidence.wav'), 'RIFF');
  fs.writeFileSync(path.join(root, 'public', 'clips', 'angela', 'AQ-0003_Angela.wav'), 'RIFF');
  fs.writeFileSync(path.join(root, 'public', 'clips', 'angela', 'manifest.json'), JSON.stringify([
    { id: 'x', filename: 'AQ-0003_Angela.wav', url: 'clips/angela/AQ-0003_Angela.wav', quote_id: 'AQ-0003' },
    { id: 'y', filename: 'AQ-0009_Missing.wav', url: 'clips/angela/AQ-0009_Missing.wav', quote_id: 'AQ-0009' },
    { id: 'z', filename: 'no_id.wav', url: 'clips/angela/no_id.wav' },
  ]));
  return { root, master };
}
const md5 = (f: string) => createHash('md5').update(fs.readFileSync(f)).digest('hex');

describe('AQ corpus adapter', () => {
  it('reads every quote with every corpus field as is, and never changes the file', () => {
    const { root, master } = fixture();
    const before = md5(master);
    const mtime = fs.statSync(master).mtimeMs;
    const c = loadAqCorpus(root);
    expect(c.md5).toBe(before);
    expect(c.quotes).toEqual(corpus);
    expect(c.fields).toHaveLength(35);
    expect(c.byId.get('AQ-0003')!.cut_in).toBe('02:13:30.340');
    expect(c.tags).toEqual(['tagA', 'tagB']);
    expect(() => { (c.quotes[0] as any).exact_quote = 'changed'; }).toThrow();
    expect(md5(master)).toBe(before);
    expect(fs.statSync(master).mtimeMs).toBe(mtime);
  });

  it('parses cut points given as seconds or as HH:MM:SS.mmm', () => {
    expect(parseCutSec(58.205)).toBe(58.205);
    expect(parseCutSec('02:13:30.340')).toBe(8010.34);
    expect(parseCutSec('13:30.5')).toBe(810.5);
    expect(parseCutSec(null)).toBeNull();
    expect(parseCutSec('soon')).toBeNull();
  });

  it('marks corpus cut points as verified with source corpus_cut, preserving the values exactly', () => {
    const c = loadAqCorpus(fixture().root);
    expect(corpusAudio(c.byId.get('AQ-0002')!)).toEqual({ status: 'verified', source: 'corpus_cut', startSec: 58.205, endSec: 65.862 });
    expect(corpusAudio(c.byId.get('AQ-0003')!)).toEqual({ status: 'verified', source: 'corpus_cut', startSec: 8010.34, endSec: 8017.89 });
  });

  it('leaves quotes that need alignment without audio', () => {
    const c = loadAqCorpus(fixture().root);
    expect(corpusAudio(c.byId.get('AQ-0001')!)).toEqual({ status: 'none', reason: 'The corpus marks this quote as needing audio alignment.' });
  });

  it('gives the search window from source times, else from the corpus search window', () => {
    const c = loadAqCorpus(fixture().root);
    expect(corpusWindow(c.byId.get('AQ-0001')!)).toEqual([60, 273]);
    expect(corpusWindow(c.byId.get('AQ-0002')!)).toEqual([59.705, 64.362]);
  });

  it('links existing WAVs from the master file and the clip manifest, only when the file exists', () => {
    const files = aqClipFiles(fixture().root);
    expect(files.get('AQ-0002')).toEqual({ filename: '01_Evidence.wav', url: '/clips/angela/01_Evidence.wav', from: 'master' });
    expect(files.get('AQ-0003')).toEqual({ filename: 'AQ-0003_Angela.wav', url: '/clips/angela/AQ-0003_Angela.wav', from: 'manifest' });
    expect(files.has('AQ-0009')).toBe(false);
    expect(files.size).toBe(2);
  });
});
