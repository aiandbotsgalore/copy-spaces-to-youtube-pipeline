import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { apostropheAlternate, createAudioProxy, isAllowedAudioUrl, isAllowedAudioHost } from '../../server/audioProxy';
import { needsAudioProxy, toFetchableUrl } from '../audioUrl';

const bytes = (n: number) => new Uint8Array(Array.from({ length: n }, (_, i) => i % 251));

function mkFetch(routes: Record<string, () => Response>, log: { url: string; headers: any; method: string }[] = []): typeof fetch {
  return (async (input: any, init: any) => {
    const url = String(input);
    log.push({ url, headers: init?.headers, method: init?.method });
    const r = routes[url];
    return r ? r() : new Response('nope', { status: 404 });
  }) as any;
}

let server: http.Server | null = null;
async function serve(fetchImpl: typeof fetch) {
  const proxy = createAudioProxy({ fetchImpl });
  server = http.createServer((req, res) => void proxy(req, res));
  await new Promise<void>(r => server!.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
afterEach(async () => {
  if (server) await new Promise(r => server!.close(r));
  server = null;
});

const GH = 'https://github.com/o/r/releases/download/t/clip.mp3';
const CDN = 'https://release-assets.githubusercontent.com/abc/clip.mp3?sig=1';

describe('host allowlist', () => {
  it('allows only github.com and githubusercontent.com over https', () => {
    expect(isAllowedAudioHost('github.com')).toBe(true);
    expect(isAllowedAudioHost('objects.githubusercontent.com')).toBe(true);
    expect(isAllowedAudioHost('evilgithub.com')).toBe(false);
    expect(isAllowedAudioHost('github.com.evil.io')).toBe(false);
    expect(isAllowedAudioUrl(new URL('http://github.com/x'))).toBe(false);
    expect(isAllowedAudioUrl(new URL('https://user:pw@github.com/x'))).toBe(false);
    expect(isAllowedAudioUrl(new URL('https://169.254.169.254/latest'))).toBe(false);
    expect(isAllowedAudioUrl(new URL('https://localhost/x'))).toBe(false);
  });
  it('rewrites apostrophes the way GitHub stores them', () => {
    expect(apostropheAlternate('https://github.com/o/r/releases/download/t/I_Don%27t_Like.mp3')).toBe('https://github.com/o/r/releases/download/t/I_Don.t_Like.mp3');
    expect(apostropheAlternate("https://github.com/o/r/releases/download/t/That's.mp3")).toBe('https://github.com/o/r/releases/download/t/That.s.mp3');
    expect(apostropheAlternate(GH)).toBeNull();
  });
});

describe('client routing', () => {
  it('proxies cross-origin GitHub URLs only', () => {
    expect(needsAudioProxy(GH, 'http://localhost:5000')).toBe(true);
    expect(needsAudioProxy(CDN, 'http://localhost:5000')).toBe(true);
    expect(needsAudioProxy('clips/angela/a.wav', 'http://localhost:5000')).toBe(false);
    expect(needsAudioProxy('blob:http://localhost:5000/xyz', 'http://localhost:5000')).toBe(false);
    expect(needsAudioProxy('https://example.com/a.mp3', 'http://localhost:5000')).toBe(false);
    expect(toFetchableUrl(GH, 'http://localhost:5000')).toBe('/api/montage/audio?url=' + encodeURIComponent(GH));
  });
});

describe('proxy', () => {
  it('follows a redirect to the CDN and streams the bytes with range headers', async () => {
    const log: any[] = [];
    const base = await serve(
      mkFetch(
        {
          [GH]: () => new Response(null, { status: 302, headers: { location: CDN } }),
          [CDN]: () => new Response(bytes(1000), { status: 200, headers: { 'content-type': 'audio/mpeg', 'content-length': '1000' } }),
        },
        log
      )
    );
    const r = await fetch(`${base}/?url=${encodeURIComponent(GH)}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('audio/mpeg');
    expect(r.headers.get('accept-ranges')).toBe('bytes');
    expect(new Uint8Array(await r.arrayBuffer()).length).toBe(1000);
    expect(log.map(l => l.url)).toEqual([GH, CDN]);
  });

  it('passes a Range request upstream and relays 206', async () => {
    const log: any[] = [];
    const base = await serve(
      mkFetch({ [GH]: () => new Response(bytes(256), { status: 206, headers: { 'content-range': 'bytes 0-255/9999', 'content-type': 'audio/mpeg' } }) }, log)
    );
    const r = await fetch(`${base}/?url=${encodeURIComponent(GH)}`, { headers: { Range: 'bytes=0-255' } });
    expect(r.status).toBe(206);
    expect(r.headers.get('content-range')).toBe('bytes 0-255/9999');
    expect(log[0].headers.Range).toBe('bytes=0-255');
    await r.arrayBuffer();
  });

  it('retries with the dotted name when GitHub 404s an apostrophe URL', async () => {
    const bad = 'https://github.com/o/r/releases/download/t/I_Don%27t.mp3';
    const good = 'https://github.com/o/r/releases/download/t/I_Don.t.mp3';
    const base = await serve(mkFetch({ [good]: () => new Response(bytes(10), { status: 200, headers: { 'content-type': 'audio/mpeg' } }) }));
    const r = await fetch(`${base}/?url=${encodeURIComponent(bad)}`);
    expect(r.status).toBe(200);
    expect((await r.arrayBuffer()).byteLength).toBe(10);
  });

  it('keeps the original 404 when there is no alternate', async () => {
    const base = await serve(mkFetch({}));
    const r = await fetch(`${base}/?url=${encodeURIComponent(GH)}`);
    expect(r.status).toBe(404);
    await r.arrayBuffer();
  });

  it('refuses other hosts, plain http, and redirects that leave the allowlist', async () => {
    const log: any[] = [];
    const base = await serve(
      mkFetch({ [GH]: () => new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/latest/meta-data' } }) }, log)
    );
    for (const target of ['https://example.com/a.mp3', 'http://github.com/a.mp3', 'https://127.0.0.1:22/x']) {
      const r = await fetch(`${base}/?url=${encodeURIComponent(target)}`);
      expect(r.status).toBe(403);
      await r.text();
    }
    const r = await fetch(`${base}/?url=${encodeURIComponent(GH)}`);
    expect(r.status).toBe(403);
    await r.text();
    expect(log.map(l => l.url)).toEqual([GH]); // never contacted the redirect target
  });

  it('rejects missing url and non-GET methods, and does not forward cookies or auth', async () => {
    const log: any[] = [];
    const base = await serve(mkFetch({ [GH]: () => new Response(bytes(4), { status: 200 }) }, log));
    expect((await fetch(`${base}/`)).status).toBe(400);
    expect((await fetch(`${base}/?url=${encodeURIComponent(GH)}`, { method: 'POST' })).status).toBe(405);
    const r = await fetch(`${base}/?url=${encodeURIComponent(GH)}`, { headers: { Cookie: 'a=b', Authorization: 'Bearer secret' } });
    await r.arrayBuffer();
    expect(Object.keys(log[0].headers).map(k => k.toLowerCase()).sort()).toEqual(['user-agent']);
  });
});
