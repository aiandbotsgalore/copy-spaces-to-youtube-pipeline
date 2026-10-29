import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createDirectorMiddleware } from './server/directorMiddleware';
import { AUDIO_PROXY_PATH, createAudioProxy } from './server/audioProxy';
import { searchTranscriptLexical } from './server/transcriptSearchService';
import { createVoxSynthesizeHandler } from './server/voxSynthesize';
import { createScriptStudioMiddleware } from './server/scriptStudioMiddleware';
import { createOutputStatic } from './server/serveFile';
import { createAvatarRenderHandler } from './server/avatarRender';

function setupProxyMiddlewares(middlewares: any, env?: any) {
  if (env) {
    if (env.HF_TOKEN && !process.env.HF_TOKEN) process.env.HF_TOKEN = env.HF_TOKEN;
    if (env.HF_BACKUP_TOKEN && !process.env.HF_BACKUP_TOKEN) process.env.HF_BACKUP_TOKEN = env.HF_BACKUP_TOKEN;
    if (env.VOXCPM_SPACE && !process.env.VOXCPM_SPACE) process.env.VOXCPM_SPACE = env.VOXCPM_SPACE;
  }
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
      const contentType = upstreamRes.headers.get('content-type') || 'text/plain; charset=utf-8';
      res.setHeader('Content-Type', contentType);
      const contentLength = upstreamRes.headers.get('content-length');
      if (contentLength) res.setHeader('Content-Length', contentLength);
      if (!upstreamRes.body) return res.end();
      const { Readable } = await import('node:stream');
      Readable.fromWeb(upstreamRes.body as any)
        .on('error', () => { if (!res.headersSent) res.statusCode = 502; res.destroy(); })
        .pipe(res);
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


  // VoxCPM-2 Speech Synthesis & Voice Cloning API (server/voxSynthesize.ts). Fails honestly; no substitute voice.
  middlewares.use('/api/vox/synthesize', createVoxSynthesizeHandler({ rootDir: __dirname, getEnv: () => process.env }));

  // Neural Video Avatar & LivePortrait Render API. Request validation and
  // renderer failures live in one async handler so the UI never receives a
  // false success after a rejected FFmpeg process.
  middlewares.use('/api/avatar/render', createAvatarRenderHandler({
    rootDir: __dirname,
    getEnv: () => ({ ...process.env, ...env }),
  }));
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  // AI Prompt Director API. Reads .env.local per request (server-side only; the key never reaches the client bundle).
  const director = createDirectorMiddleware({ getEnv: () => loadEnv(mode, '.', '') });
  const audioProxy = createAudioProxy({ allowRemote: () => loadEnv(mode, '.', '').DIRECTOR_ALLOW_REMOTE === '1' });
  // Script Studio API (server/scriptStudioMiddleware.ts). State lives in .spacepipe-studio/ (watch-ignored).
  // Created only when a dev or preview server starts (not for builds or tests), because creating it marks
  // runs left 'running' by a previous server as 'interrupted'.
  let scriptStudioInstance: ReturnType<typeof createScriptStudioMiddleware> | null = null;
  const scriptStudio = (req: any, res: any) => {
    scriptStudioInstance ??= createScriptStudioMiddleware({ root: __dirname, getEnv: () => ({ ...process.env, ...loadEnv(mode, '.', '') }) });
    return scriptStudioInstance(req, res);
  };
  return {
    base: './',
    server: {
      port: 5000,
      host: '0.0.0.0',
      allowedHosts: true,
      // The app's own writes (Script Studio state, Vox takes) must never trigger HMR or a server restart.
      watch: {
        ignored: ['**/.spacepipe-studio/**', '**/.spacepipe-studio-backups/**', '**/public/output/**'],
      },
    },
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'github-asset-proxy',
        configureServer(server) {
          setupProxyMiddlewares(server.middlewares, env);
        },
        configurePreviewServer(server) {
          setupProxyMiddlewares(server.middlewares, env);
        },
      },
      {
        name: 'montage-director',
        configureServer(server) {
          server.middlewares.use('/api/montage/direct', director);
          server.middlewares.use(AUDIO_PROXY_PATH, audioProxy);
          server.middlewares.use('/api/script', scriptStudio);
          // public/output is watch-ignored, so files written while the server runs (Vox takes) are served from disk here.
          server.middlewares.use('/output', createOutputStatic(__dirname));
        },
        configurePreviewServer(server) {
          server.middlewares.use('/api/montage/direct', director);
          server.middlewares.use(AUDIO_PROXY_PATH, audioProxy);
          server.middlewares.use('/api/script', scriptStudio);
          // public/output is watch-ignored, so files written while the server runs (Vox takes) are served from disk here.
          server.middlewares.use('/output', createOutputStatic(__dirname));
        },
      }
    ],
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
