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
  engine?: 'kaggle' | 'local';
  githubToken?: string;
  ownerName?: string;
  repoName?: string;
  targetReleaseTag?: string;
  latentSteps?: number;
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
    engine: body.engine === 'local' ? 'local' : 'kaggle',
    githubToken: typeof body.githubToken === 'string' ? body.githubToken.trim() : undefined,
    ownerName: typeof body.ownerName === 'string' ? body.ownerName.trim() : undefined,
    repoName: typeof body.repoName === 'string' ? body.repoName.trim() : undefined,
    targetReleaseTag: typeof body.targetReleaseTag === 'string' ? body.targetReleaseTag.trim() : undefined,
    latentSteps: typeof body.latentSteps === 'number' && Number.isFinite(body.latentSteps) ? Math.min(12, Math.max(2, Math.round(body.latentSteps))) : undefined,
    renderQuality: body.renderQuality === 'draft' ? 'draft' : 'standard',
  };
}

function readJsonBody(req: any, maxBytes = 15 * 1024 * 1024): Promise<unknown> {
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

async function resolveGitHubToken(reqToken?: string, env?: NodeJS.ProcessEnv): Promise<string> {
  if (reqToken && typeof reqToken === 'string' && reqToken.trim()) {
    return reqToken.trim().replace(/^token\s+/i, '').replace(/^bearer\s+/i, '');
  }
  if (env?.GH_TOKEN && env.GH_TOKEN.trim()) return env.GH_TOKEN.trim();
  if (env?.GITHUB_TOKEN && env.GITHUB_TOKEN.trim()) return env.GITHUB_TOKEN.trim();
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token']);
    if (stdout && stdout.trim()) return stdout.trim();
  } catch {}
  return '';
}

function resolveDispatchUrl(urlOrPath: string | undefined, owner: string, repo: string, defaultPath: string): string {
  if (!urlOrPath || !urlOrPath.trim()) {
    return `https://raw.githubusercontent.com/${owner}/${repo}/master/public/${defaultPath.replace(/^\/?(public\/)?/, '')}`;
  }
  const clean = urlOrPath.trim();
  if (/^https?:\/\//i.test(clean)) return clean;
  const relative = clean.replace(/^\/?(public\/)?/, '');
  return `https://raw.githubusercontent.com/${owner}/${repo}/master/public/${relative}`;
}

async function dispatchKaggleWorkflow(request: AvatarRenderRequest, options: { rootDir: string; getEnv: () => NodeJS.ProcessEnv }) {
  const env = options.getEnv();
  const owner = request.ownerName || env.GITHUB_OWNER || 'aiandbotsgalore';
  const repo = request.repoName || env.GITHUB_REPO || 'copy-spaces-to-youtube-pipeline';
  const token = await resolveGitHubToken(request.githubToken, env);

  const personaName = request.personaName || (request.personaId === 'logan-master' ? 'Logan Black (Master Host)' : request.personaId);
  const resolvedAvatar = resolveDispatchUrl(request.avatarUrl || request.avatarImagePath, owner, repo, 'avatars/logan.jpg');
  const resolvedAudio = resolveDispatchUrl(request.audioUrl || request.audioPath, owner, repo, 'speaker_samples/Logan/master_reference.wav');
  const ratio = request.aspectRatio === '9-16' ? '9:16' : request.aspectRatio === '1-1' ? '1:1' : '16:9';
  const targetTag = request.targetReleaseTag || 'spaces-live-stage-test-20261029';
  const dur = Math.max(5, Math.ceil(request.durationSec || 15));
  const effectiveSteps = request.latentSteps || (request.renderQuality === 'draft' ? 4 : 6);

  const payloadInputs = {
    audio_url: resolvedAudio,
    avatar_image: resolvedAvatar,
    aspect_ratio: ratio,
    layout: 'solo',
    speakers_json: JSON.stringify([personaName]),
    speaker_avatars_json: JSON.stringify({ [personaName]: resolvedAvatar }),
    speaker_segments_json: JSON.stringify([{ speaker: personaName, start: 0, end: dur }]),
    prompt: `Avatar Studio Neural Render: ${personaName}`,
    target_release_tag: targetTag,
    latent_steps: String(effectiveSteps),
  };

  let directApiError = '';
  if (token) {
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/generate_avatar_short.yml/dispatches`, {
        method: 'POST',
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'Authorization': `token ${token}`,
          'User-Agent': 'SpacePipe-Avatar-Studio',
        },
        body: JSON.stringify({
          ref: 'master',
          inputs: payloadInputs,
        }),
      });

      if (res.ok || res.status === 204) {
        return {
          ok: true,
          dispatched: true,
          status: 'dispatched',
          renderMode: 'kaggle-dual-t4',
          workflow: 'generate_avatar_short.yml',
          targetReleaseTag: targetTag,
          owner,
          repo,
          resolvedAudio,
          resolvedAvatar,
          aspectRatio: ratio,
          workflowRunsUrl: `https://github.com/${owner}/${repo}/actions/workflows/generate_avatar_short.yml`,
        };
      }
      const rawText = await res.text().catch(() => '');
      directApiError = `GitHub API HTTP ${res.status}: ${rawText}`;
      console.warn(`[AvatarRender] GitHub Actions API dispatch failed (${res.status}): ${rawText}`);
    } catch (apiErr: any) {
      directApiError = apiErr?.message || String(apiErr);
      console.warn('[AvatarRender] GitHub Actions API dispatch exception:', apiErr);
    }
  }

  // Fallback to local gh CLI if token-based direct fetch failed or token was absent
  try {
    const ghBin = findBinary('gh');
    const flags: string[] = [
      'workflow', 'run', 'generate_avatar_short.yml',
      '--repo', `${owner}/${repo}`,
      '--ref', 'master',
    ];
    for (const [k, v] of Object.entries(payloadInputs)) {
      flags.push('-f', `${k}=${v}`);
    }
    await execFileAsync(ghBin, flags, {
      env: { ...process.env, ...env, ...(token ? { GITHUB_TOKEN: token, GH_TOKEN: token } : {}) },
    });
    return {
      ok: true,
      dispatched: true,
      status: 'dispatched',
      renderMode: 'kaggle-dual-t4',
      workflow: 'generate_avatar_short.yml',
      targetReleaseTag: targetTag,
      owner,
      repo,
      resolvedAudio,
      resolvedAvatar,
      aspectRatio: ratio,
      workflowRunsUrl: `https://github.com/${owner}/${repo}/actions/workflows/generate_avatar_short.yml`,
    };
  } catch (cliErr: any) {
    const detail = cliErr?.message || String(cliErr);
    const combined = directApiError ? `${detail} (Direct API: ${directApiError})` : detail;
    throw new Error(`Failed to dispatch Kaggle workflow via GitHub Actions: ${combined}`);
  }
}

async function getKaggleWorkflowStatus(options: { rootDir: string; getEnv: () => NodeJS.ProcessEnv; owner?: string; repo?: string; token?: string; targetTag?: string; runId?: number }) {
  const env = options.getEnv();
  const owner = options.owner || env.GITHUB_OWNER || 'aiandbotsgalore';
  const repo = options.repo || env.GITHUB_REPO || 'copy-spaces-to-youtube-pipeline';
  const token = await resolveGitHubToken(options.token, env);
  const targetTag = options.targetTag || 'spaces-live-stage-test-20261029';

  let latestRun: any = null;

  if (token) {
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/generate_avatar_short.yml/runs?event=workflow_dispatch&per_page=6`, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'Authorization': `token ${token}`,
          'User-Agent': 'SpacePipe-Avatar-Studio',
        },
      });
      if (res.ok) {
        const data = await res.json();
        const runs = data.workflow_runs || [];
        if (runs.length > 0) {
          latestRun = options.runId
            ? runs.find((r: any) => r.id === options.runId)
            : runs.find((r: any) => r.status === 'in_progress' || r.status === 'queued')
              || runs.find((r: any) => r.status === 'completed' && r.conclusion === 'success')
              || runs[0];
        }
      }
    } catch {}
  }

  if (!latestRun) {
    try {
      const { stdout } = await execFileAsync('gh', [
        'run', 'list',
        '--workflow', 'generate_avatar_short.yml',
        '--repo', `${owner}/${repo}`,
        '--limit', '6',
        '--json', 'databaseId,status,conclusion,url,createdAt,updatedAt',
      ]);
      const list = JSON.parse(stdout || '[]');
      if (list.length > 0) {
        const candidate = options.runId
          ? list.find((r: any) => r.databaseId === options.runId)
          : list.find((r: any) => r.status === 'in_progress' || r.status === 'queued')
            || list.find((r: any) => r.status === 'completed' && r.conclusion === 'success')
            || list[0];
        if (candidate) {
          latestRun = {
            id: candidate.databaseId,
            status: candidate.status,
            conclusion: candidate.conclusion,
            html_url: candidate.url,
            created_at: candidate.createdAt,
            updated_at: candidate.updatedAt,
          };
        }
      }
    } catch {}
  }

  if (!latestRun) {
    return { ok: false, message: 'No Kaggle workflow runs found.' };
  }

  const runId = latestRun.id;
  const status = latestRun.status;
  const conclusion = latestRun.conclusion;
  const htmlUrl = latestRun.html_url || `https://github.com/${owner}/${repo}/actions/runs/${runId}`;

  let videoUrl = `/output/episodes/talking_avatar_short.mp4`;
  const directReleaseUrl = `https://github.com/${owner}/${repo}/releases/download/${targetTag}/talking_avatar_short.mp4`;

  if (status === 'completed' && conclusion === 'success') {
    const localOut = path.resolve(options.rootDir, 'public/output/episodes');
    const localVideo = path.join(localOut, `talking_avatar_${runId}.mp4`);
    const shortVideo = path.join(localOut, `talking_avatar_short.mp4`);

    if (fs.existsSync(localVideo)) {
      videoUrl = `/output/episodes/talking_avatar_${runId}.mp4`;
    } else if (fs.existsSync(shortVideo)) {
      videoUrl = `/output/episodes/talking_avatar_short.mp4`;
    } else {
      try {
        fs.mkdirSync(localOut, { recursive: true });
        await execFileAsync('gh', [
          'release', 'download', targetTag,
          '--repo', `${owner}/${repo}`,
          '--pattern', 'talking_avatar_short.mp4',
          '--dir', localOut,
          '--clobber',
        ]);
        if (fs.existsSync(shortVideo)) {
          fs.copyFileSync(shortVideo, localVideo);
          videoUrl = `/output/episodes/talking_avatar_${runId}.mp4`;
        }
      } catch {
        videoUrl = directReleaseUrl;
      }
    }
  }

  return {
    ok: true,
    runId,
    status,
    conclusion,
    htmlUrl,
    videoUrl,
    directReleaseUrl,
    createdAt: latestRun.created_at,
    updatedAt: latestRun.updated_at,
  };
}

export function createAvatarRenderHandler(options: { rootDir: string; getEnv: () => NodeJS.ProcessEnv }) {
  return async (req: any, res: any) => {
    const host = req.headers.host || 'localhost:5000';
    const parsedUrl = new URL(req.url || '', `http://${host}`);
    const action = parsedUrl.searchParams.get('action');

    // Handle GET or action=status for Kaggle workflow monitoring
    if (req.method === 'GET' || action === 'status') {
      try {
        const owner = parsedUrl.searchParams.get('owner') || undefined;
        const repo = parsedUrl.searchParams.get('repo') || undefined;
        const targetTag = parsedUrl.searchParams.get('targetTag') || undefined;
        const runIdParam = parsedUrl.searchParams.get('runId');
        const runId = runIdParam && Number.isFinite(Number(runIdParam)) ? Number(runIdParam) : undefined;
        const authHeader = req.headers.authorization;
        const token = authHeader ? authHeader.replace(/^token\s+/i, '').replace(/^bearer\s+/i, '') : undefined;
        const status = await getKaggleWorkflowStatus({
          rootDir: options.rootDir,
          getEnv: options.getEnv,
          owner,
          repo,
          token,
          targetTag,
          runId,
        });
        sendJson(res, 200, status);
      } catch (err: any) {
        sendJson(res, 500, { ok: false, message: err?.message || 'Failed to get Kaggle workflow status' });
      }
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

      // If user selected Kaggle Cloud GPU engine (or default when configured)
      if (request.engine === 'kaggle') {
        const dispatchResult = await dispatchKaggleWorkflow(request, options);
        sendJson(res, 200, dispatchResult);
        return;
      }

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

