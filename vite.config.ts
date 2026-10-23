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
