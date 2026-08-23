import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 5000,
      host: '0.0.0.0',
      allowedHosts: true,
    },
    plugins: [
      react(),
      {
        name: 'github-asset-proxy',
        configureServer(server) {
          server.middlewares.use('/api/fetch-asset', async (req, res) => {
            const parsedUrl = new URL(req.url || '', 'http://localhost:5000');
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
        }
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
    }
  };
});
