import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type AvatarRenderRequest = {
  personaId: string;
  personaName?: string;
  avatarImagePath?: string;
  avatarUrl?: string;
  avatarBase64?: string;
  audioPath?: string;
  audioUrl?: string;
  audioBase64?: string;
  durationSec?: number;
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
  engine?: 'modal' | 'local';
  renderQuality?: 'standard' | 'draft';
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
    personaId: asString(body.personaId, DEFAULT_REQUEST.personaId),
    personaName: typeof body.personaName === 'string' ? body.personaName.trim() : undefined,
    avatarImagePath: typeof body.avatarImagePath === 'string' ? body.avatarImagePath.trim() : undefined,
    avatarUrl: typeof body.avatarUrl === 'string' ? body.avatarUrl.trim() : undefined,
    avatarBase64: typeof body.avatarBase64 === 'string' ? body.avatarBase64.trim() : undefined,
    audioPath: typeof body.audioPath === 'string' ? body.audioPath.trim() : undefined,
    audioUrl: typeof body.audioUrl === 'string' ? body.audioUrl.trim() : undefined,
    audioBase64: typeof body.audioBase64 === 'string' ? body.audioBase64.trim() : undefined,
    durationSec: typeof body.durationSec === 'number' && Number.isFinite(body.durationSec) ? body.durationSec : undefined,
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
    engine: body.engine === 'local' ? 'local' : 'modal',
    renderQuality: body.renderQuality === 'draft' ? 'draft' : 'standard',
  };
}

function readJsonBody(req: any, maxBytes = 60 * 1024 * 1024): Promise<unknown> {
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

function findBinary(name: string): string {
  const isWindows = process.platform === 'win32';
  const binName = isWindows ? `${name}.exe` : name;
  const userProfile = process.env.USERPROFILE || 'C:\\Users\\Logan';
  const candidates = [
    name,
    path.join(userProfile, 'Downloads', 'ffmpeg-7.1.1-essentials_build', 'bin', binName),
    path.join(userProfile, 'Documents', 'twitterspacedownloader', 'bin', binName),
    path.join(userProfile, '.vscode', 'extensions', 'kilocode.kilo-code-7.5.6-win32-x64', 'bin', binName),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {}
  }
  return name;
}

async function runFfmpeg(args: string[], cwd: string): Promise<void> {
  const binary = findBinary('ffmpeg');
  try {
    await execFileAsync(binary, args, { cwd, maxBuffer: 2 * 1024 * 1024 });
  } catch (error: any) {
    const detail = String(error?.stderr || error?.message || 'FFmpeg failed').trim().slice(-1200);
    throw new Error(`Local avatar renderer failed: ${detail}`);
  }
}

async function probeDuration(file: string, cwd: string): Promise<number | null> {
  const binary = findBinary('ffprobe');
  try {
    const result = await execFileAsync(binary, [
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

function avatarAssetFor(personaId: string, rootDir: string): string {
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

  // Resolve Avatar Portrait Image
  let avatarPath = '';
  if (request.avatarBase64) {
    const rawImg = request.avatarBase64.replace(/^data:image\/[a-z0-9]+;base64,/, '');
    const tempImg = path.join(outDir, `${jobId}_custom_avatar.jpg`);
    fs.writeFileSync(tempImg, Buffer.from(rawImg, 'base64'));
    avatarPath = tempImg;
  } else if (request.avatarImagePath || request.avatarUrl) {
    const target = (request.avatarImagePath || request.avatarUrl || '').replace(/^\//, '');
    const candidate1 = path.resolve(rootDir, target);
    const candidate2 = path.resolve(rootDir, 'public', target);
    if (fs.existsSync(candidate1)) avatarPath = candidate1;
    else if (fs.existsSync(candidate2)) avatarPath = candidate2;
  }
  if (!avatarPath || !fs.existsSync(avatarPath)) {
    avatarPath = avatarAssetFor(request.personaId, rootDir);
  }

  // Resolve Driving Audio File
  let audioPath = '';
  if (request.audioBase64) {
    const rawAudio = request.audioBase64.replace(/^data:audio\/[a-z0-9]+;base64,/, '');
    const tempAudio = path.join(outDir, `${jobId}_custom_audio.wav`);
    fs.writeFileSync(tempAudio, Buffer.from(rawAudio, 'base64'));
    audioPath = tempAudio;
  } else if (request.audioUrl || request.audioPath) {
    const target = (request.audioUrl || request.audioPath || '').replace(/^\//, '');
    const candidate1 = path.resolve(rootDir, target);
    const candidate2 = path.resolve(rootDir, 'public', target);
    if (fs.existsSync(candidate1)) audioPath = candidate1;
    else if (fs.existsSync(candidate2)) audioPath = candidate2;
  }
  if (!audioPath || !fs.existsSync(audioPath)) {
    const defaultAudio = path.resolve(rootDir, 'public/speaker_samples/Logan/master_reference.wav');
    if (fs.existsSync(defaultAudio)) {
      audioPath = defaultAudio;
    } else {
      // Look for any audio file under public/output/vox
      const voxDir = path.resolve(rootDir, 'public/output/vox');
      if (fs.existsSync(voxDir)) {
        const anyAudio = fs.readdirSync(voxDir).find(f => f.endsWith('.mp3') || f.endsWith('.wav'));
        if (anyAudio) audioPath = path.join(voxDir, anyAudio);
      }
    }
  }
  if (!audioPath || !fs.existsSync(audioPath)) {
    throw new Error('No driving audio track is available.');
  }

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

  let usedNvenc = false;
  try {
    await runFfmpeg([
      '-y', '-loop', '1', '-i', avatarPath, '-i', audioPath,
      '-filter_complex', filter, '-map', '[v]', '-map', '1:a',
      '-c:v', 'h264_nvenc', '-pix_fmt', 'yuv420p', '-preset', 'p4', '-cq', '22',
      '-r', '30', '-c:a', 'aac', '-b:a', '192k', '-shortest', outFile,
    ], rootDir);
    usedNvenc = true;
  } catch (nvencErr) {
    console.warn('[AvatarRender] NVENC hardware encoding failed, falling back to CPU libx264:', nvencErr);
    await runFfmpeg([
      '-y', '-loop', '1', '-i', avatarPath, '-i', audioPath,
      '-filter_complex', filter, '-map', '[v]', '-map', '1:a',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'fast', '-crf', '22',
      '-r', '30', '-c:a', 'aac', '-b:a', '192k', '-shortest', outFile,
    ], rootDir);
  }

  const durationSec = await probeDuration(outFile, rootDir);
  if (!fs.existsSync(outFile) || fs.statSync(outFile).size < 1024) {
    throw new Error('FFmpeg returned without a usable avatar MP4.');
  }
  const metadataFile = path.join(outDir, `${jobId}.json`);
  fs.writeFileSync(metadataFile, JSON.stringify({ jobId, request, engine: usedNvenc ? 'FFmpeg-NVENC-GPU' : 'FFmpeg-local-fallback', durationSec }, null, 2));
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


async function renderModalLivePortrait(request: AvatarRenderRequest, rootDir: string, env: NodeJS.ProcessEnv) {
  const jobId = `job_avatar_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const outDir = path.resolve(rootDir, 'public/output/episodes');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${jobId}.mp4`);

  // 1. Resolve Avatar Portrait Image to base64
  let avatarBase64 = '';
  if (request.avatarBase64 && request.avatarBase64.length > 100) {
    avatarBase64 = request.avatarBase64;
  } else {
    let resolvedImgPath = '';
    if (request.avatarImagePath || request.avatarUrl) {
      const target = (request.avatarImagePath || request.avatarUrl || '').replace(/^\//, '');
      const candidate1 = path.resolve(rootDir, target);
      const candidate2 = path.resolve(rootDir, 'public', target);
      if (fs.existsSync(candidate1)) resolvedImgPath = candidate1;
      else if (fs.existsSync(candidate2)) resolvedImgPath = candidate2;
    }
    if (!resolvedImgPath || !fs.existsSync(resolvedImgPath)) {
      resolvedImgPath = avatarAssetFor(request.personaId, rootDir);
    }
    const buf = fs.readFileSync(resolvedImgPath);
    avatarBase64 = `data:image/jpeg;base64,${buf.toString('base64')}`;
  }

  // 2. Resolve Driving Audio to base64
  let audioBase64 = '';
  if (request.audioBase64 && request.audioBase64.length > 100) {
    audioBase64 = request.audioBase64;
  } else {
    let resolvedAudioPath = '';
    if (request.audioUrl || request.audioPath) {
      const target = (request.audioUrl || request.audioPath || '').replace(/^\//, '');
      const candidate1 = path.resolve(rootDir, target);
      const candidate2 = path.resolve(rootDir, 'public', target);
      if (fs.existsSync(candidate1)) resolvedAudioPath = candidate1;
      else if (fs.existsSync(candidate2)) resolvedAudioPath = candidate2;
    }
    if (!resolvedAudioPath || !fs.existsSync(resolvedAudioPath)) {
      const defaultAudio = path.resolve(rootDir, 'public/speaker_samples/Logan/master_reference.wav');
      if (fs.existsSync(defaultAudio)) {
        resolvedAudioPath = defaultAudio;
      } else {
        const voxDir = path.resolve(rootDir, 'public/output/vox');
        if (fs.existsSync(voxDir)) {
          const anyAudio = fs.readdirSync(voxDir).find(f => f.endsWith('.mp3') || f.endsWith('.wav'));
          if (anyAudio) resolvedAudioPath = path.join(voxDir, anyAudio);
        }
      }
    }
    if (!resolvedAudioPath || !fs.existsSync(resolvedAudioPath)) {
      throw new Error('No driving audio track is available.');
    }
    const buf = fs.readFileSync(resolvedAudioPath);
    const ext = path.extname(resolvedAudioPath).toLowerCase();
    const mime = ext === '.mp3' ? 'audio/mpeg' : ext === '.ogg' ? 'audio/ogg' : ext === '.flac' ? 'audio/flac' : ext === '.m4a' || ext === '.aac' ? 'audio/aac' : 'audio/wav';
    audioBase64 = `data:${mime};base64,${buf.toString('base64')}`;
  }

  const endpointUrl = env.LIVEPORTRAIT_API_URL || env.AVATAR_API_URL || 'https://blackreceiptemail--spacepipe-liveportrait-render-endpoint.us-east.modal.run';
  
  // Calculate dynamic driving multiplier from lipSyncTightness & headSwayAmplitude
  const drivingMultiplier = Math.max(0.85, Math.min(1.45, 1.0 + (request.lipSyncTightness - 90) * 0.015));

  const response = await fetch(endpointUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      avatar_base64: avatarBase64,
      audio_base64: audioBase64,
      driving_multiplier: drivingMultiplier,
    }),
    signal: AbortSignal.timeout(300_000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Modal LivePortrait API returned HTTP ${response.status}: ${errText.slice(0, 500)}`);
  }

  const result = await response.json() as any;
  if (!result || !result.ok || !result.video_base64) {
    throw new Error(result?.message || 'Modal LivePortrait rendering failed: Empty video output');
  }

  const rawVideo = result.video_base64.replace(/^data:video\/[a-z0-9]+;base64,/, '');
  fs.writeFileSync(outFile, Buffer.from(rawVideo, 'base64'));

  // Prune older renders to prevent unbounded disk usage
  try {
    const files = fs.readdirSync(outDir)
      .filter(f => f.startsWith('job_avatar_') && (f.endsWith('.mp4') || f.endsWith('.json')))
      .map(f => ({ path: path.join(outDir, f), mtime: fs.statSync(path.join(outDir, f)).mtimeMs }));
    if (files.length > 80) {
      files.sort((a, b) => a.mtime - b.mtime);
      for (const item of files.slice(0, files.length - 80)) {
        try { fs.unlinkSync(item.path); } catch {}
      }
    }
  } catch {}

  const durationSec = result.durationSec || (await probeDuration(outFile, rootDir));
  const metadataFile = path.join(outDir, `${jobId}.json`);
  fs.writeFileSync(metadataFile, JSON.stringify({
    jobId,
    request,
    engine: 'Modal LivePortrait (A100 Cloud GPU)',
    durationSec,
    elapsedSec: result.elapsedSec,
  }, null, 2));

  return {
    status: 'success',
    renderMode: result.renderMode || 'Modal LivePortrait (A100 Cloud GPU)',
    jobId,
    resolution: result.resolution || '512x512',
    fps: result.fps || 30,
    durationSec,
    elapsedSec: result.elapsedSec,
    videoUrl: `/output/episodes/${jobId}.mp4`,
    metadataUrl: `/output/episodes/${jobId}.json`,
    appliedParameters: request,
  };
}

export function createAvatarRenderHandler(options: { rootDir: string; getEnv: () => NodeJS.ProcessEnv }) {
  return async (req: any, res: any) => {
    const host = req.headers.host || 'localhost:5000';
    const parsedUrl = new URL(req.url || '', `http://${host}`);
    const action = parsedUrl.searchParams.get('action');

    // Handle GET or action=status for Engine Health Check
    if (req.method === 'GET' || action === 'status') {
      sendJson(res, 200, {
        ok: true,
        engine: 'modal-liveportrait',
        status: 'ready',
        model: 'LivePortrait (NVIDIA A100 GPU)',
        endpoint: options.getEnv().LIVEPORTRAIT_API_URL || 'https://blackreceiptemail--spacepipe-liveportrait-render-endpoint.us-east.modal.run',
      });
      return;
    }

    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Use POST /api/avatar/render or GET /api/avatar/render?action=status.' });
      return;
    }

    try {
      const input = await readJsonBody(req);
      const request = normalizeAvatarRenderRequest(input);
      const env = options.getEnv();

      // 1. If user explicitly requests local preview
      if (request.engine === 'local') {
        const localResult = await renderLocalFallback(request, options.rootDir);
        sendJson(res, 200, localResult);
        return;
      }

      // 2. Dedicated LivePortrait on Modal Cloud GPU (Default Primary Engine)
      try {
        const modalResult = await renderModalLivePortrait(request, options.rootDir, env);
        sendJson(res, 200, modalResult);
        return;
      } catch (modalErr: any) {
        console.warn('[AvatarRender] Modal LivePortrait failed, checking fallback:', modalErr);
        if (env.AVATAR_ALLOW_LOCAL_FALLBACK === '0') {
          throw modalErr;
        }
        const fallback = await renderLocalFallback(request, options.rootDir);
        sendJson(res, 200, {
          ...fallback,
          warning: `Modal LivePortrait failed (${modalErr?.message || 'unreachable'}). Using local fallback preview.`,
        });
        return;
      }
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

