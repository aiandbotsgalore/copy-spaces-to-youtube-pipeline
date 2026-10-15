import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { createDirectorMiddleware, isLoopback, scrub, __resetGatewayMemory } from '../../server/directorMiddleware';

const ENV_KEY = 'test_env_key_1234567890abcdef';
const HEADER_KEY = 'test_header_key_0987654321fedcba';

function mkReq(o: { method?: string; url?: string; headers?: Record<string, string>; body?: unknown; remote?: string } = {}) {
  const text = o.body === undefined ? '' : typeof o.body === 'string' ? o.body : JSON.stringify(o.body);
  const r: any = Readable.from(text ? [Buffer.from(text)] : []);
  r.method = o.method || 'GET';
  r.url = o.url || '/';
  r.headers = Object.fromEntries(Object.entries(o.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  r.socket = { remoteAddress: o.remote ?? '127.0.0.1' };
  return r;
}
function mkRes() {
  const ee: any = new EventEmitter();
  ee.statusCode = 200;
  ee.headers = {};
  ee.writableEnded = false;
  ee.setHeader = (k: string, v: string) => (ee.headers[k.toLowerCase()] = v);
  ee.end = (b: string) => {
    ee.writableEnded = true;
    ee.body = b;
    ee.emit('finish');
  };
  return ee;
}
async function call(handler: any, o: Parameters<typeof mkReq>[0]) {
  const req = mkReq(o);
  const res = mkRes();
  const done = new Promise(r => res.on('finish', r));
  await handler(req, res);
  await done;
  return { status: res.statusCode as number, json: JSON.parse(res.body), raw: res.body as string };
}

type Resp = (url: string, init: any) => Response | Error | Promise<Response | Error>;
function mkFetch(queue: Resp[]) {
  const calls: Array<{ url: string; init: any; body: any }> = [];
  const fn: any = async (url: string, init: any) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : undefined });
    const next = queue.shift();
    if (!next) throw new Error('unexpected fetch call');
    const r = await next(url, init);
    if (r instanceof Error) throw r;
    return r;
  };
  fn.calls = calls;
  return fn as typeof fetch & { calls: typeof calls };
}
const chat = (content: unknown, usage = { prompt_tokens: 100, completion_tokens: 50 }) =>
  new Response(
    JSON.stringify({ model: 'claude-sonnet-5.5', choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }], usage }),
    { status: 200 }
  );
const errResp = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });

const cands = ['a', 'b', 'c', 'd'].map((id, i) => ({
  id,
  speaker: i % 2 ? 'Logan' : 'Angela',
  sourceTitle: 'Space',
  status: 'EXISTS',
  durationSec: 30,
  text: 'well you know this is the real statement that matters to everyone here',
  textTruncated: false,
}));
const genReq = (over: any = {}) => ({ mode: 'generate', cutId: 'cut_a', userPrompt: '90s record', targetWindowSec: 90, candidates: cands, ...over });
const goodCut = {
  cutId: 'cut_a',
  title: 'Chronological Record',
  tagline: 'Statements in date order.',
  picks: ['a', 'b', 'c'].map((clipId, i) => ({ clipId, keptText: null, gapAfterSec: i === 2 ? 0 : 0.35, tensionScore: 4 + i, note: 'Speaker states a position.' })),
};
const mw = (env: Record<string, string>, f: any) => createDirectorMiddleware({ getEnv: () => env, fetchImpl: f });

beforeEach(() => __resetGatewayMemory());

describe('guards and status', () => {
  it('isLoopback', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopback('192.168.1.20')).toBe(false);
    expect(isLoopback(undefined)).toBe(false);
  });

  it('rejects non-loopback callers unless DIRECTOR_ALLOW_REMOTE=1', async () => {
    const f = mkFetch([]);
    const blocked = await call(mw({ CHEAPER_INFERENCE_API_KEY: ENV_KEY }, f), { url: '/status', remote: '192.168.1.20' });
    expect(blocked.status).toBe(403);
    expect(blocked.json.code).toBe('FORBIDDEN_ORIGIN');
    const allowed = await call(mw({ CHEAPER_INFERENCE_API_KEY: ENV_KEY, DIRECTOR_ALLOW_REMOTE: '1' }, f), { url: '/status', remote: '192.168.1.20' });
    expect(allowed.status).toBe(200);
  });

  it('status reports key source and model but never the key', async () => {
    const r = await call(mw({ CHEAPER_INFERENCE_API_KEY: ENV_KEY }, mkFetch([])), { url: '/status' });
    expect(r.json).toMatchObject({ keyConfigured: true, keySource: 'env', model: 'claude-sonnet-5.5', baseUrl: 'https://api.cheaperinference.com/v1' });
    expect(r.raw).not.toContain(ENV_KEY);
    const none = await call(mw({}, mkFetch([])), { url: '/status' });
    expect(none.json).toMatchObject({ keyConfigured: false, keySource: 'none' });
  });

  it('honours DIRECTOR_MODEL and an in-request claude-* model only', async () => {
    const f = mkFetch([() => chat(goodCut), () => chat(goodCut)]);
    const h = mw({ CHEAPER_INFERENCE_API_KEY: ENV_KEY, DIRECTOR_MODEL: 'claude-opus-5' }, f);
    await call(h, { method: 'POST', url: '/', body: genReq() });
    expect(f.calls[0].body.model).toBe('claude-opus-5');
    await call(h, { method: 'POST', url: '/', body: genReq({ model: 'gpt-4o-mini' }) }); // not claude-*: ignored
    expect(f.calls[1].body.model).toBe('claude-opus-5');
  });
});

describe('key resolution', () => {
  it('returns NO_KEY when neither env nor header has a key', async () => {
    const r = await call(mw({}, mkFetch([])), { method: 'POST', url: '/', body: genReq() });
    expect(r.status).toBe(401);
    expect(r.json.code).toBe('NO_KEY');
  });

  it('uses the backup header only when the env key is absent; env wins otherwise', async () => {
    const f1 = mkFetch([() => chat(goodCut)]);
    await call(mw({}, f1), { method: 'POST', url: '/', body: genReq(), headers: { 'x-director-key': HEADER_KEY } });
    expect(f1.calls[0].init.headers.Authorization).toBe(`Bearer ${HEADER_KEY}`);

    const f2 = mkFetch([() => chat(goodCut)]);
    await call(mw({ CHEAPER_INFERENCE_API_KEY: ENV_KEY }, f2), { method: 'POST', url: '/', body: genReq(), headers: { 'x-director-key': HEADER_KEY } });
    expect(f2.calls[0].init.headers.Authorization).toBe(`Bearer ${ENV_KEY}`);
  });

  it('always sends the key to the configured base URL, never one supplied by a request', async () => {
    const f = mkFetch([() => chat(goodCut)]);
    await call(mw({ CHEAPER_INFERENCE_API_KEY: ENV_KEY }, f), {
      method: 'POST',
      url: '/',
      body: genReq({ baseUrl: 'https://evil.example/v1' }),
    });
    expect(f.calls[0].url).toBe('https://api.cheaperinference.com/v1/chat/completions');
  });
});

describe('generate', () => {
  const h = (f: any, extra: Record<string, string> = {}) => mw({ CHEAPER_INFERENCE_API_KEY: ENV_KEY, ...extra }, f);

  it('returns a validated cut, uses json_schema first and defaults to claude-sonnet-5.5', async () => {
    const f = mkFetch([() => chat(goodCut)]);
    const r = await call(h(f), { method: 'POST', url: '/', body: genReq() });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    expect(r.json.cut.picks).toHaveLength(3);
    expect(r.json.cut.picks[2].gapAfterSec).toBe(0);
    expect(f.calls[0].body.model).toBe('claude-sonnet-5.5');
    expect(f.calls[0].body.response_format.type).toBe('json_schema');
    expect(f.calls[0].body.response_format.json_schema.strict).toBe(true);
    // candidates first in the user message (prefix-cache friendly)
    const user = f.calls[0].body.messages[1].content as string;
    expect(user.startsWith('{"candidates":[')).toBe(true);
    expect(r.raw).not.toContain(ENV_KEY);
  });

  it('retries without response_format when the gateway rejects it, and remembers that', async () => {
    const f = mkFetch([
      () => errResp(400, { error: { message: 'response_format json_schema is not supported for this model' } }),
      () => chat(goodCut),
      () => chat(goodCut),
    ]);
    const handler = h(f);
    const r1 = await call(handler, { method: 'POST', url: '/', body: genReq() });
    expect(r1.json.ok).toBe(true);
    expect(f.calls[0].body.response_format).toBeDefined();
    expect(f.calls[1].body.response_format).toBeUndefined();
    await call(handler, { method: 'POST', url: '/', body: genReq() });
    expect(f.calls[2].body.response_format).toBeUndefined();
  });

  it('switches to max_completion_tokens when max_tokens is rejected', async () => {
    const f = mkFetch([() => errResp(400, 'Unsupported parameter: max_tokens'), () => chat(goodCut)]);
    const r = await call(h(f), { method: 'POST', url: '/', body: genReq() });
    expect(r.json.ok).toBe(true);
    expect(f.calls[1].body.max_completion_tokens).toBe(4096);
    expect(f.calls[1].body.max_tokens).toBeUndefined();
  });

  it('falls back to claude-sonnet-5 (never a mini/flash model) when the model is not found', async () => {
    const f = mkFetch([() => errResp(404, { error: { message: 'The model `claude-sonnet-5.5` does not exist' } }), () => chat(goodCut)]);
    const r = await call(h(f), { method: 'POST', url: '/', body: genReq() });
    expect(r.json.ok).toBe(true);
    expect(f.calls[1].body.model).toBe('claude-sonnet-5');
    expect(/mini|flash|nano|lite/i.test(f.calls[1].body.model)).toBe(false);
  });

  it('repairs once: feeds validation errors back and sums token usage', async () => {
    const bad = { ...goodCut, picks: [{ clipId: 'AQ-0269', keptText: null, gapAfterSec: 0.3, tensionScore: 5, note: 'x' }, ...goodCut.picks.slice(1)] };
    const f = mkFetch([() => chat(bad), () => chat(goodCut)]);
    const r = await call(h(f), { method: 'POST', url: '/', body: genReq() });
    expect(r.json.ok).toBe(true);
    expect(f.calls).toHaveLength(2);
    const repairMsgs = f.calls[1].body.messages as Array<{ role: string; content: string }>;
    expect(repairMsgs[repairMsgs.length - 1].content).toContain('unknown clipId "AQ-0269"');
    expect(r.json.usage).toEqual({ promptTokens: 200, completionTokens: 100 });
  });

  it('returns BAD_OUTPUT when the repair also fails', async () => {
    const bad = { ...goodCut, picks: [{ clipId: 'ghost', keptText: null, gapAfterSec: 0.3, tensionScore: 5, note: 'x' }] };
    const f = mkFetch([() => chat(bad), () => chat(bad)]);
    const r = await call(h(f), { method: 'POST', url: '/', body: genReq() });
    expect(r.status).toBe(502);
    expect(r.json.code).toBe('BAD_OUTPUT');
  });

  it('flags loaded language and repairs it', async () => {
    const loaded = { ...goodCut, title: 'The Scorched Earth Cut' };
    const f = mkFetch([() => chat(loaded), () => chat(goodCut)]);
    const r = await call(h(f), { method: 'POST', url: '/', body: genReq() });
    expect(r.json.ok).toBe(true);
    expect(r.json.cut.title).toBe('Chronological Record');
  });

  it('drops lowest-tension non-edge clips deterministically when still over +10% after repair', async () => {
    const all = { ...goodCut, picks: ['a', 'b', 'c', 'd'].map((clipId, i) => ({ clipId, keptText: null, gapAfterSec: i === 3 ? 0 : 0.35, tensionScore: [9, 2, 6, 8][i], note: 'n' })) };
    const f = mkFetch([() => chat(all), () => chat(all)]);
    const r = await call(h(f), { method: 'POST', url: '/', body: genReq() });
    expect(r.json.ok).toBe(true);
    expect(r.json.cut.picks.map((p: any) => p.clipId)).toEqual(['a', 'c', 'd']);
    expect(r.json.warnings.join(' ')).toContain('Dropped 1');
  });

  it('clamps the Cold Open target to 30-60 s', async () => {
    const f = mkFetch([() => chat({ ...goodCut, cutId: 'cut_c' }), () => chat({ ...goodCut, cutId: 'cut_c' })]);
    await call(h(f), { method: 'POST', url: '/', body: genReq({ cutId: 'cut_c' }) });
    const user = JSON.parse(f.calls[0].body.messages[1].content);
    expect(user.targetWindowSec).toBe(60);
  });

  it('returns NO_CANDIDATES for an empty pool and BAD_REQUEST for malformed input', async () => {
    const f = mkFetch([]);
    const a = await call(h(f), { method: 'POST', url: '/', body: genReq({ candidates: [] }) });
    expect(a.json.code).toBe('NO_CANDIDATES');
    const b = await call(h(f), { method: 'POST', url: '/', body: { mode: 'nope' } });
    expect(b.json.code).toBe('BAD_REQUEST');
    const c = await call(h(f), { method: 'POST', url: '/', body: '{not json' });
    expect(c.json.code).toBe('BAD_REQUEST');
  });

  it('rejects oversized bodies', async () => {
    const r = await call(h(mkFetch([])), { method: 'POST', url: '/', body: 'x'.repeat(1_100_000) });
    expect(r.status).toBe(400);
    expect(r.json.code).toBe('BAD_REQUEST');
  });
});

describe('error mapping and secrecy', () => {
  const h = (f: any) => mw({ CHEAPER_INFERENCE_API_KEY: ENV_KEY }, f);

  it('maps 401/403, 429 (with retry-after) and 5xx', async () => {
    const a = await call(h(mkFetch([() => errResp(401, 'nope')])), { method: 'POST', url: '/', body: genReq() });
    expect(a.json.code).toBe('UNAUTHORIZED');
    const b = await call(h(mkFetch([() => errResp(429, 'slow down', { 'retry-after': '7' })])), { method: 'POST', url: '/', body: genReq() });
    expect(b.json).toMatchObject({ code: 'RATE_LIMIT', retryAfterSec: 7 });
    const c = await call(h(mkFetch([() => errResp(503, 'upstream down')])), { method: 'POST', url: '/', body: genReq() });
    expect(c.json.code).toBe('UPSTREAM');
  });

  it('maps an aborted upstream call to TIMEOUT', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const r = await call(h(mkFetch([() => abort])), { method: 'POST', url: '/', body: genReq() });
    expect(r.json.code).toBe('TIMEOUT');
  });

  it('never leaks the key even if the gateway echoes it', async () => {
    const r = await call(h(mkFetch([() => errResp(500, `boom Authorization: Bearer ${ENV_KEY} key=${ENV_KEY} ci_live_abcdef123456`)])), {
      method: 'POST',
      url: '/',
      body: genReq(),
    });
    expect(r.raw).not.toContain(ENV_KEY);
    expect(r.raw).not.toContain('ci_live_abcdef123456');
  });

  it('scrub() removes keys and bearer tokens', () => {
    expect(scrub(`a ${ENV_KEY} b`, ENV_KEY)).not.toContain(ENV_KEY);
    expect(scrub('Bearer abc.def-123')).toBe('Bearer [redacted]');
    expect(scrub('x ci_live_deadbeef y')).toBe('x [redacted] y');
  });
});

describe('models, test and refine', () => {
  const h = (f: any) => mw({ CHEAPER_INFERENCE_API_KEY: ENV_KEY }, f);

  it('lists only claude-* models, sorted', async () => {
    const f = mkFetch([() => new Response(JSON.stringify({ data: [{ id: 'gpt-x' }, { id: 'claude-sonnet-5.5' }, { id: 'claude-opus-5' }] }), { status: 200 })]);
    const r = await call(h(f), { url: '/models' });
    expect(r.json.models).toEqual(['claude-opus-5', 'claude-sonnet-5.5']);
    expect(f.calls[0].init.headers.Authorization).toBe(`Bearer ${ENV_KEY}`);
  });

  it('test route does a tiny completion', async () => {
    const f = mkFetch([() => chat('{"ok":true}')]);
    const r = await call(h(f), { method: 'POST', url: '/test', body: {} });
    expect(r.json).toMatchObject({ ok: true, model: 'claude-sonnet-5.5' });
    expect(f.calls[0].body.max_tokens).toBe(16);
  });

  it('refine returns validated ops and rejects locked targets via repair', async () => {
    const current = [
      { index: 0, clipId: 'a', text: cands[0].text, startSec: 0, endSec: 30, durationSec: 30, gapAfterSec: 0.35, locked: false },
      { index: 1, clipId: 'b', text: cands[1].text, startSec: 0, endSec: 30, durationSec: 30, gapAfterSec: 0.35, locked: true },
    ];
    const op = (o: any) => ({ toIndex: null, keptText: null, gapAfterSec: null, atIndex: null, withClipId: null, note: null, ...o });
    const lockedOps = { summary: 'Dropped a clip.', ops: [op({ op: 'drop', clipId: 'b' })] };
    const goodOps = { summary: 'Dropped the first clip.', ops: [op({ op: 'drop', clipId: 'a' })] };
    const f = mkFetch([() => chat(lockedOps), () => chat(goodOps)]);
    const r = await call(h(f), {
      method: 'POST',
      url: '/',
      body: { mode: 'refine', cutId: 'cut_a', userPrompt: '', targetWindowSec: 60, candidates: cands, instruction: 'drop the first clip', current },
    });
    expect(r.json.ok).toBe(true);
    expect(r.json.refine.ops).toEqual([{ op: 'drop', clipId: 'a' }]);
    expect(f.calls[1].body.messages.at(-1).content).toContain('locked');
  });
});
