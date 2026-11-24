import path from 'path';
import fs from 'fs';
import child_process from 'child_process';
import type { IncomingMessage, ServerResponse } from 'http';

export interface VoiceAutoEnrollDeps {
  rootDir: string;
  getEnv?: () => Record<string, string | undefined>;
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._ -]/g, '_').trim() || 'Speaker';
}

export function createVoiceProfileAutoEnrollHandler({ rootDir, getEnv }: VoiceAutoEnrollDeps) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
      return;
    }

    try {
      const host = req.headers.host || 'localhost:5000';
      const parsedUrl = new URL(req.url || '', `http://${host}`);
      const querySpeaker = parsedUrl.searchParams.get('speaker') || '';
      const queryFilename = parsedUrl.searchParams.get('filename') || '';
      const queryRole = parsedUrl.searchParams.get('role') || '';
      const queryStart = parsedUrl.searchParams.get('start_sec');
      const queryEnd = parsedUrl.searchParams.get('end_sec');

      const contentType = (req.headers['content-type'] || '').toLowerCase();
      const chunks: Buffer[] = [];

      req.on('data', chunk => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });

      req.on('end', async () => {
        try {
          let speaker = querySpeaker;
          let filename = queryFilename;
          let role = queryRole;
          let filePath = '';
          let startSec = queryStart ? parseFloat(queryStart) : undefined;
          let endSec = queryEnd ? parseFloat(queryEnd) : undefined;

          if (contentType.includes('application/json')) {
            const rawBody = Buffer.concat(chunks).toString('utf-8');
            let jsonBody: any = {};
            if (rawBody.trim()) {
              try {
                jsonBody = JSON.parse(rawBody);
              } catch (err: any) {
                sendJson(res, 400, { ok: false, error: `Invalid JSON body: ${err.message}` });
                return;
              }
            }
            speaker = jsonBody.speaker || speaker;
            role = jsonBody.role || role;
            if (jsonBody.start_sec !== undefined) startSec = parseFloat(jsonBody.start_sec);
            if (jsonBody.end_sec !== undefined) endSec = parseFloat(jsonBody.end_sec);

            filePath = jsonBody.file || jsonBody.audio_url || '';
          }

          if (!speaker) {
            sendJson(res, 400, { ok: false, error: 'Missing speaker parameter' });
            return;
          }

          const safeSpeaker = sanitizeName(speaker);

          // If binary file was uploaded directly in request body
          if (!filePath && chunks.length > 0 && !contentType.includes('application/json')) {
            const safeFile = sanitizeName(filename || 'recording.mp3');
            const uniqueName = `${Date.now()}-${safeFile}`;
            const targetDir = path.resolve(rootDir, 'speaker_samples', safeSpeaker);
            const publicDir = path.resolve(rootDir, 'public', 'speaker_samples', safeSpeaker);

            fs.mkdirSync(targetDir, { recursive: true });
            fs.mkdirSync(publicDir, { recursive: true });

            const fullDest = path.join(targetDir, uniqueName);
            const publicDest = path.join(publicDir, uniqueName);
            const buffer = Buffer.concat(chunks);

            fs.writeFileSync(fullDest, buffer);
            fs.writeFileSync(publicDest, buffer);

            filePath = fullDest;
          }

          if (!filePath) {
            sendJson(res, 400, { ok: false, error: 'No audio file or URL provided' });
            return;
          }

          // Resolve relative paths if not an absolute path or HTTP URL
          let resolvedAudioPath = filePath;
          if (!/^https?:\/\//i.test(filePath) && !path.isAbsolute(filePath)) {
            const cleanRelative = filePath.replace(/^[/\\]+/, '');
            resolvedAudioPath = path.resolve(rootDir, cleanRelative);
          }

          const scriptPath = path.resolve(rootDir, 'scripts', 'enroll_speaker.py');
          const args = [
            scriptPath,
            '--speaker', speaker,
            '--file', resolvedAudioPath,
          ];
          if (role) args.push('--role', role);
          if (Number.isFinite(startSec)) args.push('--start_sec', String(startSec));
          if (Number.isFinite(endSec)) args.push('--end_sec', String(endSec));

          const env = getEnv ? getEnv() : {};
          const child = child_process.spawn('python', args, {
            cwd: rootDir,
            env: { ...process.env, ...env },
          });

          let stdout = '';
          let stderr = '';

          child.stdout.on('data', data => { stdout += data.toString(); });
          child.stderr.on('data', data => { stderr += data.toString(); });

          child.on('close', code => {
            if (code !== 0) {
              sendJson(res, 500, {
                ok: false,
                error: `Voice enrollment process failed (exit code ${code}): ${stderr || stdout}`,
              });
              return;
            }

            try {
              // Locate the JSON block in stdout
              const jsonStart = stdout.indexOf('{');
              const jsonEnd = stdout.lastIndexOf('}');
              if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd >= jsonStart) {
                const parsed = JSON.parse(stdout.slice(jsonStart, jsonEnd + 1));
                sendJson(res, 200, parsed);
              } else {
                sendJson(res, 200, { ok: true, raw: stdout });
              }
            } catch (err: any) {
              sendJson(res, 500, {
                ok: false,
                error: `Failed to parse enroll_speaker output: ${err.message}`,
                stdout,
                stderr,
              });
            }
          });
        } catch (err: any) {
          sendJson(res, 500, { ok: false, error: err.message || 'Auto-enroll handler error' });
        }
      });
    } catch (err: any) {
      sendJson(res, 500, { ok: false, error: err.message || 'Unexpected server error' });
    }
  };
}
