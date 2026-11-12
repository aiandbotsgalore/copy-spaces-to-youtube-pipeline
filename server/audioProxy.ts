/**
 * Same-origin audio proxy for Montage Studio: GET/HEAD /api/montage/audio?url=<https url>
 *
 * Why it exists: the Web Audio player and the WAV export must fetch() the raw bytes, and github.com release
 * downloads redirect to a CDN that sends no CORS headers, so the browser blocks a direct fetch. (A plain <audio>
 * element is not subject to CORS, which is why the old player never hit this.)
 *
 * Safety: loopback only, https only, host allowlist re-checked on every redirect hop, no credentials forwarded,
 * only Range is passed upstream. It is not an open proxy.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { Readable } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';

export const AUDIO_PROXY_PATH = '/api/montage/audio';
const MAX_REDIRECTS = 5;

// In-memory cache for Content-Length and duration lookup
const contentLengthCache = new Map<string, number>();
let durationIndexCache: Map<string, number> | null = null;

export function getDurationForUrl(targetUrl: string): number | null {
  if (!durationIndexCache) {
    durationIndexCache = new Map();
    try {
      const p = path.resolve('public/transcripts/transcripts_summary_index.json');
      if (fs.existsSync(p)) {
        const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
        if (Array.isArray(raw)) {
          for (const item of raw) {
            if (item.audio_url && item.duration_sec) {
              durationIndexCache.set(item.audio_url.toLowerCase(), Number(item.duration_sec));
            }
          }
        }
      }
    } catch {}
  }
  return durationIndexCache.get(targetUrl.toLowerCase()) || null;
}

export function isAllowedAudioHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === 'github.com' ||
    h === 'githubusercontent.com' ||
    h.endsWith('.githubusercontent.com') ||
    h === 'r2.dev' ||
    h.endsWith('.r2.dev')
  );
}

export function isAllowedAudioUrl(u: URL): boolean {
  return u.protocol === 'https:' && isAllowedAudioHost(u.hostname) && !u.username && !u.password;
}

/**
 * GitHub rewrites apostrophes in release-asset names to dots ("That's" is stored as "That.s"), so a catalog URL
 * containing %27 or ' 404s. Returns the alternate spelling, or null when there is nothing to rewrite.
 */
export function apostropheAlternate(href: string): string | null {
  try {
    const u = new URL(href);
    const alt = u.pathname.replace(/%27|'/gi, '.');
    if (alt === u.pathname) return null;
    u.pathname = alt;
    return u.toString();
  } catch {
    return null;
  }
}

export interface AudioProxyDeps {
  fetchImpl?: typeof fetch;
  allowRemote?: () => boolean;
}

function text(res: ServerResponse, status: number, msg: string) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(msg);
}

async function fetchFollowing(
  start: string,
  headers: Record<string, string>,
  method: string,
  signal: AbortSignal,
  f: typeof fetch
): Promise<{ res: Response } | { error: string; status: number }> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { error: 'Bad URL.', status: 400 };
    }
    if (!isAllowedAudioUrl(parsed)) return { error: 'That host is not allowed.', status: 403 };
    const res = await f(url, { method, headers, redirect: 'manual', signal });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return { error: 'Redirect without a location.', status: 502 };
      url = new URL(loc, url).toString();
      try {
        await res.body?.cancel();
      } catch {
        /* ignore */
      }
      continue;
    }
    return { res };
  }
  return { error: 'Too many redirects.', status: 502 };
}

export function createAudioProxy(deps: AudioProxyDeps = {}) {
  const f = deps.fetchImpl ?? fetch;
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    try {
      const remote = req.socket?.remoteAddress;
      const loop = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
      if (!loop && !deps.allowRemote?.()) return text(res, 403, 'This endpoint only accepts requests from this computer.');
      if (req.method !== 'GET' && req.method !== 'HEAD') return text(res, 405, 'GET or HEAD only.');

      const host = req.headers.host || 'localhost';
      const searchParams = new URL(req.url || '', `http://${host}`).searchParams;
      const target = searchParams.get('url');
      if (!target) return text(res, 400, 'Missing url query parameter.');

      const startStr = searchParams.get('start');
      const endStr = searchParams.get('end');
      const durStr = searchParams.get('dur');

      const headers: Record<string, string> = { 'User-Agent': 'SpacePipe-Audio-Proxy' };
      const range = req.headers.range;
      if (typeof range === 'string' && /^bytes=\d*-\d*(,\s*\d*-\d*)*$/.test(range)) headers.Range = range;

      const ctl = new AbortController();
      res.on('close', () => ctl.abort());

      // If client didn't supply its own Range, but provided start and end time slices,
      // calculate exact byte boundaries to avoid downloading multi-gigabyte monolithic files.
      if (!headers.Range && startStr !== null && endStr !== null) {
        const startSec = Math.max(0, parseFloat(startStr));
        const endSec = parseFloat(endStr);
        if (Number.isFinite(startSec) && Number.isFinite(endSec) && endSec > startSec) {
          // Resolve total file bytes
          let totalBytes = contentLengthCache.get(target);
          if (!totalBytes) {
            const headHeaders = { ...headers };
            delete headHeaders.Range;
            const headAttempt = await fetchFollowing(target, headHeaders, 'HEAD', ctl.signal, f);
            if ('res' in headAttempt) {
              const cl = headAttempt.res.headers.get('content-length');
              const cr = headAttempt.res.headers.get('content-range');
              if (cr && /\/(\d+)$/.test(cr)) {
                totalBytes = parseInt(cr.split('/').pop() as string, 10);
              } else if (cl) {
                totalBytes = parseInt(cl, 10);
              }
              if (totalBytes && totalBytes > 0) contentLengthCache.set(target, totalBytes);
              try {
                await headAttempt.res.body?.cancel();
              } catch {}
            }
          }

          if (totalBytes && totalBytes > 0) {
            let totalDur = parseFloat(durStr || '0') || getDurationForUrl(target);
            if (!totalDur || totalDur <= 0) {
              totalDur = totalBytes / (128_000 / 8);
            }

            const bytesPerSec = totalBytes / totalDur;
            const preRoll = Math.max(0, startSec - 0.8);
            const postRoll = endSec + 0.8;
            const startByte = Math.max(0, Math.floor(preRoll * bytesPerSec));
            const endByte = Math.min(totalBytes - 1, Math.ceil(postRoll * bytesPerSec));

            headers.Range = `bytes=${startByte}-${endByte}`;
          }
        }
      }

      let attempt = await fetchFollowing(target, headers, req.method, ctl.signal, f);
      if ('res' in attempt && attempt.res.status === 404) {
        const alt = apostropheAlternate(target);
        if (alt) {
          const retry = await fetchFollowing(alt, headers, req.method, ctl.signal, f);
          if ('res' in retry && retry.res.ok) attempt = retry;
        }
      }
      if ('error' in attempt) return text(res, attempt.status, attempt.error);

      const up = attempt.res;
      res.statusCode = up.status;
      for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
        const v = up.headers.get(h);
        if (v) res.setHeader(h, v);
      }
      if (!up.headers.get('accept-ranges')) res.setHeader('accept-ranges', 'bytes');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      if (req.method === 'HEAD' || !up.body) return res.end();
      Readable.fromWeb(up.body as any)
        .on('error', () => res.destroy())
        .pipe(res);
    } catch (err: any) {
      if (res.headersSent) return res.destroy();
      if (err?.name === 'AbortError') return res.end();
      text(res, 502, 'Could not fetch the audio.');
    }
  };
}
