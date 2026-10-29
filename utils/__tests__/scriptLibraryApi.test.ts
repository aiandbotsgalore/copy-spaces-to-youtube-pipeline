/**
 * Phase 1 routes: the Library (every AQ quote with its corpus record and library link), speaker
 * confirmation, the project Evidence Board, and listening to a quote. No model calls.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createScriptStudioMiddleware } from '../../server/scriptStudioMiddleware';
import { makeFakeCli, type CliCall } from './helpers/fakeCli';

const TAG = '20260930_1lJQRWLvWVzxE';
const EPISODE = `https://github.com/aiandbotsgalore/copy-spaces-to-youtube-pipeline/releases/download/${TAG}/${TAG}_full.mp3`;
const q = (id: string, text: string, extra: Record<string, unknown> = {}) => ({
  quote_id: id, release_tag: TAG, exact_quote: text, speaker: 'Angela', category: 'Documentation', target: 'general audience', why_it_matters: 'w',
  source_in: null, source_out: null, cut_in: null, cut_out: null, needs_audio_alignment: true, transcript_search_window: '', master_clip_filename: null, ...extra,
});
const corpus = [
  q('AQ-0031', 'Evidence speaks for itself.', { source_in: 59.7, source_out: 64.3, cut_in: 58.205, cut_out: 65.862, needs_audio_alignment: false, master_clip_filename: '01_Evidence.wav' }),
  q('AQ-0032', 'I will keep receipts on all of it.', { source_in: 100, source_out: 104, cut_in: 99.5, cut_out: 104.5, needs_audio_alignment: false }),
  q('AQ-0033', 'Nobody believes a word of that.'),
];
function wav(sec: number, rate = 8000): Buffer {
  const n = Math.round(sec * rate);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8, 'ascii'); b.write('fmt ', 12, 'ascii');
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36, 'ascii'); b.writeUInt32LE(n * 2, 40);
  return b;
}

let root = '';
let server: http.Server;
let base = '';
let projectA = '';
let projectB = '';
const ffmpegCalls: string[][] = [];
const calls: CliCall[] = [];

async function api(method: string, route: string, body?: unknown) {
  const r = await fetch(`${base}${route}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const type = r.headers.get('content-type') || '';
  return { status: r.status, type, json: type.includes('json') ? await r.json() as any : null, bytes: type.includes('json') ? 0 : (await r.arrayBuffer()).byteLength };
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-libapi-'));
  fs.mkdirSync(path.join(root, 'docs', 'documentary', 'data'), { recursive: true });
  fs.mkdirSync(path.join(root, 'public', 'transcripts', 'episodes'), { recursive: true });
  fs.mkdirSync(path.join(root, 'public', 'clips', 'angela'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'documentary', 'data', 'angela_quotes_master.json'), JSON.stringify(corpus));
  fs.writeFileSync(path.join(root, 'public', 'clips', 'angela', '01_Evidence.wav'), wav(1));
  fs.writeFileSync(path.join(root, 'public', 'transcripts', 'episodes', `${TAG}.json`), JSON.stringify({ title: 'Social Cost', audio_url: EPISODE, segments: [
    { start: 58, end: 66, speaker: 'Speaker 1', text: 'Evidence speaks for itself, and obviously it is enough.' },
    { start: 99, end: 105, speaker: 'Speaker 1', text: 'I will keep receipts on all of it.' },
    { start: 200, end: 204, speaker: 'Speaker 2', text: 'Nobody believes a word of that, honestly.' },
  ] }));
  const mw = createScriptStudioMiddleware({
    root, getEnv: () => ({ PATH: '/bin' }), runner: makeFakeCli(() => { throw new Error('no model calls'); }, calls),
    resolveOverride: async name => ({ ok: true, file: `/usr/local/bin/${name}`, prefixArgs: [], via: 'path', found: `/usr/local/bin/${name}` }),
    ffmpeg: async args => { ffmpegCalls.push(args); fs.writeFileSync(args[args.length - 1], wav(Number(args[args.indexOf('-t') + 1]))); },
  });
  server = http.createServer((req, res) => { req.url = (req.url || '').replace(/^\/api\/script/, '') || '/'; void mw(req, res); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/script`;
  projectA = (await api('POST', '/project', { releaseTag: TAG, title: 'A' })).json.project.id;
  projectB = (await api('POST', '/project', { releaseTag: TAG, title: 'B' })).json.project.id;
});
afterAll(() => { server?.close(); });

describe('Library and Evidence Board API', () => {
  it('lists every AQ quote with its corpus record, library link and WAV', async () => {
    const r = await api('GET', '/library');
    expect(r.status).toBe(200);
    expect(r.json.sync).toMatchObject({ quotes: 3, located: 3 });
    expect(r.json.entries.map((e: any) => e.ref)).toEqual(['aq:AQ-0031', 'aq:AQ-0032', 'aq:AQ-0033']);
    const e = r.json.entries[0];
    expect(e.corpus).toEqual(corpus[0]);
    expect(e.link).toMatchObject({ utteranceIds: ['u0'], text: { status: 'exact' }, audio: { status: 'verified', source: 'corpus_cut', startSec: 58.205, endSec: 65.862 } });
    expect(e.clipFile).toEqual({ filename: '01_Evidence.wav', url: '/clips/angela/01_Evidence.wav', from: 'master' });
    expect(r.json.board).toBeNull();
  });

  it('includes the project board when asked', async () => {
    await api('POST', '/board/item', { projectId: projectA, ref: 'aq:AQ-0032', starred: true });
    const r = await api('GET', `/library?projectId=${projectA}`);
    expect(r.json.board.items).toEqual([{ ref: 'aq:AQ-0032', starred: true, addedAt: expect.any(Number) }]);
  });

  it('stars, excludes and notes per project', async () => {
    await api('POST', '/board/item', { projectId: projectB, ref: 'aq:AQ-0032', starred: true });
    const r = await api('POST', '/board/item', { projectId: projectB, ref: 'aq:AQ-0033', excluded: true, note: 'Speaker 2, not Angela.' });
    expect(r.status).toBe(200);
    expect(r.json.board.items.map((i: any) => i.ref)).toEqual(['aq:AQ-0032', 'aq:AQ-0033']);
    expect((await api('GET', `/board?projectId=${projectA}`)).json.board.items).toHaveLength(1);
    expect((await api('POST', '/board/item', { projectId: projectB, ref: 'aq:AQ-0999', starred: true })).status).toBe(400);
  });

  it('confirms a speaker once for every project', async () => {
    const r = await api('POST', '/library/speaker', { ref: 'aq:AQ-0033', name: 'Sian' });
    expect(r.json.link).toMatchObject({ speakerConfirmed: true, speakerName: 'Sian' });
    const e = (await api('GET', `/library?projectId=${projectA}`)).json.entries.find((x: any) => x.ref === 'aq:AQ-0033');
    expect(e.link.speakerName).toBe('Sian');
    expect((await api('POST', '/library/speaker', { ref: 'aq:AQ-0033', name: null })).json.link.speakerConfirmed).toBe(false);
  });

  it('plays corpus cut audio from the episode, cut only to the corpus window', async () => {
    const r = await api('GET', '/library/audio?ref=aq:AQ-0032');
    expect(r.status).toBe(200);
    expect(r.type).toBe('audio/wav');
    const args = ffmpegCalls.at(-1)!;
    expect(args[args.indexOf('-ss') + 1]).toBe('99.5');
    expect(args[args.indexOf('-t') + 1]).toBe('5');
    expect(args[args.indexOf('-i') + 1]).toBe(EPISODE);
  });

  it('plays the located transcript window for a quote without audio, only when asked for the window', async () => {
    expect((await api('GET', '/library/audio?ref=aq:AQ-0033')).status).toBe(409);
    const r = await api('GET', '/library/audio?ref=aq:AQ-0033&mode=window');
    expect(r.status).toBe(200);
    const args = ffmpegCalls.at(-1)!;
    expect(args[args.indexOf('-ss') + 1]).toBe('200');
    expect(args[args.indexOf('-t') + 1]).toBe('4');
  });
});
