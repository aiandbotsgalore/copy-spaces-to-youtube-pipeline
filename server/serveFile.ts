/**
 * Serves one file from disk with byte-range support (audio elements seek with Range requests).
 *
 * createOutputStatic() serves public/output/** straight from disk. Vite's own public-dir serving only
 * knows files it has seen through its watcher, and public/output is watch-ignored (so new Vox takes and
 * renders never reload the page), so without this, files written while the server runs would 404.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'http';

const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.mp4': 'video/mp4', '.png': 'image/png', '.jpg': 'image/jpeg', '.webm': 'video/webm',
};
export const mimeFor = (file: string) => MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';

export function serveFile(req: IncomingMessage, res: ServerResponse, full: string, contentType = mimeFor(full)) {
  const size = fs.statSync(full).size;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'no-store');
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
  if (m && (m[1] || m[2])) {
    let start = m[1] ? parseInt(m[1], 10) : size - parseInt(m[2], 10);
    let end = m[1] && m[2] ? parseInt(m[2], 10) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end || start >= size) {
      res.statusCode = 416;
      res.setHeader('Content-Range', `bytes */${size}`);
      res.end();
      return;
    }
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', String(end - start + 1));
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(full, { start, end }).pipe(res);
    return;
  }
  res.statusCode = 200;
  res.setHeader('Content-Length', String(size));
  if (req.method === 'HEAD') { res.end(); return; }
  fs.createReadStream(full).pipe(res);
}

/** Middleware for /output: files under <root>/public/output, GET and HEAD only; anything else falls through. */
export function createOutputStatic(root: string) {
  const base = path.resolve(root, 'public', 'output');
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let rel: string;
    try { rel = decodeURIComponent(new URL(req.url || '/', 'http://local').pathname); } catch { return next(); }
    const full = path.resolve(base, '.' + rel);
    if (!full.startsWith(base + path.sep)) return next();
    let st: fs.Stats;
    try { st = fs.statSync(full); } catch { return next(); }
    if (!st.isFile()) return next();
    serveFile(req, res, full);
  };
}
