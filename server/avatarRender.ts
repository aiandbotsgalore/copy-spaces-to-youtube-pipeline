import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type AvatarRenderRequest = {
  personaId: 'logan-master' | 'cyber-hologram' | 'doc-anchor';
  backdropId: 'neon-studio' | 'broadcast-room' | 'midnight-study' | 'transparent-alpha';
  cameraAngle: 'front' | 'three-quarter' | 'cinematic';
  aspectRatio: '16-9' | '9-16' | '1-1';
  lipSyncTightness: number;
  headSwayAmplitude: number;
  eyeGazeMode: 'camera' | 'wandering' | 'notes';
  blinkRate: number;
  microExpressionScale: number;
  showMeshOverlay: boolean;
  showPipExhibit: boolean;
};

const PERSONAS = new Set<AvatarRenderRequest['personaId']>(['logan-master', 'cyber-hologram', 'doc-anchor']);
const BACKDROPS = new Set<AvatarRenderRequest['backdropId']>(['neon-studio', 'broadcast-room', 'midnight-study', 'transparent-alpha']);
const CAMERA_ANGLES = new Set<AvatarRenderRequest['cameraAngle']>(['front', 'three-quarter', 'cinematic']);
const ASPECT_RATIOS = new Set<AvatarRenderRequest['aspectRatio']>(['16-9', '9-16', '1-1']);
const GAZE_MODES = new Set<AvatarRenderRequest['eyeGazeMode']>(['camera', 'wandering', 'notes']);

const DEFAULT_REQUEST: AvatarRenderRequest = {
  personaId: 'logan-master',
  backdropId: 'neon-studio',
  cameraAngle: 'front',
  aspectRatio: '16-9',
  lipSyncTightness: 96,
  headSwayAmplitude: 45,
  eyeGazeMode: 'camera',
  blinkRate: 14,
  microExpressionScale: 70,
  showMeshOverlay: false,
  showPipExhibit: true,
};

export class AvatarRenderInputError extends Error {
  statusCode = 400;
}

const asString = (value: unknown, fallback: string): string => (
  typeof value === 'string' && value.trim() ? value.trim() : fallback
);

const asNumber = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const asBoolean = (value: unknown, fallback: boolean): boolean => (
  typeof value === 'boolean' ? value : fallback
);

function enumValue<T extends string>(value: unknown, fallback: T, allowed: Set<T>, field: string): T {
  const candidate = asString(value, fallback) as T;
  if (!allowed.has(candidate)) {
    throw new AvatarRenderInputError(`${field} must be one of: ${Array.from(allowed).join(', ')}.`);
  }
  return candidate;
}

/** Normalize UI state once at the API boundary so every downstream renderer receives the same contract. */
export function normalizeAvatarRenderRequest(input: unknown): AvatarRenderRequest {
  const body = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  return {
    personaId: enumValue(body.personaId, DEFAULT_REQUEST.personaId, PERSONAS, 'personaId'),
    backdropId: enumValue(body.backdropId, DEFAULT_REQUEST.backdropId, BACKDROPS, 'backdropId'),
    cameraAngle: enumValue(body.cameraAngle, DEFAULT_REQUEST.cameraAngle, CAMERA_ANGLES, 'cameraAngle'),
    aspectRatio: enumValue(body.aspectRatio, DEFAULT_REQUEST.aspectRatio, ASPECT_RATIOS, 'aspectRatio'),
    lipSyncTightness: asNumber(body.lipSyncTightness, DEFAULT_REQUEST.lipSyncTightness, 80, 100),
    headSwayAmplitude: asNumber(body.headSwayAmplitude, DEFAULT_REQUEST.headSwayAmplitude, 10, 90),
    eyeGazeMode: enumValue(body.eyeGazeMode, DEFAULT_REQUEST.eyeGazeMode, GAZE_MODES, 'eyeGazeMode'),
    blinkRate: asNumber(body.blinkRate, DEFAULT_REQUEST.blinkRate, 6, 26),
    microExpressionScale: asNumber(body.microExpressionScale, DEFAULT_REQUEST.microExpressionScale, 20, 100),
    showMeshOverlay: asBoolean(body.showMeshOverlay, DEFAULT_REQUEST.showMeshOverlay),
    showPipExhibit: asBoolean(body.showPipExhibit, DEFAULT_REQUEST.showPipExhibit),
  };
}

function readJsonBody(req: any, maxBytes = 1024 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on('data', (chunk: Buffer | string) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBytes) fail(new AvatarRenderInputError('Avatar render payload is too large.'));
      else chunks.push(buffer);
    });
    req.on('error', fail);
    req.on('end', () => {
      if (settled) return;
      try {
        const raw = Buffer.concat(chunks).toString('utf-8').trim();
        const parsed = raw ? JSON.parse(raw) : {};
        settled = true;
        resolve(parsed);
      } catch {
        fail(new AvatarRenderInputError('Avatar render payload must be valid JSON.'));
      }
    });
  });
}

function sendJson(res: any, statusCode: number, body: Record<string, unknown>): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

async function runFfmpeg(args: string[], cwd: string): Promise<void> {
  try {
    await execFileAsync('ffmpeg', args, { cwd, maxBuffer: 2 * 1024 * 1024 });
  } catch (error: any) {
    const detail = String(error?.stderr || error?.message || 'FFmpeg failed').trim().slice(-1200);
    throw new Error(`Local avatar renderer failed: ${detail}`);
  }
}

async function probeDuration(file: string, cwd: string): Promise<number | null> {
  try {
    const result = await execFileAsync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', file,
    ], { cwd, maxBuffer: 64 * 1024 });
    const duration = Number(result.stdout.trim());
    return Number.isFinite(duration) && duration > 0 ? duration : null;
  } catch {
    return null;
  }
}

function resolutionFor(aspectRatio: AvatarRenderRequest['aspectRatio']): { width: number; height: number; label: string } {
  if (aspectRatio === '9-16') return { width: 1080, height: 1920, label: '1080x1920' };
  if (aspectRatio === '1-1') return { width: 1080, height: 1080, label: '1080x1080' };
  return { width: 1920, height: 1080, label: '1920x1080' };
}

function avatarAssetFor(personaId: AvatarRenderRequest['personaId'], rootDir: string): string {
  const candidates = personaId === 'cyber-hologram'
    ? ['public/avatars/speaker_4.jpg', 'public/avatars/logan.jpg']
    : personaId === 'doc-anchor'
      ? ['public/avatars/speaker_3.jpg', 'public/avatars/logan.jpg']
      : ['public/avatars/logan.jpg'];
  const found = candidates.find(candidate => fs.existsSync(path.resolve(rootDir, candidate)));
  if (!found) throw new Error('No avatar portrait is available under public/avatars.');
  return path.resolve(rootDir, found);
}

async function renderLocalFallback(request: AvatarRenderRequest, rootDir: string) {
  const jobId = `job_avatar_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const resolution = resolutionFor(request.aspectRatio);
  const outDir = path.resolve(rootDir, 'public/output/episodes');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${jobId}.mp4`);
  const avatarPath = avatarAssetFor(request.personaId, rootDir);
  const audioPath = path.resolve(rootDir, 'public/speaker_samples/Logan/master_reference.wav');
  if (!fs.existsSync(audioPath)) throw new Error('The local reference audio is missing: public/speaker_samples/Logan/master_reference.wav');

  const swayPixels = Math.round(request.headSwayAmplitude * 2.4);
  const zoom = request.cameraAngle === 'cinematic' ? 1.12 : request.cameraAngle === 'three-quarter' ? 1.08 : 1.04;
  const xOffset = request.cameraAngle === 'three-quarter' ? Math.round(resolution.width * 0.06) : 0;
  const yOffset = request.eyeGazeMode === 'notes' ? Math.round(resolution.height * 0.02) : 0;
  const pipOpacity = request.showPipExhibit ? 0.85 : 0;
  const meshOpacity = request.showMeshOverlay ? 0.25 : 0;
  const filter = [
    `[0:v]scale=${resolution.width}:${resolution.height}:force_original_aspect_ratio=increase,crop=${resolution.width}:${resolution.height},`,
    `zoompan=z='min(zoom+0.001,${zoom.toFixed(3)})':d=1:x='iw/2-(iw/zoom/2)+sin(on/18)*${swayPixels + xOffset}':y='ih/2-(ih/zoom/2)+cos(on/22)*${Math.round(swayPixels * 0.4) + yOffset}':s=${resolution.width}x${resolution.height}:fps=30,`,
    `drawbox=y=${Math.floor(resolution.height * 0.72)}:w=${resolution.width}:h=${Math.floor(resolution.height * 0.25)}:color=0x020617@0.88:t=fill,`,
    `drawbox=x=0:y=0:w=${resolution.width}:h=${resolution.height}:color=0x8b5cf6@${meshOpacity.toFixed(2)}:t=8,`,
    `drawbox=x=${Math.round(resolution.width * 0.72)}:y=${Math.round(resolution.height * 0.04)}:w=${Math.round(resolution.width * 0.24)}:h=${Math.round(resolution.height * 0.14)}:color=0x0f172a@${pipOpacity.toFixed(2)}:t=fill[v]`,
  ].join('');

  await runFfmpeg([
    '-y', '-loop', '1', '-i', avatarPath, '-i', audioPath,
    '-filter_complex', filter, '-map', '[v]', '-map', '1:a',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'fast', '-crf', '22',
    '-r', '30', '-c:a', 'aac', '-b:a', '192k', '-shortest', outFile,
  ], rootDir);

  const durationSec = await probeDuration(outFile, rootDir);
  if (!fs.existsSync(outFile) || fs.statSync(outFile).size < 1024) {
    throw new Error('FFmpeg returned without a usable avatar MP4.');
  }
  const metadataFile = path.join(outDir, `${jobId}.json`);
  fs.writeFileSync(metadataFile, JSON.stringify({ jobId, request, engine: 'FFmpeg-local-fallback', durationSec }, null, 2));
  return {
    status: 'success',
    renderMode: 'local-fallback',
    warning: 'The configured neural renderer was unavailable; this preview used the local compositor.',
    jobId,
    resolution: resolution.label,
    fps: 30,
    durationSec,
    videoUrl: `/output/episodes/${jobId}.mp4`,
    metadataUrl: `/output/episodes/${jobId}.json`,
    appliedParameters: request,
  };
}

export function createAvatarRenderHandler(options: { rootDir: string; getEnv: () => NodeJS.ProcessEnv }) {
  return async (req: any, res: any) => {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Use POST /api/avatar/render.' });
      return;
    }

    try {
      const input = await readJsonBody(req);
      const request = normalizeAvatarRenderRequest(input);
      const env = options.getEnv();
      const avatarApiUrl = env.AVATAR_API_URL || env.LIVEPORTRAIT_API_URL;

      if (avatarApiUrl) {
        try {
          const upstream = await fetch(`${avatarApiUrl.replace(/\/$/, '')}/render`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(request),
            signal: AbortSignal.timeout(120_000),
          });
          const raw = await upstream.text();
          let data: any = {};
          try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
          if (upstream.ok && typeof data.jobId === 'string' && typeof data.videoUrl === 'string') {
            sendJson(res, 200, { ...data, appliedParameters: request, renderMode: data.renderMode || 'neural-upstream' });
            return;
          }
          const reason = typeof data.message === 'string' ? data.message : `upstream returned HTTP ${upstream.status}`;
          if (env.AVATAR_ALLOW_LOCAL_FALLBACK === '0') {
            sendJson(res, 502, { ok: false, code: 'AVATAR_UPSTREAM_FAILED', message: `Avatar renderer failed: ${reason}` });
            return;
          }
          const fallback = await renderLocalFallback(request, options.rootDir);
          sendJson(res, 200, { ...fallback, warning: `Neural renderer failed (${reason}). ${fallback.warning}` });
          return;
        } catch (error: any) {
          if (env.AVATAR_ALLOW_LOCAL_FALLBACK === '0') {
            sendJson(res, 502, { ok: false, code: 'AVATAR_UPSTREAM_UNREACHABLE', message: `Avatar renderer is unreachable: ${error?.message || 'unknown error'}` });
            return;
          }
          const fallback = await renderLocalFallback(request, options.rootDir);
          sendJson(res, 200, { ...fallback, warning: `Neural renderer was unreachable. ${fallback.warning}` });
          return;
        }
      }

      sendJson(res, 200, await renderLocalFallback(request, options.rootDir));
    } catch (error: any) {
      const statusCode = error instanceof AvatarRenderInputError ? error.statusCode : 500;
      sendJson(res, statusCode, {
        ok: false,
        code: statusCode === 400 ? 'INVALID_AVATAR_REQUEST' : 'AVATAR_RENDER_FAILED',
        message: error?.message || 'Avatar render failed.',
      });
    }
  };
}

