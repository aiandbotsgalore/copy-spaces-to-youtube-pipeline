/**
 * Phase 4 audio routes end to end over HTTP on a real transcript: Vox previews (the synthesis process and
 * its duration probe are injected; a second test uses real ffmpeg and ffprobe when they are installed),
 * the spoken-audio critique through the injected CLI runner, and saved renders served back with ranges.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fixtureTranscriptPath } from './helpers/transcriptFixtures';
import http from 'node:http';
import child_process from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { createScriptStudioMiddleware } from '../../server/scriptStudioMiddleware';
import { defaultProbeDurationAsync, type AsyncSynth } from '../../server/voxSynthesize';
import { parseWavHeader } from '../../server/scriptAudioService';
import { FULL_EPISODE_URL, makeFakeCli, releaseResponse, type CliCall, type Responder } from './helpers/fakeCli';
import { buildManifest, compileScript } from '../scriptCompile';
import { takeTextHash } from '../scriptAudio';

const TAG = '20260826_1AxRnZYBVdrxl';
const SRC = fixtureTranscriptPath(TAG);   // frozen copy, never the live transcript
const LINE1 = 'Then the cake arrives, and Oor cannot stop talking about it.';
const LINE2 = 'And that was the cake.';

let root = '';
let server: http.Server;
let base = '';
let mw: ReturnType<typeof createScriptStudioMiddleware>;
const calls: CliCall[] = [];
const synthCalls: { text: string; speaker: string; space?: string }[] = [];
let failNext: any = null;
let realAudio = false;
const ffmpegCalls: string[][] = [];

const hasFfmpeg = (() => { try { child_process.execFileSync('ffmpeg', ['-version'], { stdio: 'pipe' }); child_process.execFileSync('ffprobe', ['-version'], { stdio: 'pipe' }); return true; } catch { return false; } })();

const synth: AsyncSynth = async ({ text, speaker, outFullPath, env }) => {
  synthCalls.push({ text, speaker, space: env.VOXCPM_SPACE });
  if (failNext) { const e = failNext; failNext = null; throw e; }
  const sec = Math.max(1, text.split(/\s+/).length / 2.5);
  if (realAudio) child_process.execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=220:duration=${sec}`, '-codec:a', 'libmp3lame', outFullPath]);
  else fs.writeFileSync(outFullPath, Buffer.from(`take:${sec}`));
};
const probe = async (full: string) => {
  if (realAudio) return defaultProbeDurationAsync(full);
  const m = /^take:([\d.]+)$/.exec(fs.readFileSync(full, 'utf8'));
  return m ? Number(m[1]) : null;
};
let spokenPrompt = '';
const responder: Responder = (kind, prompt) => {
  if (kind === 'critique') {
    spokenPrompt = prompt;
    const id = /"sceneId":"([A-Za-z0-9_]+)"/.exec(prompt)?.[1];
    return { critiques: [{ targetId: id, issue: 'The handoff into the clip is abrupt.', consequence: 'The laugh lands early.', criterion: 'pacing', severity: 'minor', proposedFix: 'Add a short pause.' }] };
  }
  throw new Error(`unexpected ${kind}`);
};

async function api(method: string, route: string, body?: unknown) {
  const r = await fetch(`${base}${route}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json() as any };
}
function wav(sec: number, rate = 8000): Buffer {
  const n = Math.round(sec * rate);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8, 'ascii'); b.write('fmt ', 12, 'ascii');
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36, 'ascii'); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin(i / 10)), 44 + i * 2);
  return b;
}

let projectId = '';
let versionId = '';

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-audio-'));
  fs.mkdirSync(path.join(root, 'public', 'transcripts', 'episodes'), { recursive: true });
  fs.copyFileSync(SRC, path.join(root, 'public', 'transcripts', 'episodes', `${TAG}.json`));
  mw = createScriptStudioMiddleware({
    root, getEnv: () => ({ PATH: '/bin' }), runner: makeFakeCli(responder, calls), synth, probe,
    ffmpeg: async args => { ffmpegCalls.push(args); fs.writeFileSync(args[args.length - 1], wav(Number(args[args.indexOf('-t') + 1]), 8000)); },
    fetchImpl: (async (url: any) => { if (/api\.github\.com/.test(String(url))) return releaseResponse(); throw new Error(`unexpected fetch ${url}`); }) as typeof fetch,
    resolveOverride: async name => ({ ok: true, file: `/usr/local/bin/${name}`, prefixArgs: [], via: 'path', found: `/usr/local/bin/${name}` }),
  });
  server = http.createServer((req, res) => { req.url = (req.url || '').replace(/^\/api\/script/, '') || '/'; void mw(req, res); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/script`;

  const p = await api('POST', '/project', { releaseTag: TAG, targetRuntimeSec: 60 });
  projectId = p.json.project.id;
  const add = await api('POST', '/project/add-clip', { id: projectId, fromId: 'u92', toId: 'u93' });
  const clip = add.json.clip;
  expect(clip).toMatchObject({ audioUrl: FULL_EPISODE_URL, audioOffsetSec: 1207.94 });
  const segments = [{ id: 'seg_a', title: 'Open', scenes: [
    { id: 'sc_a', title: 'Cake', purpose: 'hook', blocks: [
      { id: 'b_n1', kind: 'narration', text: LINE1, mode: 'live', claims: [], takeUrl: '/output/vox/forged.mp3', takeSec: 99, takeTextHash: takeTextHash(LINE1) },
      { id: 'b_p', kind: 'pause', sec: 0.5 },
      { id: 'b_c', kind: 'clip', clipId: clip.clipId, keptText: 'Delicious.', inSec: 0, outSec: Math.min(5, clip.durationSec), trimBasis: 'full', fn: 'breather', rationale: '' },
      { id: 'b_m', kind: 'music', cue: 'sting', note: 'after the laugh' },
    ] },
    { id: 'sc_b', title: 'Close', purpose: 'end', blocks: [
      { id: 'b_n2', kind: 'narration', text: LINE2, mode: 'live', claims: [] },
      { id: 'b_n3', kind: 'narration', text: `  ${LINE2} `, mode: 'live', claims: [] },
    ] },
  ] }];
  const v = await api('POST', '/version', { projectId, parentId: null, segments, label: 'Edit' });
  expect(v.status).toBe(200);
  versionId = v.json.version.id;
  // A take URL sent by the client is never trusted: take fields come only from the take index.
  expect(v.json.version.segments[0].scenes[0].blocks[0].takeUrl).toBeUndefined();
});
afterAll(() => { server?.close(); });

describe('Vox previews', () => {
  it('refuses the spoken critique before any take exists', async () => {
    const r = await api('POST', '/refine', { projectId, spoken: true });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('NO_TAKES');
  });

  it('speaks one scene, then the rest, reusing cached and duplicate lines', async () => {
    const one = await api('POST', '/preview', { projectId, sceneId: 'sc_b' });
    expect(one.status).toBe(202);
    expect(one.json.job).toMatchObject({ state: 'running', total: 1, sceneId: 'sc_b' });
    await mw.audio.idle();
    expect((await api('GET', `/preview?projectId=${projectId}`)).json.job).toMatchObject({ state: 'finished', done: 1, synthesized: 1, cached: 0 });
    expect(synthCalls).toEqual([{ text: LINE2, speaker: 'Logan', space: 'loganblack0/voxcpm-voice-clone' }]);

    await api('POST', '/preview', { projectId });
    await mw.audio.idle();
    expect((await api('GET', `/preview?projectId=${projectId}`)).json.job).toMatchObject({ state: 'finished', total: 2, cached: 1, synthesized: 1 });
    expect(synthCalls).toHaveLength(2);

    const file = path.join(root, 'public', 'output', 'vox', `take_${takeTextHash(LINE1)}.mp3`);
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readdirSync(path.dirname(file)).filter(f => f.includes('.tmp'))).toEqual([]);

    const proj = (await api('GET', `/project?id=${projectId}`)).json;
    const blocks = proj.head.segments[0].scenes.flatMap((s: any) => s.blocks);
    const n1 = blocks.find((b: any) => b.id === 'b_n1');
    expect(n1).toMatchObject({ takeUrl: `/output/vox/take_${takeTextHash(LINE1)}.mp3`, takeTextHash: takeTextHash(LINE1) });
    expect(n1.takeSec).toBeCloseTo(LINE1.split(/\s+/).length / 2.5, 5);
    expect(blocks.find((b: any) => b.id === 'b_n3').takeUrl).toBe(blocks.find((b: any) => b.id === 'b_n2').takeUrl);
    // the stored version file is untouched; takes are attached on read
    expect(JSON.stringify(mw.store.getVersion(projectId, versionId))).not.toContain('take_');
  });

  it('reports Vox unavailable with the real reason and stops at the first failure', async () => {
    const saved = await api('POST', '/version', { projectId, parentId: versionId, label: 'More', segments: [{ id: 'seg_a', title: 'Open', scenes: [{ id: 'sc_x', title: 'X', purpose: '', blocks: [
      { id: 'x1', kind: 'narration', text: 'A brand new line one.', mode: 'live', claims: [] },
      { id: 'x2', kind: 'narration', text: 'A brand new line two.', mode: 'live', claims: [] },
    ] }] }] });
    failNext = Object.assign(new Error('Command failed'), { code: 3, stderr: '[!] ZeroGPU quota/limit hit. Exiting immediately for fast fallback.' });
    const before = synthCalls.length;
    await api('POST', '/preview', { projectId });
    await mw.audio.idle();
    const job = (await api('GET', `/preview?projectId=${projectId}`)).json.job;
    expect(job.state).toBe('failed');
    expect(job.unavailable).toMatch(/^Vox unavailable: The ZeroGPU quota of the Hugging Face Space is used up/);
    expect(job.failures).toEqual([{ blockId: 'x1', message: expect.stringContaining('ZeroGPU') }]);
    expect(synthCalls.length - before).toBe(1);
    const head = (await api('GET', `/project?id=${projectId}`)).json.head;
    expect(head.segments[0].scenes[0].blocks.every((b: any) => !b.takeUrl)).toBe(true);
    // back to the previewed version
    await api('POST', '/head', { projectId, versionId });
    expect(saved.status).toBe(200);
  });

  it.skipIf(!hasFfmpeg)('measures a real mp3 take with ffprobe', async () => {
    realAudio = true;
    try {
      const saved = await api('POST', '/version', { projectId, parentId: versionId, label: 'Real', segments: [{ id: 'seg_r', title: 'R', scenes: [{ id: 'sc_r', title: 'R', purpose: '', blocks: [
        { id: 'r1', kind: 'narration', text: 'Five words in this line.', mode: 'live', claims: [] },
      ] }] }] });
      await api('POST', '/preview', { projectId });
      await mw.audio.idle();
      const head = (await api('GET', `/project?id=${projectId}`)).json.head;
      expect(head.segments[0].scenes[0].blocks[0].takeSec).toBeGreaterThan(1.9);
      expect(head.segments[0].scenes[0].blocks[0].takeSec).toBeLessThan(2.2);
      await api('POST', '/head', { projectId, versionId });
      expect(saved.status).toBe(200);
    } finally { realAudio = false; }
  });
});

describe('spoken critique', () => {
  it('critiques with measured lengths and local pacing notes', async () => {
    const start = await api('POST', '/refine', { projectId, spoken: true, critiqueOnly: true });
    expect(start.status).toBe(202);
    for (let i = 0; i < 300 && mw.engine.isActive(start.json.runId); i++) await new Promise(r => setTimeout(r, 10));
    const run = (await api('GET', `/run?projectId=${projectId}&runId=${start.json.runId}`)).json.run;
    expect(run.status).toBe('finished');
    expect(run.options).toMatchObject({ spoken: true, episodePass: false });
    expect(run.critiques[0].issue).toMatch(/handoff/);
    expect(spokenPrompt).toContain('as SPOKEN audio');
    expect(spokenPrompt).toContain('"durationSource":"vox"');
    expect(spokenPrompt).toContain('"durationSource":"clip"');
    expect(spokenPrompt).toContain('2 narration lines in this scene open with "and that".');
    const log = mw.store.readLog(start.json.runId) as any[];
    expect(log.some(e => e.promptVersion === 'critique-spoken.v2')).toBe(true);
  });
});

describe('transcript cuts', () => {
  it('cuts only the clip window out of the full recording, once, and serves it as WAV', async () => {
    const proj = (await api('GET', `/project?id=${projectId}`)).json.project;
    const clip = proj.clips.find((c: any) => c.clipId.startsWith('tr_'));
    const url = `${base}/clip-audio?projectId=${projectId}&clipId=${clip.clipId}`;
    const [a, b] = await Promise.all([fetch(url), fetch(url, { headers: { Range: 'bytes=0-43' } })]);
    expect(a.status).toBe(200);
    expect(a.headers.get('content-type')).toBe('audio/wav');
    expect(b.status).toBe(206);
    expect(parseWavHeader(Buffer.from(await b.arrayBuffer()))).toMatchObject({ sampleRate: 8000 });
    expect(ffmpegCalls).toHaveLength(1);
    expect(ffmpegCalls[0]).toEqual(['-nostdin', '-loglevel', 'error', '-y', '-ss', '1207.94', '-i', FULL_EPISODE_URL, '-t', String(clip.durationSec), '-vn', '-acodec', 'pcm_s16le', '-f', 'wav', expect.stringMatching(/\.tmp\.wav$/)]);
    await fetch(url);
    expect(ffmpegCalls).toHaveLength(1);
    expect((await fetch(`${base}/clip-audio?projectId=${projectId}&clipId=nope`)).status).toBe(404);
  });
});

describe('renders', () => {
  it('saves the finished episode with its manifest and serves it back with byte ranges', async () => {
    const proj = (await api('GET', `/project?id=${projectId}`)).json;
    const compiled = compileScript(proj.project, proj.head, { clipAudioUrl: id => `/api/script/clip-audio?projectId=${projectId}&clipId=${id}` });
    expect(compiled.ok).toBe(true);
    expect(compiled.markers).toHaveLength(1);
    const manifest = buildManifest(proj.project, proj.head, compiled, Date.now());

    const early = await fetch(`${base}/render/audio?projectId=${projectId}&versionId=${versionId}`, { method: 'PUT', headers: { 'Content-Type': 'audio/wav' }, body: wav(0.1) });
    expect(early.status).toBe(409);
    const bad = await api('POST', '/render', { projectId, versionId, manifest: { ...manifest, versionId: 'v_other' } });
    expect(bad.status).toBe(400);
    const m = await api('POST', '/render', { projectId, versionId, manifest });
    expect(m.json.render.status).toBe('pending');

    const notWav = await fetch(`${base}/render/audio?projectId=${projectId}&versionId=${versionId}`, { method: 'PUT', headers: { 'Content-Type': 'audio/wav' }, body: Buffer.from('not a wav file at all, just text, long enough to pass the size check of forty-four bytes') });
    expect(notWav.status).toBe(400);

    const body = wav(manifest.totalSec);
    const up = await fetch(`${base}/render/audio?projectId=${projectId}&versionId=${versionId}`, { method: 'PUT', headers: { 'Content-Type': 'audio/wav' }, body });
    const saved = (await up.json() as any).render;
    expect(saved.status).toBe('complete');
    expect(saved.audio).toMatchObject({ bytes: body.length, sampleRate: 8000, channels: 1 });
    expect(saved.audio.durationSec).toBeCloseTo(manifest.totalSec, 2);
    expect(fs.existsSync(path.join(root, '.spacepipe-studio', 'projects', projectId, 'renders', `${versionId}.wav`))).toBe(true);

    const list = (await api('GET', `/renders?projectId=${projectId}`)).json.renders;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ versionId, status: 'complete', items: 4, musicMarkers: 1 });

    const ranged = await fetch(`${base}/render/audio?projectId=${projectId}&versionId=${versionId}`, { headers: { Range: 'bytes=0-43' } });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('content-range')).toBe(`bytes 0-43/${body.length}`);
    const head = Buffer.from(await ranged.arrayBuffer());
    expect(parseWavHeader(head)).toMatchObject({ sampleRate: 8000, channels: 1 });
    const full = await fetch(`${base}/render/audio?projectId=${projectId}&versionId=${versionId}`);
    expect(full.headers.get('content-type')).toBe('audio/wav');
    expect(Buffer.from(await full.arrayBuffer()).equals(body)).toBe(true);

    const man = await api('GET', `/render/manifest?projectId=${projectId}&versionId=${versionId}`);
    expect(man.json.kind).toBe('spacepipe-script-render');
    expect(man.json.musicMarkers[0]).toMatchObject({ cue: 'sting', note: 'after the laugh' });
    expect(man.json.note).toMatch(/Nothing was mixed in/);
  });
});
