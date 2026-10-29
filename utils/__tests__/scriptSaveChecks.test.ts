/**
 * Phase 0: saving an edit runs the code checks before the head moves. The edit is always saved as a
 * version (nothing is lost), but the head only moves when the checks on the changed blocks pass.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createScriptStudioMiddleware } from '../../server/scriptStudioMiddleware';
import { makeFakeCli, type CliCall } from './helpers/fakeCli';
import type { Segment } from '../scriptTypes';

const TAG = '20260826_1AxRnZYBVdrxl';
const SRC = path.join(__dirname, '..', '..', 'public', 'transcripts', 'episodes', `${TAG}.json`);
const QUOTE = "it's orange citrus. Delicious. I'm angry I can't share this with you.";
const goodRef = { releaseTag: TAG, segStart: 1207.94, segEnd: 1242.38, speaker: 'Oor', verbatim: QUOTE };
const badRef = { ...goodRef, verbatim: 'words nobody ever said on this recording' };

let root = '';
let server: http.Server;
let base = '';
let mw: ReturnType<typeof createScriptStudioMiddleware>;
const calls: CliCall[] = [];

async function api(method: string, route: string, body?: unknown) {
  const r = await fetch(`${base}${route}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json() as any };
}

const script = (blocks: any[]): Segment[] => [{ id: 'seg_a', title: 'Open', scenes: [{ id: 'sc_a', title: 'Cake', purpose: 'Hook', blocks }] }];
const narr = (id: string, text: string, claims: any[] = [], locked = false) => ({ id, kind: 'narration', text, mode: 'polished', claims, ...(locked ? { locked: true } : {}) });

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-save-'));
  fs.mkdirSync(path.join(root, 'public', 'transcripts', 'episodes'), { recursive: true });
  fs.copyFileSync(SRC, path.join(root, 'public', 'transcripts', 'episodes', `${TAG}.json`));
  mw = createScriptStudioMiddleware({
    root, getEnv: () => ({ PATH: '/bin' }), runner: makeFakeCli(() => { throw new Error('no model calls in this test'); }, calls),
    resolveOverride: async name => ({ ok: true, file: `/usr/local/bin/${name}`, prefixArgs: [], via: 'path', found: `/usr/local/bin/${name}` }),
  });
  server = http.createServer((req, res) => { req.url = (req.url || '').replace(/^\/api\/script/, '') || '/'; void mw(req, res); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/script`;
});
afterAll(() => { server?.close(); });

describe('POST /version checks before the head moves', () => {
  let projectId = '';
  let v1 = '';

  it('moves the head when the edit passes the checks', async () => {
    projectId = (await api('POST', '/project', { releaseTag: TAG })).json.project.id;
    const r = await api('POST', '/version', { projectId, parentId: null, segments: script([narr('b_one', 'Oor tastes the cake.', [goodRef]), narr('b_lock', 'A locked line.', [], true)]) });
    expect(r.status).toBe(200);
    expect(r.json.headMoved).toBe(true);
    expect(r.json.gates.ok).toBe(true);
    v1 = r.json.version.id;
    expect((await api('GET', `/project?id=${projectId}`)).json.project.headVersionId).toBe(v1);
  });

  it('saves a failing edit as a version but keeps the head', async () => {
    const r = await api('POST', '/version', { projectId, parentId: v1, segments: script([narr('b_one', 'Oor tastes the cake.', [badRef]), narr('b_lock', 'A locked line.', [], true)]) });
    expect(r.status).toBe(200);
    expect(r.json.headMoved).toBe(false);
    expect(r.json.gates.ok).toBe(false);
    expect(r.json.gates.failures.join(' ')).toMatch(/is not verbatim/);
    const saved = await api('GET', `/version?projectId=${projectId}&id=${r.json.version.id}`);
    expect(saved.status).toBe(200);
    expect(saved.json.version.segments[0].scenes[0].blocks[0].claims[0].verbatim).toBe(badRef.verbatim);
    expect((await api('GET', `/project?id=${projectId}`)).json.project.headVersionId).toBe(v1);
  });

  it('keeps the head when a locked block is changed', async () => {
    const r = await api('POST', '/version', { projectId, parentId: v1, segments: script([narr('b_one', 'Oor tastes the cake.', [goodRef]), narr('b_lock', 'Someone rewrote the locked line.', [], true)]) });
    expect(r.json.headMoved).toBe(false);
    expect(r.json.gates.failures.join(' ')).toMatch(/Locked block b_lock was changed/);
    expect((await api('GET', `/project?id=${projectId}`)).json.project.headVersionId).toBe(v1);
  });

  it('does not block on an old failure in a block the edit did not touch', async () => {
    // A head saved before this check existed can already hold a failing claim.
    const p = mw.store.getProject(projectId)!;
    const old = { id: 'v_legacy', parentId: v1, projectId, createdAt: Date.now(), author: 'logan' as const, segments: script([narr('b_one', 'Old line.', [badRef]), narr('b_two', 'Second line.')]) };
    mw.store.saveVersion(old as any);
    mw.store.saveProject({ ...p, headVersionId: old.id });
    const r = await api('POST', '/version', { projectId, parentId: old.id, segments: script([narr('b_one', 'Old line.', [badRef]), narr('b_two', 'Second line, edited.')]) });
    expect(r.json.headMoved).toBe(true);
    expect((await api('GET', `/project?id=${projectId}`)).json.project.headVersionId).toBe(r.json.version.id);
  });
});
