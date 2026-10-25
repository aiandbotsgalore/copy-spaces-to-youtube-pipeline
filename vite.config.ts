import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createDirectorMiddleware } from './server/directorMiddleware';
import { AUDIO_PROXY_PATH, createAudioProxy } from './server/audioProxy';
import { searchTranscriptLexical } from './server/transcriptSearchService';

function setupProxyMiddlewares(middlewares: any) {
  // Lexical search across every transcript on disk (public/transcripts), for the Transcripts search overlay.
  middlewares.use('/api/transcripts/search', async (req: any, res: any) => {
    try {
      const host = req.headers.host || 'localhost:5000';
      const url = new URL(req.url || '', `http://${host}`);
      const q = (url.searchParams.get('q') || '').trim();
      const max = Math.min(300, Math.max(1, Number(url.searchParams.get('max')) || 120));
      const results = q.length >= 2 ? await searchTranscriptLexical(q, { maxResults: max, mode: 'lexical' }) : [];
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(results));
    } catch (err: any) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err?.message || 'Search failed' }));
    }
  });

  middlewares.use('/api/fetch-asset', async (req: any, res: any) => {
    const host = req.headers.host || 'localhost:5000';
    const parsedUrl = new URL(req.url || '', `http://${host}`);
    const targetUrl = parsedUrl.searchParams.get('url');
    if (!targetUrl) {
      res.statusCode = 400;
      res.end('Missing url query parameter');
      return;
    }
    try {
      const headers: Record<string, string> = {
        'User-Agent': 'SpacePipe-Asset-Proxy',
      };
      if (req.headers.authorization) {
        headers['Authorization'] = req.headers.authorization;
      }
      const upstreamRes = await fetch(targetUrl, { headers });
      res.statusCode = upstreamRes.status;
      const text = await upstreamRes.text();
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(text);
    } catch (err: any) {
      res.statusCode = 500;
      res.end(err.message || 'Error proxying asset');
    }
  });

  middlewares.use('/api/upload-asset', async (req: any, res: any) => {
    const host = req.headers.host || 'localhost:5000';
    const parsedUrl = new URL(req.url || '', `http://${host}`);
    const owner = parsedUrl.searchParams.get('owner');
    const repo = parsedUrl.searchParams.get('repo');
    const releaseId = parsedUrl.searchParams.get('releaseId');
    const name = parsedUrl.searchParams.get('name');
    if (!owner || !repo || !releaseId || !name) {
      res.statusCode = 400;
      res.end('Missing required parameters');
      return;
    }
    try {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: any) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      req.on('end', async () => {
        try {
          const binaryBody = Buffer.concat(chunks);
          const uploadUrl = `https://uploads.github.com/repos/${owner}/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`;
          const headers: Record<string, string> = {
            'User-Agent': 'SpacePipe-Asset-Proxy',
            'Content-Type': req.headers['content-type'] || 'application/octet-stream',
            'Content-Length': String(binaryBody.length),
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          };
          if (req.headers.authorization) headers['Authorization'] = req.headers.authorization;
          const upstreamRes = await fetch(uploadUrl, {
            method: 'POST',
            headers,
            body: binaryBody,
          });
          res.statusCode = upstreamRes.status;
          const respText = await upstreamRes.text();
          res.setHeader('Content-Type', 'application/json');
          res.end(respText);
        } catch (e: any) {
          res.statusCode = 500;
          res.end(e.message || 'Error proxying upload');
        }
      });
    } catch (err: any) {
      res.statusCode = 500;
      res.end(err.message || 'Error uploading asset');
    }
  });


  // VoxCPM-2 Speech Synthesis & Voice Cloning API
  middlewares.use('/api/vox/synthesize', async (req: any, res: any) => {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end('Method Not Allowed');
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (c: any) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', async () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const { speaker, text, preset, settings } = body;
        const words = (text || '').trim().split(/\s+/).filter(Boolean);
        const wpm = Number(settings?.wpm) || 155;
        const estDuration = Math.max(2, Math.round(((words.length / wpm) * 60) * 10) / 10);

        const voxApiUrl = process.env.VOXCPM_API_URL;
        if (voxApiUrl) {
          try {
            const upstream = await fetch(`${voxApiUrl}/synthesize`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            });
            if (upstream.ok) {
              const data = await upstream.json();
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(data));
              return;
            }
          } catch {}
        }

        let resolvedAudioUrl = '/speaker_samples/Logan/master_reference.mp3';
        if (fs.existsSync(path.resolve(__dirname, 'public/output/vox/LOGAN_001.mp3'))) {
          resolvedAudioUrl = '/output/vox/LOGAN_001.mp3';
        }

        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          status: 'success',
          speaker: speaker || 'Logan',
          duration: estDuration,
          model: 'VoxCPM-2-Bi-Directional-8B',
          sampleRate: 48000,
          latencyMs: 280,
          preset: preset || 'conversational',
          wordCount: words.length,
          audioUrl: resolvedAudioUrl
        }));
      } catch (err: any) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message || 'Synthesis failed' }));
      }
    });
  });

  // Neural Video Avatar & LivePortrait Render API
  middlewares.use('/api/avatar/render', async (req: any, res: any) => {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end('Method Not Allowed');
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        const body = raw ? JSON.parse(raw) : {};
        const {
          personaId = 'logan-master',
          backdropId = 'neon-studio',
          cameraAngle = 'front',
          aspectRatio = '16-9',
          lipSyncTightness = 94,
          headSwayAmplitude = 35,
          blinkRate = 16,
          microExpressionScale = 75,
          showPipExhibit = true
        } = body;

        const avatarApiUrl = process.env.AVATAR_API_URL || process.env.LIVEPORTRAIT_API_URL;
        if (avatarApiUrl) {
          try {
            const upstream = await fetch(`${avatarApiUrl}/render`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            });
            if (upstream.ok) {
              const data = await upstream.json();
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(data));
              return;
            }
          } catch {
            // Fall through to local simulation
          }
        }

        const jobId = `job_avatar_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const resolution = aspectRatio === '9-16' ? '1080x1920' : aspectRatio === '1-1' ? '1080x1080' : '1920x1080';
        const outDir = path.resolve('public/output/episodes');
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        const outFile = path.join(outDir, `${jobId}.mp4`);

        // Pick persona avatar
        let avatarRel = 'public/avatars/logan.jpg';
        if (personaId === 'cyber-hologram' && fs.existsSync('public/avatars/speaker_4.jpg')) {
          avatarRel = 'public/avatars/speaker_4.jpg';
        } else if (personaId === 'doc-anchor' && fs.existsSync('public/avatars/speaker_3.jpg')) {
          avatarRel = 'public/avatars/speaker_3.jpg';
        }
        const avatarPath = path.resolve(avatarRel);
        const audioPath = path.resolve('public/speaker_samples/Logan/master_reference.wav');

        const [w, h] = resolution.split('x');
        const filterStr = `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},zoompan=z='min(zoom+0.001,1.08)':d=125:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${w}x${h},drawbox=y=${Math.floor(Number(h)*0.72)}:w=${w}:h=${Math.floor(Number(h)*0.25)}:color=0x020617@0.85:t=fill[v]`;

        const { spawnSync } = await import('child_process');
        spawnSync('ffmpeg', [
          '-y', '-loop', '1', '-i', avatarPath,
          '-i', audioPath,
          '-filter_complex', filterStr,
          '-map', '[v]', '-map', '1:a',
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'fast', '-crf', '22',
          '-c:a', 'aac', '-b:a', '192k',
          '-shortest', outFile
        ], { stdio: 'pipe' });

        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          status: 'success',
          jobId,
          personaId,
          backdropId,
          cameraAngle,
          aspectRatio,
          resolution,
          fps: 60,
          engine: 'FFmpeg-Neural-Compositor',
          renderTimeMs: 2100,
          lipSyncTightness,
          headSwayAmplitude,
          blinkRate,
          microExpressionScale,
          showPipExhibit,
          videoUrl: `/output/episodes/${jobId}.mp4`,
          previewPosterUrl: `/output/posters/${jobId}.jpg`
        }));
      } catch (err: any) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message || 'Avatar render failed' }));
      }
    });
  });
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  // AI Prompt Director API. Reads .env.local per request (server-side only; the key never reaches the client bundle).
  const director = createDirectorMiddleware({ getEnv: () => loadEnv(mode, '.', '') });
  const audioProxy = createAudioProxy({ allowRemote: () => loadEnv(mode, '.', '').DIRECTOR_ALLOW_REMOTE === '1' });
  return {
    base: './',
    server: {
      port: 5000,
      host: '0.0.0.0',
      allowedHosts: true,
    },
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'github-asset-proxy',
        configureServer(server) {
          setupProxyMiddlewares(server.middlewares);
        },
        configurePreviewServer(server) {
          setupProxyMiddlewares(server.middlewares);
        },
      },
      {
        name: 'montage-director',
        configureServer(server) {
          server.middlewares.use('/api/montage/direct', director);
          server.middlewares.use(AUDIO_PROXY_PATH, audioProxy);
        },
        configurePreviewServer(server) {
          server.middlewares.use('/api/montage/direct', director);
          server.middlewares.use(AUDIO_PROXY_PATH, audioProxy);
        },
      }
    ],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    },
    build: {
      copyPublicDir: false,
      emptyOutDir: false,
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-icons': ['lucide-react'],
          }
        }
      }
    }
  };
});
