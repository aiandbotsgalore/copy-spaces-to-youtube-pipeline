import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { applySortOrder, buildSortItems, buildSortMessages, orderChangesTimeline, validateSort } from '../aiSort';
import { createDirectorMiddleware, __resetGatewayMemory } from '../../server/directorMiddleware';

const clip = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  quote: `quote for ${id}`,
  speaker: 'Angela',
  sourceTitle: 'Some Space',
  startSec: 0,
  endSec: 5,
  ...extra,
});

describe('buildSortItems', () => {
  it('uses short refs, maps them back to ids, and hides placeholder durations', () => {
    const { items, refToId } = buildSortItems([clip('a'), clip('b', { windowPlaceholder: true, endSec: 30 })] as any);
    expect(items.map(i => i.ref)).toEqual(['c1', 'c2']);
    expect(refToId).toEqual({ c1: 'a', c2: 'b' });
    expect(items[0].durationSec).toBe(5);
    expect(items[1].durationSec).toBeNull();
    expect(JSON.stringify(items)).not.toContain('"a"');
  });
  it('puts the reel text, never real ids, into the model messages', () => {
    const { items } = buildSortItems([clip('real_id_1')] as any);
    const msgs = buildSortMessages({ items, theme: 't' });
    expect(msgs[1].content).toContain('quote for real_id_1');
    expect(msgs[1].content).not.toMatch(/"id"|"real_id_1"/);
    expect(msgs[1].content).toContain('"theme":"t"');
  });
});

describe('validateSort', () => {
  const refs = ['c1', 'c2', 'c3', 'c4'];
  it('accepts a clean permutation', () => {
    const v = validateSort({ order: ['c3', 'c1', 'c4', 'c2'], rationale: ' Opens strong. ' }, refs);
    expect(v.ok).toBe(true);
    expect(v.order).toEqual(['c3', 'c1', 'c4', 'c2']);
    expect(v.rationale).toBe('Opens strong.');
    expect(v.warnings).toEqual([]);
  });
  it('drops unknown and repeated refs and appends forgotten ones in original order', () => {
    const v = validateSort({ order: ['c3', 'zz', 'c3', 'c1', 'c4'], rationale: '' }, refs);
    expect(v.ok).toBe(true);
    expect(v.order).toEqual(['c3', 'c1', 'c4', 'c2']);
    expect(v.warnings.length).toBe(3);
  });
  it('rejects mostly-wrong or malformed output', () => {
    expect(validateSort({ order: ['c1'], rationale: '' }, refs).ok).toBe(false);
    expect(validateSort({ order: 'c1,c2' }, refs).ok).toBe(false);
    expect(validateSort(null, refs).ok).toBe(false);
  });
  it('caps a runaway rationale', () => {
    const v = validateSort({ order: refs, rationale: 'x'.repeat(1000) }, refs);
    expect(v.rationale.length).toBeLessThanOrEqual(240);
  });
});

describe('applySortOrder', () => {
  const list = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id }));
  it('reorders everything when nothing is locked', () => {
    expect(applySortOrder(list, ['e', 'd', 'c', 'b', 'a']).map(c => c.id)).toEqual(['e', 'd', 'c', 'b', 'a']);
  });
  it('keeps locked clips at their index and sorts the rest around them', () => {
    const withLock = [{ id: 'a' }, { id: 'b', locked: true }, { id: 'c' }, { id: 'd' }, { id: 'e', locked: true }];
    const out = applySortOrder(withLock, ['d', 'c', 'a']).map(c => c.id);
    expect(out).toEqual(['d', 'b', 'c', 'a', 'e']);
  });
  it('never adds or removes clips: ignores stale ids and keeps unmentioned clips after the mentioned ones', () => {
    const out = applySortOrder(list, ['gone', 'c', 'a']).map(c => c.id);
    expect(out).toEqual(['c', 'a', 'b', 'd', 'e']);
    expect([...out].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
  it('detects a no-op ordering', () => {
    expect(orderChangesTimeline(list, ['a', 'b', 'c', 'd', 'e'])).toBe(false);
    expect(orderChangesTimeline(list, ['b', 'a', 'c', 'd', 'e'])).toBe(true);
  });
});

/* ---- /sort route ---- */
const ENV_KEY = 'test_env_key_1234567890abcdef';
function mkReq(o: { method?: string; url?: string; body?: unknown; remote?: string } = {}) {
  const text = o.body === undefined ? '' : typeof o.body === 'string' ? o.body : JSON.stringify(o.body);
  const r: any = Readable.from(text ? [Buffer.from(text)] : []);
  r.method = o.method || 'POST';
  r.url = o.url || '/sort';
  r.headers = {};
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
async function call(handler: any, body: unknown) {
  const req = mkReq({ body });
  const res = mkRes();
  const done = new Promise(r => res.on('finish', r));
  await handler(req, res);
  await done;
  return { status: res.statusCode as number, json: JSON.parse(res.body), raw: res.body as string };
}
const chat = (content: unknown) =>
  new Response(
    JSON.stringify({ model: 'claude-sonnet-5.5', choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
    { status: 200 }
  );
function mkFetch(queue: Array<() => Response>) {
  const calls: any[] = [];
  const fn: any = async (url: string, init: any) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    const next = queue.shift();
    if (!next) throw new Error('unexpected fetch call');
    return next();
  };
  fn.calls = calls;
  return fn as typeof fetch & { calls: any[] };
}
const items = ['c1', 'c2', 'c3', 'c4'].map(ref => ({ ref, text: `text ${ref}`, speaker: 'A', sourceTitle: 'S', durationSec: 4 }));

describe('POST /sort', () => {
  beforeEach(() => __resetGatewayMemory());
  const mk = (f: typeof fetch, key: string | null = ENV_KEY) =>
    createDirectorMiddleware({ getEnv: () => (key ? { CHEAPER_INFERENCE_API_KEY: key } : {}), fetchImpl: f });

  it('returns the model order as a full permutation and never leaks the key', async () => {
    const f = mkFetch([() => chat({ order: ['c4', 'c2', 'c1', 'c3'], rationale: 'Opens on c4.' })]);
    const r = await call(mk(f), { items, theme: 'dispute' });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, mode: 'sort', order: ['c4', 'c2', 'c1', 'c3'], rationale: 'Opens on c4.' });
    expect(r.raw).not.toContain(ENV_KEY);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url).toMatch(/\/chat\/completions$/);
    expect(JSON.stringify(f.calls[0].body.messages)).toContain('dispute');
  });
  it('repairs once when the first answer is unusable', async () => {
    const f = mkFetch([() => chat('not json at all'), () => chat({ order: ['c2', 'c1', 'c3', 'c4'], rationale: 'ok' })]);
    const r = await call(mk(f), { items });
    expect(r.json.order).toEqual(['c2', 'c1', 'c3', 'c4']);
    expect(f.calls).toHaveLength(2);
  });
  it('fails with BAD_OUTPUT when the repair is also unusable', async () => {
    const f = mkFetch([() => chat('nope'), () => chat({ order: ['zz'], rationale: '' })]);
    const r = await call(mk(f), { items });
    expect(r.status).toBe(502);
    expect(r.json.code).toBe('BAD_OUTPUT');
  });
  it('validates the request and requires a key', async () => {
    const f = mkFetch([]);
    expect((await call(mk(f), { items: items.slice(0, 2) })).status).toBe(400);
    expect((await call(mk(f), { items: [...items, { ...items[0] }] })).status).toBe(400);
    expect((await call(mk(f), { items: 'x' })).status).toBe(400);
    const noKey = await call(mk(f, null), { items });
    expect(noKey.status).toBe(401);
    expect(noKey.json.code).toBe('NO_KEY');
    expect(f.calls).toHaveLength(0);
  });
});
