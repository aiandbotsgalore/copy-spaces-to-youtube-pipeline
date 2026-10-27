/**
 * Phase 5 end to end through the real HTTP middleware: a thematic project across two real recordings
 * (qualified ids, per-recording evidence and dates), the style card built automatically at the first
 * draft from every Logan segment plus his narration examples, Logan's explicit rules, and learned rules
 * distilled after 10 decisions. Only the CLI child processes are replaced (injected runner).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createScriptStudioMiddleware } from '../../server/scriptStudioMiddleware';
import { FULL_EPISODE_URL, makeFakeCli, releaseResponse, type CliCall, type Responder } from './helpers/fakeCli';

const T1 = '20260826_1AxRnZYBVdrxl';   // Oor and the cake (no Logan)
const T2 = '20260216_1DXxyvyaVXbKM';   // Logan hosting
const T3 = '20260218_1yoJMwyzqQpKQ';   // another Logan recording, not in the project at first
const SRC = (t: string) => path.join(__dirname, '..', '..', 'public', 'transcripts', 'episodes', `${t}.json`);
const QUOTE1 = "it's orange citrus. Delicious. I'm angry I can't share this with you.";
const QUOTE2 = "That's a hell of a fucking trip. You gonna drive or just fly?";

let root = '';
let server: http.Server;
let base = '';
const calls: CliCall[] = [];
const prompts: Record<string, string[]> = {};
let draftMode: 'good' | 'mixed' = 'good';

const responder: Responder = (kind, prompt) => {
  (prompts[kind] ||= []).push(prompt);
  switch (kind) {
    case 'analysis': {
      if (prompt.includes(`Episode ${T1}`)) return { ledger: 'cake', openQuestions: ['Is it citrus?'], themes: [{ id: 't1', label: 'Food', summary: 's', momentIds: ['c0-1'] }], dynamics: [], moments: [{ id: 'c0-1', kind: 'humor', why: 'Vivid.', themes: ['t1'], speakers: ['Oor'], utteranceIds: ['u92', 'u93'], quotes: [{ utteranceIds: ['u92', 'u93'], verbatim: QUOTE1 }] }] };
      return { ledger: 'trip', openQuestions: [], themes: [{ id: 't1', label: 'Travel', summary: 's', momentIds: ['c0-1'] }], dynamics: [{ speaker: 'Logan', role: 'host', stance: 'curious' }], moments: [{ id: 'c0-1', kind: 'humor', why: 'Logan reacts.', themes: ['t1'], speakers: ['Logan'], utteranceIds: ['u10'], quotes: [{ utteranceIds: ['u10'], verbatim: QUOTE2 }] }] };
    }
    case 'clipTags': return { tags: [...prompt.matchAll(/"clipId":"([^"]+)"/g)].map(m => ({ clipId: m[1], fn: 'evidence', rationale: 'r' })) };
    case 'outline': return { segments: [{ title: 'Two Spaces', scenes: [{ title: 'Cake, then a trip', purpose: 'Connect them.', clipIds: [], momentIds: ['E1.c0-1', 'E2.c0-1', 'E9.c0-1'] }] }] };
    case 'draft': {
      const sceneId = /"sceneId":"(sc_[A-Za-z0-9]+)"/.exec(prompt)![1];
      const claims = draftMode === 'good'
        ? [{ utteranceIds: ['E1.u92', 'E1.u93'], verbatim: QUOTE1 }, { utteranceIds: ['E2.u10'], verbatim: QUOTE2 }]
        : [{ utteranceIds: ['E1.u92', 'E2.u10'], verbatim: QUOTE2 }];
      return { scenes: [{ sceneId, blocks: [{ kind: 'narration', text: 'In August, Oor praised a cake; back in February, Logan asked about a trip.', mode: 'live', claims, id: null, clipId: null, keptText: null, fn: null, rationale: null, sec: null, cue: null, note: null }] }] };
    }
    case 'styleTraits': {
      // Quote the first six words of the first passage given, exactly as a model should.
      const first = /\[\d{4}-\d{2}-\d{2}\] (.+)/.exec(prompt)![1].split(' ').slice(0, 6).join(' ');
      return { traits: [{ trait: 'Answers with a quick reaction', examples: [first, 'invented example line'] }], avoid: ['Formal hedging'] };
    }
    case 'styleCard': return {
      live: { summary: 'Quick, warm, profane reactions.', traits: [{ trait: 'Answers with a quick reaction', examples: [JSON.parse(/<<<TRANSCRIPT_DATA[^\n]*\n(\[[\s\S]*?\])\n<<<END_TRANSCRIPT_DATA>>>/.exec(prompt)![1])[0].traits[0].examples[0]] }] },
      polished: { summary: 'Measured, sceptical framing.', traits: [{ trait: 'Frames the myth first', examples: ['Every generation produces a story that people desperately want to be true'] }] },
      avoid: ['Formal hedging'],
    };
    case 'distill': return { rules: [{ rule: 'Date every recording you cite.', from: 'approved', evidence: 6 }, { rule: 'Single hunch.', from: 'approved', evidence: 1 }] };
  }
  throw new Error(`unexpected schema ${kind}`);
};

async function api(method: string, route: string, body?: unknown) {
  const r = await fetch(`${base}${route}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json() as any };
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-multi-'));
  const ep = path.join(root, 'public', 'transcripts', 'episodes');
  fs.mkdirSync(ep, { recursive: true });
  for (const t of [T1, T2, T3]) fs.copyFileSync(SRC(t), path.join(ep, `${t}.json`));
  const nx = path.join(root, 'speaker_samples', 'Logan', 'narration_examples');
  fs.mkdirSync(nx, { recursive: true });
  fs.copyFileSync(path.join(__dirname, '..', '..', 'speaker_samples', 'Logan', 'narration_examples', 'gary_mckinnon_narration.txt'), path.join(nx, 'gary_mckinnon_narration.txt'));
  const mw = createScriptStudioMiddleware({
    root, getEnv: () => ({ PATH: '/bin' }), runner: makeFakeCli(responder, calls),
    fetchImpl: (async () => releaseResponse()) as unknown as typeof fetch,
    resolveOverride: async name => ({ ok: true, file: `/usr/local/bin/${name}`, prefixArgs: [], via: 'path', found: `/usr/local/bin/${name}` }),
  });
  server = http.createServer((req, res) => { req.url = (req.url || '').replace(/^\/api\/script/, '') || '/'; void mw(req, res); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/script`;
});
afterAll(() => { server?.close(); });

describe('multi-recording projects, style card and learned rules', () => {
  let id = '';
  let draftId = '';
  it('creates a project over two recordings with stable keys and dates', async () => {
    const p = await api('POST', '/project', { releaseTags: [T1, T2], format: 'thematic_multi', thesis: 'What do people in Logan\'s Spaces get excited about?', targetRuntimeSec: 120 });
    expect(p.status).toBe(201);
    id = p.json.project.id;
    expect(p.json.project).toMatchObject({ sourceTags: [T1, T2], sourceKeys: { [T1]: 'E1', [T2]: 'E2' }, format: 'thematic_multi' });
    expect((await api('POST', '/project', { releaseTags: [T1, '../x'] })).status).toBe(400);
    const g = await api('GET', `/project?id=${id}`);
    expect(g.json.recordings).toEqual([
      { releaseTag: T1, key: 'E1', date: '2026-08-26', title: expect.any(String), clips: expect.any(Number), analysed: false },
      { releaseTag: T2, key: 'E2', date: '2026-02-16', title: expect.any(String), clips: 0, analysed: false },
    ]);
    // Renames are per recording: "Speaker 1" differs between Spaces.
    const u = await api('POST', '/project/update', { id, speakerNames: { [`${T2}::Speaker 1`]: 'Chris' } });
    expect(u.status).toBe(200);
    const g2 = await api('GET', `/project?id=${id}`);
    expect(JSON.stringify(g2.json.speakerStats[T2])).toContain("Chris");
    expect(JSON.stringify(g2.json.speakerStats[T1])).not.toContain("Chris");
  });

  it('outline needs every recording analysed and sees qualified ids, dates and the thesis', async () => {
    expect((await api('POST', '/outline', { projectId: id })).json.message).toMatch(/not analysed yet: 20260826_1AxRnZYBVdrxl, 20260216_1DXxyvyaVXbKM/);
    const a = await api('POST', '/analyze', { projectId: id });
    expect(a.status).toBe(200);
    const o = await api('POST', '/outline', { projectId: id });
    expect(o.status).toBe(200);
    outlineVersionId = o.json.version.id;
    const p = prompts.outline[0];
    expect(p).toContain('E1 = recorded 2026-08-26');
    expect(p).toContain('E2 = recorded 2026-02-16');
    expect(p).toContain('"id":"E2.c0-1"');
    expect(p).toContain('Thesis question Logan set for this episode: What do people in Logan\'s Spaces get excited about?');
    expect(o.json.version.segments[0].scenes[0].momentIds).toEqual(['E1.c0-1', 'E2.c0-1']); // E9 does not exist
  });

  it('the first draft builds the style card from all of Logan\'s speech, then drafts with per-recording evidence', async () => {
    expect((await api('GET', '/style')).json).toMatchObject({ card: null, freshness: { fresh: false, reason: 'No style card yet.' }, recordingsWithLogan: 2 });
    const d = await api('POST', '/draft', { projectId: id });
    expect(d.status).toBe(200);
    expect(d.json.style).toEqual({ built: true });
    draftId = d.json.version.id;
    const claims = d.json.version.segments[0].scenes[0].blocks[0].claims;
    expect(claims.map((c: any) => [c.releaseTag, c.speaker])).toEqual([[T1, 'Oor'], [T2, 'Logan']]);
    expect(d.json.gates.factual).toBe('pass');
    const dp = prompts.draft[0];
    expect(dp).toContain('# E1, recorded 2026-08-26');
    expect(dp).toMatch(/\[E2\.u10 00:06:22 Logan\] That's a hell of a fucking trip/);
    expect(dp).toContain("LIVE (how Logan talks in his Spaces): Quick, warm, profane reactions.");
    expect(dp).toContain('POLISHED (Logan\'s written documentary narration): Measured, sceptical framing.');
    const sp = prompts.styleTraits[0];
    expect(sp).toMatch(/Measured in code over all [\d,]+ segments .* Logan speaks in 2 of 3 recordings/);
    expect(sp).toContain('[2026-02-16]');
    expect(prompts.styleCard[0]).toContain('Every generation produces a story');

    const s = await api('GET', '/style');
    expect(s.json.freshness.fresh).toBe(true);
    expect(s.json.card.coverage).toMatchObject({ recordingsWithLogan: 2, recordingsScanned: 3, recordingsRead: 2, narrationFiles: ['gary_mckinnon_narration.txt'], batchesFailed: [] });
    expect(s.json.card.coverage.examplesDropped).toBe(s.json.card.coverage.batches); // the invented line, once per batch
    expect(s.json.card.live.traits[0].examples).toHaveLength(1);
    expect(s.json.card.polished.traits[0].examples).toEqual(['Every generation produces a story that people desperately want to be true']);
    // A second draft reuses the card.
    const n = prompts.styleCard.length;
    await api('POST', '/draft', { projectId: id, versionId: o_id() });
    expect(prompts.styleCard.length).toBe(n);
  });

  it('a claim spanning two recordings is refused in code', async () => {
    draftMode = 'mixed';
    const d = await api('POST', '/draft', { projectId: id, versionId: o_id() });
    draftMode = 'good';
    expect(d.json.version.segments[0].notDrafted).toMatch(/more than one recording/);
  });

  it('adds and removes recordings; a recording the script uses cannot be removed', async () => {
    await api('POST', '/head', { projectId: id, versionId: draftId });
    const add = await api('POST', '/project/update', { id, addSourceTags: [T3] });
    expect(add.json.project.sourceKeys[T3]).toBe('E3');
    expect((await api('POST', '/project/update', { id, removeSourceTags: [T2] })).json).toMatchObject({ code: 'SOURCE_IN_USE' });
    const rm = await api('POST', '/project/update', { id, removeSourceTags: [T3] });
    expect(rm.json.project.sourceTags).toEqual([T1, T2]);
    const again = await api('POST', '/project/update', { id, addSourceTags: [T3] });
    expect(again.json.project.sourceKeys[T3]).toBe('E3');
    await api('POST', '/project/update', { id, removeSourceTags: [T3] });
  });

  it('finds related recordings by the thesis in code', async () => {
    const r = await api('GET', `/related?projectId=${id}&q=${encodeURIComponent('California launch accidents')}`);
    expect(r.json.terms).toEqual(['california', 'launch', 'accidents']);
    expect(r.json.hits.map((h: any) => h.releaseTag)).toEqual([T3]);
    expect(r.json.hits[0].date).toBe('2026-02-18');
    expect((await api('GET', `/paper-trail?projectId=${id}`)).json).toEqual({ ok: true, quotes: [], pairs: [] });
  });

  it('explicit rules, and learned rules distilled by the critic after 10 decisions', async () => {
    const add = await api('POST', '/style/rules', { add: 'Always say when each Space was recorded.' });
    expect(add.json.rules[0]).toMatchObject({ rule: 'Always say when each Space was recorded.', source: 'explicit' });
    let last: any;
    for (let i = 0; i < 10; i++) last = await api('POST', '/decide', { projectId: id, candidateId: draftId, decision: i % 2 ? 'reject' : 'accept', reason: 'r' });
    expect(last.json.distill).toBe('started');
    let st: any;
    for (let i = 0; i < 100; i++) { st = (await api('GET', '/style')).json; if (st.lastDistill) break; await new Promise(r => setTimeout(r, 10)); }
    expect(st.lastDistill).toMatchObject({ ok: true, decisions: 10, added: 1 });
    expect(st.rules.map((r: any) => [r.rule, r.source])).toEqual([['Always say when each Space was recorded.', 'explicit'], ['Date every recording you cite.', 'approved']]);
    expect(st.decisionsSinceDistill).toBe(0);
    const distillCall = calls.find(c => c.cli === 'claude' && c.args.includes('haiku') && c.stdin.includes('Approved passages'));
    expect(distillCall).toBeTruthy();
    const rm = await api('POST', '/style/rules', { remove: 'Date every recording you cite.' });
    expect(rm.json.removedRules).toEqual(['Date every recording you cite.']);
    // Rules reach the critique and revise prompts through memory; the voice reaches the critic.
    expect(prompts.styleCard.length).toBe(1);
  });
});

let outlineVersionId = '';
function o_id() { return outlineVersionId; }
