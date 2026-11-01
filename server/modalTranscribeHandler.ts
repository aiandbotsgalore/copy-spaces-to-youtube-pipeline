import path from 'path';
import fs from 'fs';
import type { IncomingMessage, ServerResponse } from 'http';

const DEFAULT_MODAL_ENDPOINT = 'https://blackreceiptemail--spacepipe-transcribe-transcribe-endpoint.us-east.modal.run';

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

export function createModalTranscribeHandler(options: { rootDir: string; getEnv: () => NodeJS.ProcessEnv }) {
  const { rootDir, getEnv } = options;

  return async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'POST') {
      send(res, 405, { error: 'Method not allowed. Use POST.' });
      return;
    }

    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      const rawBody = Buffer.concat(chunks).toString('utf-8');
      const body = rawBody ? JSON.parse(rawBody) : {};

      const { releaseTag, audioUrl, audioBase64, title, hostHandle } = body;
      if (!audioUrl && !audioBase64 && !releaseTag) {
        send(res, 400, { error: 'Provide at least releaseTag, audioUrl, or audioBase64.' });
        return;
      }

      const env = getEnv();
      const endpoint = env.MODAL_TRANSCRIBE_URL || DEFAULT_MODAL_ENDPOINT;

      // Load local voice profiles if available
      let enrolledProfiles = undefined;
      const vpFile = path.resolve(rootDir, 'voice_profiles.json');
      if (fs.existsSync(vpFile)) {
        try {
          const vpData = JSON.parse(fs.readFileSync(vpFile, 'utf-8'));
          enrolledProfiles = vpData.profiles;
        } catch {
          // ignore
        }
      }

      const payload = {
        title: title || releaseTag || 'Twitter Space',
        release_tag: releaseTag || '',
        host_handle: hostHandle || '',
        audio_url: audioUrl,
        audio_base64: audioBase64,
        enrolled_profiles: enrolledProfiles,
      };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(3_600_000), // 1 hour max
      });

      if (!response.ok) {
        const text = await response.text();
        send(res, response.status, { error: `Modal Transcribe returned HTTP ${response.status}: ${text.slice(0, 500)}` });
        return;
      }

      const result = await response.json();

      // If releaseTag provided, sync to local public/transcripts/
      if (releaseTag) {
        try {
          const epDir = path.resolve(rootDir, 'public', 'transcripts', 'episodes');
          fs.mkdirSync(epDir, { recursive: true });
          const epFile = path.join(epDir, `${releaseTag}.json`);
          fs.writeFileSync(epFile, JSON.stringify({
            release_tag: releaseTag,
            title: title || releaseTag,
            audio_url: audioUrl || '',
            duration_sec: result.duration_sec || 0,
            speakers: result.speakers || [],
            segments: result.segments || []
          }, null, 2), 'utf-8');

          // Update summary
          const summaryPath = path.resolve(rootDir, 'public', 'transcripts', 'episodes_summary.json');
          let summaries: any[] = [];
          if (fs.existsSync(summaryPath)) {
            try {
              summaries = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
            } catch {
              summaries = [];
            }
          }
          const existingIdx = summaries.findIndex((s: any) => s.release_tag === releaseTag);
          const entry = {
            release_tag: releaseTag,
            title: title || releaseTag,
            audio_url: audioUrl || '',
            segment_count: result.segments?.length || 0,
            duration_sec: result.duration_sec || 0,
            speakers: result.speakers || []
          };
          if (existingIdx >= 0) {
            summaries[existingIdx] = { ...summaries[existingIdx], ...entry };
          } else {
            summaries.push(entry);
          }
          fs.writeFileSync(summaryPath, JSON.stringify(summaries, null, 2), 'utf-8');
        } catch (syncErr) {
          console.warn('[Modal Transcribe] Local sync warning:', syncErr);
        }
      }

      send(res, 200, { ok: true, data: result });
    } catch (err: any) {
      send(res, 500, { error: err?.message || 'Modal transcription failed.' });
    }
  };
}
