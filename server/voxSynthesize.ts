/**
 * POST /api/vox/synthesize: VoxCPM-2 voice synthesis for Vox Studio.
 *
 * Order: VOXCPM_API_URL (if set) -> the Hugging Face Space through scripts/cloud_voice/synthesize_hf.py.
 * If neither produces a new file, the request fails with the real error. There is no substitute voice
 * (the old Windows SAPI fallback was removed) and no pre-recorded take is ever returned as if it were
 * synthesized from the submitted text.
 */
import path from 'path';
import fs from 'fs';
import child_process from 'child_process';
import type { IncomingMessage, ServerResponse } from 'http';

export interface VoxDeps {
  rootDir: string;
  getEnv: () => Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  /** Runs the HF Space synthesis script; must write outFullPath or throw. */
  runHfSynth?: (args: { text: string; speaker: string; outFullPath: string; env: Record<string, string | undefined> }) => void;
  /** Returns the media duration in seconds, or null when it cannot be probed. */
  probeDuration?: (fullPath: string) => number | null;
  now?: () => number;
}

export function defaultRunHfSynth(rootDir: string) {
  return ({ text, speaker, outFullPath, env }: { text: string; speaker: string; outFullPath: string; env: Record<string, string | undefined> }) => {
    const pyScript = path.resolve(rootDir, 'scripts', 'cloud_voice', 'synthesize_hf.py');
    const textB64 = Buffer.from(text, 'utf8').toString('base64');
    child_process.execFileSync('python', [pyScript, '--text-b64', textB64, '--speaker', speaker, '--out', outFullPath], {
      timeout: 90000,
      stdio: 'pipe',
      env: { ...process.env, ...env } as NodeJS.ProcessEnv,
    });
  };
}

export function defaultProbeDuration(fullPath: string): number | null {
  try {
    const out = child_process
      .execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', fullPath], { stdio: 'pipe' })
      .toString()
      .trim();
    const d = parseFloat(out);
    return Number.isFinite(d) && d > 0 ? Math.round(d * 10) / 10 : null;
  } catch {
    return null;
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export function createVoxSynthesizeHandler(deps: VoxDeps) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const runHfSynth = deps.runHfSynth ?? defaultRunHfSynth(deps.rootDir);
  const probe = deps.probeDuration ?? defaultProbeDuration;
  const now = deps.now ?? Date.now;

  return (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end('Method Not Allowed');
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (c: any) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', async () => {
      const started = now();
      let body: any;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {
        send(res, 400, { error: 'Request body is not valid JSON' });
        return;
      }
      const { speaker, text, preset } = body || {};
      const cleanText = typeof text === 'string' ? text.trim() : '';
      if (!cleanText) {
        send(res, 400, { error: 'No text to synthesize' });
        return;
      }
      const env = deps.getEnv();
      const errors: string[] = [];

      const voxApiUrl = env.VOXCPM_API_URL;
      if (voxApiUrl) {
        try {
          const upstream = await fetchImpl(`${voxApiUrl}/synthesize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (upstream.ok) {
            send(res, 200, await upstream.json());
            return;
          }
          errors.push(`VOXCPM_API_URL returned HTTP ${upstream.status}`);
        } catch (e: any) {
          errors.push(`VOXCPM_API_URL unreachable: ${e?.message || e}`);
        }
      }

      const clipId = 'take_' + now();
      const outRelPath = '/output/vox/' + clipId + '.mp3';
      const outDir = path.resolve(deps.rootDir, 'public', 'output', 'vox');
      const outFullPath = path.join(outDir, clipId + '.mp3');
      try {
        fs.mkdirSync(outDir, { recursive: true });
        runHfSynth({
          text: cleanText,
          speaker: speaker || 'Logan',
          outFullPath,
          env: { VOXCPM_SPACE: env.VOXCPM_SPACE || 'loganblack0/voxcpm-voice-clone', HF_TOKEN: env.HF_TOKEN },
        });
      } catch (e: any) {
        const stderr = e?.stderr ? String(e.stderr).trim().slice(-600) : '';
        errors.push(`Hugging Face VoxCPM synthesis failed: ${e?.message || e}${stderr ? ` (${stderr})` : ''}`);
      }
      if (!fs.existsSync(outFullPath)) {
        if (errors.length === 0) errors.push('Synthesis script finished without writing an audio file');
        send(res, 502, { error: 'Vox unavailable', details: errors });
        return;
      }

      const probed = probe(outFullPath);
      const words = cleanText.split(/\s+/).filter(Boolean);
      const wpm = Number(body?.settings?.wpm) || 155;
      const estimate = Math.max(1, Math.round((words.length / wpm) * 600) / 10);
      send(res, 200, {
        status: 'success',
        speaker: speaker || 'Logan',
        duration: probed ?? estimate,
        durationEstimated: probed == null,
        model: 'openbmb/VoxCPM2 (Hugging Face Cloud)',
        latencyMs: now() - started,
        preset: preset || 'conversational',
        wordCount: words.length,
        audioUrl: outRelPath,
      });
    });
  };
}

/* ------------------------------------------------------------------------------------------------ */
/* Async synthesis for Script Studio previews                                                         */
/* ------------------------------------------------------------------------------------------------ */

/** Writes outFullPath or rejects with the real error (exit code and the script's last stderr lines). */
export type AsyncSynth = (args: { text: string; speaker: string; outFullPath: string; env: Record<string, string | undefined> }) => Promise<void>;

/**
 * Same HF Space script as /api/vox/synthesize, but spawned asynchronously so a long take never blocks the
 * dev server. Tries `python`, then `python3` when `python` is not on PATH.
 */
export function defaultRunHfSynthAsync(rootDir: string, timeoutMs = 180_000): AsyncSynth {
  const pyScript = path.resolve(rootDir, 'scripts', 'cloud_voice', 'synthesize_hf.py');
  const runWith = (bin: string, args: string[], env: NodeJS.ProcessEnv) => new Promise<void>((resolve, reject) => {
    child_process.execFile(bin, args, { timeout: timeoutMs, env, maxBuffer: 4 * 1024 * 1024 }, (err, _stdout, stderr) => {
      if (!err) return resolve();
      const e: any = err;
      e.stderr = String(stderr || '');
      reject(e);
    });
  });
  return async ({ text, speaker, outFullPath, env }) => {
    const args = [pyScript, '--text-b64', Buffer.from(text, 'utf8').toString('base64'), '--speaker', speaker, '--out', outFullPath];
    const fullEnv = { ...process.env, ...env } as NodeJS.ProcessEnv;
    try {
      await runWith('python', args, fullEnv);
    } catch (e: any) {
      if (e?.code !== 'ENOENT') throw e;
      await runWith('python3', args, fullEnv);
    }
  };
}

/** Async ffprobe duration in seconds (rounded to 0.01), or null when it cannot be probed. */
export function defaultProbeDurationAsync(fullPath: string): Promise<number | null> {
  return new Promise(resolve => {
    child_process.execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', fullPath], { timeout: 30_000 }, (err, stdout) => {
      if (err) return resolve(null);
      const d = parseFloat(String(stdout).trim());
      resolve(Number.isFinite(d) && d > 0 ? Math.round(d * 100) / 100 : null);
    });
  });
}

/** Short, readable reason for a failed synthesis (exit 2 = HF queue full, exit 3 = ZeroGPU quota). */
export function synthFailureMessage(e: any): string {
  const stderr = e?.stderr ? String(e.stderr).trim().split('\n').slice(-3).join(' ').slice(-400) : '';
  if (e?.code === 'ENOENT') return 'Python is not installed or not on PATH.';
  if (e?.killed) return 'The Hugging Face Space did not answer in time.';
  if (e?.code === 2) return `The Hugging Face Space queue is full. ${stderr}`.trim();
  if (e?.code === 3) return `The ZeroGPU quota of the Hugging Face Space is used up. ${stderr}`.trim();
  return `${e?.message || e}${stderr && !String(e?.message || '').includes(stderr) ? ` (${stderr})` : ''}`;
}
