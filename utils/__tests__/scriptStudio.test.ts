/**
 * End to end through the real HTTP middleware, engine, store, gates and CLI adapters, on a real
 * transcript. Only the child processes are replaced (an injected runner standing in for the Claude Code
 * and Codex CLIs, which are not installed on the test machine).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createScriptStudioMiddleware } from '../../server/scriptStudioMiddleware';
import { chunkUtterances, readTranscript } from '../../server/scriptData';
import { makeFakeCli, type CliCall, type Responder } from './helpers/fakeCli';
import type { RunOutcome } from '../../server/scriptProviders';

const TAG = '20260826_1AxRnZYBVdrxl';
const SRC = path.join(__dirname, '..', '..', 'public', 'transcripts', 'episodes', `${TAG}.json`);
const CLIP_ID = `tr_${TAG}_u92_u93`;
const QUOTE = "it's orange citrus. Delicious. I'm angry I can't share this with you.";

let root = '';
let server: http.Server;
let base = '';
let mw: ReturnType<typeof createScriptStudioMiddleware>;
const calls: CliCall[] = [];
let critiqueRound = 0;
let limitNext = false;

const sceneIdIn = (p: string) => /"sceneId":"(sc_[A-Za-z0-9]+)"/.exec(p)?.[1] || '';
const responder: Responder = (kind, prompt) => {
  if (limitNext && kind === 'judge') {
    limitNext = false;
    const fail: RunOutcome = { code: 1, stdout: JSON.stringify({ type: 'error', message: "You've hit your usage limit. Try again at 4:12 PM." }), stderr: '', timedOut: false, aborted: false };
    return { __fail: fail };
  }
  switch (kind) {
    case 'analysis': return {
      ledger: 'Oor is eating a cake.', openQuestions: [],
      themes: [{ id: 't1', label: 'Food', summary: 'Oor narrates a cake.', momentIds: ['c0-1'] }],
      dynamics: [{ speaker: 'Oor', role: 'storyteller', stance: 'delighted' }],
      moments: [
        { id: 'c0-1', kind: 'humor', why: 'A vivid aside.', themes: ['t1'], speakers: ['Oor'], utteranceIds: ['u92', 'u93'], quotes: [{ utteranceIds: ['u92', 'u93'], verbatim: QUOTE }] },
        { id: 'c0-2', kind: 'claim', why: 'Invented ids are dropped by code.', themes: [], speakers: [], utteranceIds: ['u999999'], quotes: [] },
      ],
    };
    case 'outline': return { segments: [{ title: 'Cold open', scenes: [{ title: 'The cake', purpose: 'Hook with a laugh.', clipIds: [CLIP_ID], momentIds: ['c0-1'] }] }] };
    case 'draft': return { scenes: [{ sceneId: sceneIdIn(prompt), blocks: [
      { kind: 'narration', text: 'Then the cake arrives.', mode: 'live', claims: [] },
      { kind: 'clip', clipId: CLIP_ID, keptText: "I'm angry I can't share this with you. It's really unfortunate. Thanks, bro. Oh my God, it's so good! I don't even eat this kind of shit, bro. Wow, wow, fire, fire! I just want to be a fat guy now.".replace(/^'|'$/g, ''), fn: 'breather', rationale: 'Laugh' },
      { kind: 'music', cue: 'sting', note: 'after the laugh' },
    ] }] };
    case 'critique': {
      critiqueRound++;
      if (critiqueRound > 1) return { critiques: [{ targetId: sceneIdIn(prompt), issue: 'Small wording.', consequence: 'none', criterion: 'clarity', severity: 'minor', proposedFix: 'x' }] };
      return { critiques: [{ targetId: sceneIdIn(prompt), issue: 'The narration does not say who is speaking.', consequence: 'Listeners are lost.', criterion: 'clarity', severity: 'major', proposedFix: 'Name Oor.' }] };
    }
    case 'revise': return { summary: 'Named the speaker.', blocks: [
      { kind: 'narration', text: "According to Oor, the cake is orange citrus, and he can't share it.", mode: 'live', claims: [{ utteranceIds: ['u92', 'u93'], verbatim: QUOTE }] },
      { kind: 'clip', clipId: CLIP_ID, keptText: null, fn: 'breather', rationale: 'Laugh' },
    ] };
    case 'factcheck': return { claims: [{ index: 0, label: 'supported', note: 'Matches the excerpt.' }] };
    case 'judge': {
      const [a] = prompt.split('Version B (JSON):');
      return { winner: a.includes('According to Oor') ? 'A' : 'B', reasons: ['Names the speaker.'] };
    }
  }
  throw new Error(`unexpected schema ${kind}`);
};

async function api(method: string, route: string, body?: unknown) {
  const r = await fetch(`${base}${route}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json() as any };
}
async function waitRun(projectId: string, runId: string) {
  for (let i = 0; i < 200 && mw.engine.isActive(runId); i++) await new Promise(r => setTimeout(r, 10));
  const r = await fetch(`${base}/events?projectId=${projectId}&runId=${runId}`);
  const text = await r.text(); // ends on finished or paused
  return text.split('\n\n').filter(c => c.includes('data: ') && !c.startsWith('event: idle')).map(c => JSON.parse(c.slice(c.indexOf('data: ') + 6)));
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-studio-'));
  fs.mkdirSync(path.join(root, 'public', 'transcripts', 'episodes'), { recursive: true });
  fs.copyFileSync(SRC, path.join(root, 'public', 'transcripts', 'episodes', `${TAG}.json`));
  mw = createScriptStudioMiddleware({
    root, getEnv: () => ({ PATH: '/bin', ANTHROPIC_API_KEY: 'must-be-stripped' }), runner: makeFakeCli(responder, calls),
    resolveOverride: async name => ({ ok: true, file: `/usr/local/bin/${name}`, prefixArgs: [], via: 'path', found: `/usr/local/bin/${name}` }),
  });
  server = http.createServer((req, res) => { req.url = (req.url || '').replace(/^\/api\/script/, '') || '/'; void mw(req, res); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/script`;
});
afterAll(() => { server?.close(); });

describe('Script Studio API end to end', () => {
  let projectId = '';
  it('reports provider health from the real availability checks', async () => {
    const r = await api('GET', '/status');
    expect(r.status).toBe(200);
    expect(r.json.providers['claude_cli:sonnet']).toMatchObject({ ok: true, detail: 'Signed in (claude.ai subscription).' });
    expect(r.json.providers['codex_cli']).toMatchObject({ ok: true, model: 'gpt-6.1-sol' });
    expect(r.json.providers['ci:gpt-6-luna']).toMatchObject({ ok: false, code: 'NO_KEY' });
  });
  it('lists episodes and creates a project', async () => {
    expect((await api('GET', '/episodes')).json.episodes).toEqual([{ releaseTag: TAG, title: expect.any(String) }]);
    const p = await api('POST', '/project', { releaseTag: TAG, targetRuntimeSec: 40 });
    expect(p.status).toBe(201);
    projectId = p.json.project.id;
    expect((await api('POST', '/project', { releaseTag: '../etc' })).status).toBe(400);
    const u = await api('POST', '/project/update', { id: projectId, format: 'narrative_doc' });
    expect(u.json.project.format).toBe('narrative_doc');
    const c = await api('POST', '/project/add-clip', { id: projectId, fromId: 'u92', toId: 'u93' });
    expect(c.json.clip).toMatchObject({ clipId: CLIP_ID, audioOffsetSec: 1207.94, speaker: 'Oor' });
  });
  it('analyses with code-validated moments', async () => {
    const r = await api('POST', '/analyze', { projectId });
    expect(r.status).toBe(200);
    const a = r.json.analyses[TAG];
    expect(a.moments.map((m: any) => m.id)).toEqual(['c0-1']);
    expect(a.moments[0].evidence).toHaveLength(1);
    expect(a.moments[0].evidence[0]).toMatchObject({ speaker: 'Oor', segStart: 1207.94, segEnd: 1242.38 });
    const t = readTranscript(root, TAG)!;
    expect(chunkUtterances(t.utterances, {}).length).toBe(calls.filter(c => c.args[0] === '-p').length);
    // Second call is served from the cache.
    const before = calls.length;
    await api('POST', '/analyze', { projectId });
    expect(calls.length).toBe(before);
  });
  it('outlines, drafts and computes clip times in code', async () => {
    expect((await api('POST', '/outline', { projectId })).status).toBe(200);
    const d = await api('POST', '/draft', { projectId });
    expect(d.status).toBe(200);
    const blocks = d.json.version.segments[0].scenes[0].blocks;
    expect(blocks.map((b: any) => b.kind)).toEqual(['narration', 'clip', 'music']);
    // Keeping only the second utterance would cut 16.69 s of a 34.44 s clip, over the resolver's 35%
    // automatic limit: the draft keeps the full clip and flags it for Logan instead of cutting silently.
    expect(blocks[1]).toMatchObject({ inSec: 0, outSec: 34.44, trimBasis: 'full' });
    expect(blocks[1].flag).toMatch(/Trim not applied: Trim would remove \d+% of the clip \(automatic limit 35%\)/);
    expect(d.json.gates.clipBoundsOk).toBe(true);
  });
  it('rejects an edit based on a stale head', async () => {
    const r = await api('POST', '/version', { projectId, parentId: 'v_old', segments: [] });
    expect(r.status).toBe(409);
  });
  it('refuses a same-family judge', async () => {
    const r = await api('POST', '/refine', { projectId, roleMap: { judge: 'claude_cli:haiku' } });
    expect(r).toMatchObject({ status: 400, json: { code: 'CROSS_FAMILY' } });
  });
  let runId = '';
  it('pauses a run on a usage limit, then resumes and finishes with a judged candidate', async () => {
    limitNext = true;
    const start = await api('POST', '/refine', { projectId });
    expect(start.status).toBe(202);
    runId = start.json.runId;
    let events = await waitRun(projectId, runId);
    expect(events.at(-1).message).toMatch(/^Paused: judge on codex_cli returned USAGE_LIMIT/);
    let run = (await api('GET', `/run?projectId=${projectId}&runId=${runId}`)).json.run;
    expect(run.status).toBe('paused_limit');
    expect(run.pausedInfo.message).toMatch(/Try again at 4:12 PM/);

    critiqueRound = 0;
    expect((await api('POST', '/resume', { projectId, runId })).status).toBe(202);
    events = await waitRun(projectId, runId);
    const judge = events.find((e: any) => e.type === 'judge');
    expect(judge.data).toMatchObject({ winnerAB: 'B', winnerBA: 'A', consensus: 'two_wins' });
    expect(events.at(-1)).toMatchObject({ type: 'finished', data: { stopReason: 'no_major_issues' } });
    const r = await api('GET', `/run?projectId=${projectId}&runId=${runId}`);
    run = r.json.run;
    expect(run.status).toBe('finished');
    const accepted = r.json.candidates.find((c: any) => c.decision?.loopAccepted);
    expect(accepted).toBeTruthy();
    expect(accepted.decision.gates.factcheck[0].label).toBe('supported');
    expect(run.bestVersionId).toBe(accepted.id);
    // The loop only proposes: the head moves when Logan accepts.
    const before = (await api('GET', `/project?id=${projectId}`)).json.project.headVersionId;
    expect(before).not.toBe(accepted.id);
    const dec = await api('POST', '/decide', { projectId, candidateId: accepted.id, decision: 'accept' });
    expect(dec.json.project.headVersionId).toBe(accepted.id);
    expect(mw.store.getMemory().approvedPassages.length).toBeGreaterThan(0);
  });
  it('sent no API key to the CLIs and used the subscription argv', () => {
    const cliRuns = calls.filter(c => c.args[0] === '-p' || c.args[0] === 'exec');
    expect(cliRuns.length).toBeGreaterThan(5);
    for (const c of cliRuns) expect(c.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(calls.filter(c => c.cli === 'codex' && c.args[0] === 'exec').every(c => c.args.includes('gpt-6.1-sol'))).toBe(true);
  });
  it('logs every call, exports and re-imports the project', async () => {
    const log = await api('GET', `/log?runId=${runId}`);
    expect(log.json.entries.length).toBeGreaterThan(3);
    expect(log.json.entries.every((e: any) => e.promptVersion)).toBe(true);
    const ex = await api('GET', `/export?projectId=${projectId}`);
    expect(ex.json.kind).toBe('spacepipe-script-project');
    expect((await api('POST', '/import', ex.json)).status).toBe(409);
    expect((await api('POST', '/import', { ...ex.json, overwrite: true })).status).toBe(200);
  });
  it('marks runs left running as interrupted when a new server starts', () => {
    const run = mw.store.getRun(projectId, runId)!;
    mw.store.saveRun({ ...run, status: 'running' });
    const again = createScriptStudioMiddleware({ root, getEnv: () => ({}) });
    expect(again.store.getRun(projectId, runId)!.status).toBe('interrupted');
  });
  it('refuses remote clients', async () => {
    const res: any = { statusCode: 0, headers: {} as any, setHeader(k: string, v: string) { this.headers[k] = v; }, end(b: string) { this.body = b; } };
    await mw({ url: '/status', method: 'GET', socket: { remoteAddress: '10.0.0.5' } } as any, res);
    expect(res.statusCode).toBe(403);
  });
});
