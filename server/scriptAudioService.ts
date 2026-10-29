/**
 * Script Studio audio (Phase 4): Vox narration previews and saved renders of the finished episode.
 *
 *  Previews (step 15): every narration block in scope is spoken in Logan's voice through the same
 *  VoxCPM Hugging Face Space script as /api/vox/synthesize (his existing reference sample), one take at a
 *  time, spawned asynchronously so the dev server never blocks. Takes are cached by text hash in
 *  .spacepipe-studio/takes.json and written to public/output/vox/take_<hash>.mp3; durations come from
 *  ffprobe. The first failure stops the job and is reported as "Vox unavailable" with the real reason;
 *  blocks without a take keep an estimated duration marked "estimated". There is no substitute voice.
 *
 *  Renders (step 18): the browser renders the WAV with the Montage chain and uploads it here; it is saved
 *  under .spacepipe-studio/projects/<id>/renders/<versionId>.wav with its manifest and served back for
 *  the in-app player. Nothing is published or uploaded anywhere else.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import child_process from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'http';
import type { ScriptProject, ScriptVersion } from '../utils/scriptTypes';
import { narrationInScope, takeTextHash, TAKE_VOICE, type TakeRecord } from '../utils/scriptAudio';
import type { RenderManifest } from '../utils/scriptCompile';
import { StepError } from './scriptEngine';
import { serveFile } from './serveFile';
import type { ScriptStore } from './scriptStore';
import { defaultProbeDurationAsync, defaultRunHfSynthAsync, synthFailureMessage, type AsyncSynth } from './voxSynthesize';

export const VOX_MODEL = 'openbmb/VoxCPM2 (Hugging Face Space)';
export const MAX_RENDER_BYTES = 4 * 1024 ** 3;

export interface PreviewJob {
  id: string; projectId: string; versionId: string; sceneId: string | null;
  state: 'running' | 'finished' | 'failed' | 'cancelled';
  total: number; done: number; cached: number; synthesized: number;
  current: string | null;
  failures: { blockId: string; message: string }[];
  unavailable: string | null;
  startedAt: number; finishedAt: number | null;
}

/** Runs ffmpeg with an argv (no shell); rejects with the exit error and stderr. */
export type FfmpegRunner = (args: string[]) => Promise<void>;
export const defaultFfmpeg: FfmpegRunner = args => new Promise((resolve, reject) => {
  child_process.execFile('ffmpeg', args, { timeout: 10 * 60_000, maxBuffer: 8 * 1024 * 1024 }, (err, _o, stderr) => {
    if (!err) return resolve();
    (err as any).stderr = String(stderr || '');
    reject(err);
  });
});

export interface AudioServiceDeps {
  root: string;
  ffmpeg?: FfmpegRunner;
  store: ScriptStore;
  getEnv: () => Record<string, string | undefined>;
  synth?: AsyncSynth;
  probe?: (fullPath: string) => Promise<number | null>;
  now?: () => number;
}

export interface RenderInfo {
  versionId: string; createdAt: number; totalSec: number; status: 'pending' | 'complete';
  audio?: { bytes: number; durationSec: number; sampleRate: number; channels: number; savedAt: number };
  manifest: RenderManifest;
}

/** Reads the fmt and data chunks of a PCM WAV header. */
export function parseWavHeader(buf: Buffer): { sampleRate: number; channels: number; byteRate: number; dataBytes: number } | null {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let off = 12;
  let fmt: { sampleRate: number; channels: number; byteRate: number } | null = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ' && off + 24 <= buf.length) fmt = { channels: buf.readUInt16LE(off + 10), sampleRate: buf.readUInt32LE(off + 12), byteRate: buf.readUInt32LE(off + 16) };
    if (id === 'data') return fmt && fmt.byteRate > 0 ? { ...fmt, dataBytes: size } : null;
    off += 8 + size + (size % 2);
  }
  return null;
}

export function createAudioService(deps: AudioServiceDeps) {
  const now = deps.now ?? Date.now;
  const synth = deps.synth ?? defaultRunHfSynthAsync(deps.root);
  const probe = deps.probe ?? defaultProbeDurationAsync;
  const jobs = new Map<string, PreviewJob>();       // latest job per project
  const cancelled = new Set<string>();
  let queue: Promise<unknown> = Promise.resolve();  // one synthesis at a time across all projects
  const voxDir = path.join(deps.root, 'public', 'output', 'vox');

  async function synthOne(text: string, hash: string): Promise<TakeRecord> {
    fs.mkdirSync(voxDir, { recursive: true });
    const finalName = `take_${hash}.mp3`;
    const tmpFull = path.join(voxDir, `take_${hash}_${randomUUID().slice(0, 8)}.tmp.mp3`);
    const env = deps.getEnv();
    try {
      await synth({ text, speaker: TAKE_VOICE, outFullPath: tmpFull, env: { VOXCPM_SPACE: env.VOXCPM_SPACE || 'loganblack0/voxcpm-voice-clone', HF_TOKEN: env.HF_TOKEN } });
    } catch (e: any) {
      fs.rmSync(tmpFull, { force: true });
      throw new StepError('VOX_UNAVAILABLE', synthFailureMessage(e));
    }
    if (!fs.existsSync(tmpFull) || fs.statSync(tmpFull).size === 0) {
      fs.rmSync(tmpFull, { force: true });
      throw new StepError('VOX_UNAVAILABLE', 'The synthesis script finished without writing an audio file.');
    }
    const sec = await probe(tmpFull);
    if (!sec) {
      fs.rmSync(tmpFull, { force: true });
      throw new StepError('VOX_UNAVAILABLE', 'The take was written but ffprobe could not read its duration.');
    }
    fs.renameSync(tmpFull, path.join(voxDir, finalName));
    const rec: TakeRecord = { hash, url: `/output/vox/${finalName}`, sec, createdAt: now(), voice: TAKE_VOICE, model: VOX_MODEL };
    deps.store.saveTake(rec);
    return rec;
  }

  function startPreview(project: ScriptProject, version: ScriptVersion, sceneId: string | null): PreviewJob {
    const existing = jobs.get(project.id);
    if (existing && existing.state === 'running') return existing;
    const blocks = narrationInScope(version.segments, sceneId || undefined);
    if (sceneId && !version.segments.some(s => s.scenes.some(sc => sc.id === sceneId))) throw new StepError('NOT_FOUND', `Scene ${sceneId} is not in this version.`);
    const byHash = new Map<string, { text: string; blockIds: string[] }>();
    for (const b of blocks) {
      const h = takeTextHash(b.text);
      const e = byHash.get(h);
      if (e) e.blockIds.push(b.id); else byHash.set(h, { text: b.text, blockIds: [b.id] });
    }
    const job: PreviewJob = {
      id: `pv_${now().toString(36)}${randomUUID().slice(0, 6)}`, projectId: project.id, versionId: version.id, sceneId,
      state: 'running', total: byHash.size, done: 0, cached: 0, synthesized: 0, current: null, failures: [], unavailable: null,
      startedAt: now(), finishedAt: null,
    };
    jobs.set(project.id, job);
    const index = deps.store.getTakes();
    const todo: { hash: string; text: string; blockIds: string[] }[] = [];
    for (const [hash, e] of byHash) {
      if (index[hash]) { job.cached++; job.done++; } else todo.push({ hash, ...e });
    }
    const finish = (state: PreviewJob['state']) => { job.state = state; job.current = null; job.finishedAt = now(); };
    if (!todo.length) { finish('finished'); return job; }
    queue = queue.then(async () => {
      for (const t of todo) {
        if (cancelled.has(job.id)) { finish('cancelled'); return; }
        job.current = t.blockIds[0];
        try {
          await synthOne(t.text, t.hash);
          job.synthesized++;
          job.done++;
        } catch (e: any) {
          const message = e?.message || String(e);
          job.failures.push({ blockId: t.blockIds[0], message });
          job.unavailable = `Vox unavailable: ${message}`;
          finish('failed');
          return;
        }
      }
      finish('finished');
    }).catch(e => { job.unavailable = `Vox unavailable: ${e?.message || e}`; finish('failed'); });
    return job;
  }

  /* ---------------------------------------- renders ---------------------------------------- */

  const renderPaths = (projectId: string, versionId: string) => {
    const dir = deps.store.renderDir(projectId);
    return { dir, wav: path.join(dir, `${versionId}.wav`), json: path.join(dir, `${versionId}.json`) };
  };

  function saveManifest(project: ScriptProject, version: ScriptVersion, manifest: any): RenderInfo {
    if (manifest?.kind !== 'spacepipe-script-render' || manifest.projectId !== project.id || manifest.versionId !== version.id || !Array.isArray(manifest.items) || !manifest.items.length) {
      throw new StepError('BAD_REQUEST', 'The render manifest does not describe this project version.');
    }
    const p = renderPaths(project.id, version.id);
    fs.rmSync(p.wav, { force: true });
    const info: RenderInfo = { versionId: version.id, createdAt: now(), totalSec: Number(manifest.totalSec) || 0, status: 'pending', manifest };
    deps.store.writeJson(p.json, info);
    return info;
  }

  /** Streams an uploaded WAV to disk, checks its header, and completes the render record. */
  function receiveWav(req: IncomingMessage, project: ScriptProject, versionId: string): Promise<RenderInfo> {
    const p = renderPaths(project.id, versionId);
    const info = deps.store.readJson<RenderInfo>(p.json);
    if (!info) return Promise.reject(new StepError('CONFLICT', 'Send the render manifest before its audio.'));
    fs.mkdirSync(p.dir, { recursive: true });
    const tmp = `${p.wav}.${randomUUID().slice(0, 8)}.tmp`;
    return new Promise((resolve, reject) => {
      let bytes = 0;
      let head = Buffer.alloc(0);
      const out = fs.createWriteStream(tmp);
      const fail = (e: Error) => { out.destroy(); fs.rmSync(tmp, { force: true }); reject(e); };
      req.on('data', (c: Buffer) => {
        bytes += c.length;
        if (head.length < 4096) head = Buffer.concat([head, c.subarray(0, 4096 - head.length)]);
        if (bytes > MAX_RENDER_BYTES) { req.destroy(); fail(new StepError('TOO_LARGE', 'The render is larger than 4 GB.')); return; }
        if (!out.write(c)) { req.pause(); out.once('drain', () => req.resume()); }
      });
      req.on('error', e => fail(e));
      req.on('end', () => {
        out.end(() => {
          const h = parseWavHeader(head);
          if (!h) return fail(new StepError('BAD_REQUEST', 'The upload is not a PCM WAV file.'));
          try { fs.renameSync(tmp, p.wav); } catch (e: any) { return fail(e); }
          info.status = 'complete';
          info.audio = { bytes, durationSec: Math.round((Math.min(h.dataBytes, bytes - 44) / h.byteRate) * 1000) / 1000, sampleRate: h.sampleRate, channels: h.channels, savedAt: now() };
          deps.store.writeJson(p.json, info);
          resolve(info);
        });
      });
    });
  }

  function listRenders(projectId: string): RenderInfo[] {
    const dir = deps.store.renderDir(projectId);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => f.endsWith('.json'))
      .map(f => deps.store.readJson<RenderInfo>(path.join(dir, f)))
      .filter((x): x is RenderInfo => !!x && (x.status !== 'complete' || fs.existsSync(path.join(dir, `${x.versionId}.wav`))))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Serves a saved render with byte-range support so the player can seek. */
  function serveWav(req: IncomingMessage, res: ServerResponse, projectId: string, versionId: string) {
    const p = renderPaths(projectId, versionId);
    if (!fs.existsSync(p.wav)) throw new StepError('NOT_FOUND', 'No saved render for this version.');
    serveFile(req, res, p.wav, 'audio/wav');
  }

  /* ------------------------------ clips cut from a full episode ------------------------------ */

  const ffmpeg = deps.ffmpeg ?? defaultFfmpeg;
  const cutting = new Map<string, Promise<string>>();
  /**
   * A transcript cut points into the full recording (often over 100 MB). The render needs only the cut,
   * so ffmpeg reads just that window (it seeks with HTTP range requests) into a cached 16-bit WAV that
   * starts at clip time 0. Catalog clips are their own small files and are fetched directly.
   */
  function clipCut(project: ScriptProject, clipId: string): Promise<string> {
    const clip = project.clips.find(c => c.clipId === clipId);
    if (!clip) return Promise.reject(new StepError('NOT_FOUND', `Clip ${clipId} is not in this project.`));
    if (!/^https:\/\/github\.com\//.test(clip.audioUrl)) return Promise.reject(new StepError('BAD_REQUEST', `Clip ${clipId} has no GitHub release audio.`));
    return windowCut(clip.audioUrl, clip.audioOffsetSec || 0, clip.durationSec, `clip "${clip.title}"`);
  }

  /** A window of a full recording as a cached WAV (the same cache and ffmpeg call as clip cuts). */
  function windowCut(audioUrl: string, off: number, durationSec: number, label: string): Promise<string> {
    if (!/^https:\/\/github\.com\//.test(audioUrl)) return Promise.reject(new StepError('BAD_REQUEST', `No GitHub release audio for ${label}.`));
    const clip = { audioUrl, durationSec, title: label };
    const key = createHash('sha256').update(`${clip.audioUrl}|${off}|${clip.durationSec}`).digest('hex').slice(0, 16);
    const dir = path.join(deps.store.base, 'clip-cache');
    const out = path.join(dir, `${key}.wav`);
    if (fs.existsSync(out)) return Promise.resolve(out);
    const pending = cutting.get(key);
    if (pending) return pending;
    const job = (async () => {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = path.join(dir, `${key}.${randomUUID().slice(0, 8)}.tmp.wav`);
      try {
        await ffmpeg(['-nostdin', '-loglevel', 'error', '-y', '-ss', String(off), '-i', clip.audioUrl, '-t', String(clip.durationSec), '-vn', '-acodec', 'pcm_s16le', '-f', 'wav', tmp]);
      } catch (e: any) {
        fs.rmSync(tmp, { force: true });
        if (e?.code === 'ENOENT') throw new StepError('NO_FFMPEG', 'ffmpeg is not installed or not on PATH; it is needed to cut clips out of the full episode.');
        throw new StepError('UPSTREAM', `ffmpeg could not cut ${clip.title}: ${String(e?.stderr || e?.message || e).trim().slice(-400)}`);
      }
      const head = fs.existsSync(tmp) ? fs.readFileSync(tmp).subarray(0, 4096) : Buffer.alloc(0);
      if (!parseWavHeader(head)) { fs.rmSync(tmp, { force: true }); throw new StepError('UPSTREAM', `ffmpeg wrote no audio for ${clip.title}.`); }
      fs.renameSync(tmp, out);
      return out;
    })().finally(() => cutting.delete(key));
    cutting.set(key, job);
    return job;
  }

  return {
    clipCut,
    async serveClipCut(req: IncomingMessage, res: ServerResponse, project: ScriptProject, clipId: string) {
      serveFile(req, res, await clipCut(project, clipId), 'audio/wav');
    },
    async serveWindow(req: IncomingMessage, res: ServerResponse, audioUrl: string, off: number, durationSec: number, label: string) {
      serveFile(req, res, await windowCut(audioUrl, off, durationSec, label), 'audio/wav');
    },
    startPreview,
    previewJob: (projectId: string) => jobs.get(projectId) || null,
    cancelPreview(projectId: string): boolean {
      const j = jobs.get(projectId);
      if (!j || j.state !== 'running') return false;
      cancelled.add(j.id);
      return true;
    },
    /** Resolves when every queued synthesis has finished (tests). */
    idle: () => queue,
    saveManifest, receiveWav, listRenders, serveWav,
    readRender: (projectId: string, versionId: string) => deps.store.readJson<RenderInfo>(renderPaths(projectId, versionId).json),
  };
}
export type AudioService = ReturnType<typeof createAudioService>;
