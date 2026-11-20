import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Block, Critique, NarrationTarget, ScriptVersion } from '../scriptTypes';
import { applyLinkedNarration, linkedRevisionView, linkedStoryContext, validateLinkedTargets } from '../scriptLinkedEdits';
import { changedBlockIds, diffVersions } from '../scriptGates';
import { createScriptStudioMiddleware } from '../../server/scriptStudioMiddleware';
import { fixtureTranscriptPath } from './helpers/transcriptFixtures';
import { makeFakeCli, type CliCall, type Responder } from './helpers/fakeCli';

const TAG = '20260826_1AxRnZYBVdrxl';
const QUOTE = "it's orange citrus. Delicious. I'm angry I can't share this with you.";
const ref = { releaseTag: TAG, segStart: 1207.94, segEnd: 1242.38, speaker: 'Oor', verbatim: QUOTE };
const narration = (id: string, text: string): Extract<Block, { kind: 'narration' }> => ({ id, kind: 'narration', text, mode: 'live', claims: [ref] });
const baseline = (): ScriptVersion => ({
  id: 'v_base', parentId: null, projectId: 'p_test', author: 'logan', createdAt: 1,
  segments: [
    { id: 'seg_early', title: 'Early', scenes: [
      { id: 'sc_setup', title: 'Setup', purpose: 'Raise the question.', blocks: [
        { id: 'heading', kind: 'heading', text: 'EARLY' },
        narration('n_setup', 'According to Oor, the cake is orange citrus. I wanted to hear how he described it.'),
        { ...narration('n_locked', 'According to Oor, it was delicious.'), locked: true },
        { ...narration('quote', QUOTE), type: 'QUOTE_READ', readEvidence: true, quoteSpeaker: 'Oor' },
        { id: 'cue', kind: 'cue', text: 'Keep the room tone.', cueType: 'production_note' },
        { id: 'music', kind: 'music', cue: 'bed_out', note: 'Fade here.' },
        { id: 'pause', kind: 'pause', sec: 1 },
      ] },
      { id: 'sc_bridge', title: 'Bridge', purpose: 'Unchanged checkpoint.', blocks: [
        { id: 'n_bridge', kind: 'narration', text: 'I paused before listening again.', mode: 'live', claims: [] },
      ] },
    ] },
    { id: 'seg_late', title: 'Late', scenes: [
      { id: 'sc_payoff', title: 'Payoff', purpose: 'Answer the question.', blocks: [
        narration('n_payoff', 'According to Oor, he was angry he could not share it.'),
      ] },
    ] },
  ],
});
const allowed = new Set(['sc_setup', 'sc_payoff']);
const targets = (v = baseline()): NarrationTarget[] => [
  { sceneId: 'sc_setup', blockId: 'n_setup', sourceText: (v.segments[0].scenes[0].blocks[1] as any).text },
  { sceneId: 'sc_payoff', blockId: 'n_payoff', sourceText: (v.segments[1].scenes[0].blocks[0] as any).text },
];
const issue = (v = baseline()): Critique => ({
  id: 'cr_link', versionId: v.id, level: 'scene', targetId: 'sc_setup', issue: 'The setup and payoff do not connect.',
  consequence: 'The listener loses the question.', criterion: 'payoff', severity: 'major', proposedFix: 'Connect the early question and later reaction.', linkedTargets: targets(v),
});
const texts = [
  'According to Oor, the cake is orange citrus. I kept listening for his reaction.',
  'According to Oor, he could not share the cake. That was the reaction I had been waiting for.',
];
const edits = (v = baseline()) => targets(v).map((t, i) => ({ ...t, text: texts[i], claims: [ref] }));

describe('linked narration contract', () => {
  it('binds exact discovery excerpts to full baseline checkpoints', () => {
    const result = validateLinkedTargets(baseline(), 'sc_setup', targets().map(t => ({ ...t, sourceText: t.sourceText.slice(0, 30) })), allowed);
    expect(result).toEqual({ ok: true, value: targets() });
  });

  it.each(['scope', 'duplicate', 'stale', 'locked', 'quote', 'heading', 'cue', 'music', 'pause', 'one_scene', 'missing_primary', 'too_many'])('rejects an invalid %s target set', kind => {
    let ts = targets();
    let scope = allowed;
    if (kind === 'scope') scope = new Set(['sc_setup']);
    if (kind === 'duplicate') ts = [ts[0], ts[0], ts[1]];
    if (kind === 'stale') ts[1].sourceText = 'Invented source text.';
    if (['locked', 'quote', 'heading', 'cue', 'music', 'pause'].includes(kind)) ts[0].blockId = kind === 'locked' ? 'n_locked' : kind;
    if (kind === 'one_scene') ts = [ts[0], { ...ts[0], blockId: 'other' }];
    if (kind === 'missing_primary') return expect(validateLinkedTargets(baseline(), 'sc_bridge', ts, scope).ok).toBe(false);
    if (kind === 'too_many') ts = Array.from({ length: 9 }, () => ts[0]);
    expect(validateLinkedTargets(baseline(), 'sc_setup', ts, scope).ok).toBe(false);
  });

  it('reconstructs just the declared narration, preserving protected blocks, metadata and order', () => {
    const base = baseline();
    const before = structuredClone(base);
    const result = applyLinkedNarration(base, issue(base), base.id, edits(base), allowed, { newVersionId: 'v_linked', now: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(base).toEqual(before);
    expect(result.version).toMatchObject({ id: 'v_linked', parentId: base.id, changedScope: { level: 'scene', ids: ['sc_setup', 'sc_payoff'] } });
    expect(diffVersions(base.segments, result.version.segments).map(d => [d.blockId, d.change])).toEqual([['n_setup', 'changed'], ['n_payoff', 'changed']]);
    expect([...changedBlockIds(base.segments, result.version.segments)]).toEqual(['n_setup', 'n_payoff']);
    expect(result.version.segments[0].scenes[0].blocks.slice(2)).toEqual(base.segments[0].scenes[0].blocks.slice(2));
    expect(result.version.segments[0].scenes[1]).toEqual(base.segments[0].scenes[1]);
  });

  it.each(['baseline', 'critique_baseline', 'checkpoint', 'missing', 'extra', 'duplicate', 'stale_edit', 'no_change', 'blank'])('rejects a whole group for %s without changing the baseline', kind => {
    const base = baseline();
    const before = structuredClone(base);
    const crit = issue(base);
    let es = edits(base);
    let id = base.id;
    if (kind === 'baseline') id = 'v_stale';
    if (kind === 'critique_baseline') crit.versionId = 'v_stale';
    if (kind === 'checkpoint') crit.linkedTargets![1].sourceText = crit.linkedTargets![1].sourceText.slice(0, 30);
    if (kind === 'missing') es = es.slice(0, 1);
    if (kind === 'extra') es.push({ ...es[0], blockId: 'n_bridge', sceneId: 'sc_bridge' });
    if (kind === 'duplicate') es[1] = es[0];
    if (kind === 'stale_edit') es[1].sourceText = 'An old line.';
    if (kind === 'no_change') es[1].text = es[1].sourceText;
    if (kind === 'blank') es[1].text = ' ';
    expect(applyLinkedNarration(base, crit, id, es, allowed, { newVersionId: 'v_linked', now: 2 }).ok).toBe(false);
    expect(base).toEqual(before);
  });

  it('shows complete linked scenes and neighbour checkpoints to reviewers without version or block IDs', () => {
    const text = JSON.stringify(linkedRevisionView(baseline(), ['sc_setup', 'sc_payoff'], {}));
    for (const s of ['I paused before listening again.', 'Keep the room tone.', 'Fade here.', 'QUOTE_READ', 'Oor']) expect(text).toContain(s);
    for (const id of ['v_base', 'n_setup', 'sc_setup', 'cr_link']) expect(text).not.toContain(id);
    const context = linkedStoryContext(baseline().segments, allowed);
    expect(context.map(sc => sc.sceneId)).toEqual(['sc_setup', 'sc_payoff']);
    expect(context.flatMap(sc => sc.narration).map(n => n.blockId)).toEqual(['n_setup', 'n_payoff']);
  });
});

describe('linked refinement through the real HTTP entry points', () => {
  let root: string;
  let server: http.Server;
  let url: string;
  let mw: ReturnType<typeof createScriptStudioMiddleware>;
  let base: ScriptVersion;
  let calls: CliCall[];
  let mode: 'good' | 'incomplete' | 'stale' | 'out_of_scope' | 'unsupported' | 'missing_fact' | 'duplicate_fact' | 'bad_evidence' | 'no_claims' | 'tie' | 'single';
  let pauseNext: string | undefined;

  const responder: Responder = (kind, prompt) => {
    if (pauseNext === kind) {
      pauseNext = undefined;
      return { __fail: { code: 1, stdout: "You've hit your usage limit. Try again at 4:12 PM.", stderr: '', timedOut: false, aborted: false } };
    }
    if (kind === 'critique') {
      const segment = JSON.parse(/Segment \(JSON\):\n<<<TRANSCRIPT_DATA[^\n]*\n([\s\S]*?)\n<<<END_TRANSCRIPT_DATA>>>/.exec(prompt)![1]);
      if (!segment.scenes.some((sc: any) => sc.sceneId === 'sc_setup')) return { critiques: [] };
      const cr = issue(base);
      return { critiques: [{ ...cr, linkedTargets: mode === 'single' ? undefined : cr.linkedTargets!.map(t => ({ ...t, sourceText: t.sourceText.slice(0, 30) })) }] };
    }
    if (kind === 'reviseLinked') {
      const required = JSON.parse(/Required targets[^\n]*\n<<<TRANSCRIPT_DATA[^\n]*\n([\s\S]*?)\n<<<END_TRANSCRIPT_DATA>>>/.exec(prompt)![1]) as NarrationTarget[];
      const es = required.map((t, i) => ({ ...t, text: texts[i], claims: [{ utteranceIds: ['u92', 'u93'], verbatim: mode === 'bad_evidence' && i === 1 ? 'Invented evidence.' : QUOTE }] }));
      if (mode === 'incomplete') es.pop();
      if (mode === 'out_of_scope') es[1].sceneId = 'sc_bridge';
      if (mode === 'no_claims') for (const e of es) e.claims = [];
      return { baselineId: mode === 'stale' ? 'v_old' : base.id, edits: es, summary: 'Connected question and reaction.' };
    }
    if (kind === 'revise') return { summary: 'Legacy scene revision.', blocks: [{ kind: 'narration', text: texts[0], claims: [] },
      ...base.segments[0].scenes[0].blocks.filter(b => b.id !== 'n_setup').map(b => ({ kind: 'keep', id: b.id })),
    ] };
    if (kind === 'factcheck') {
      const rows = [0, 1].map(index => ({ index, label: ['unsupported', 'no_claims'].includes(mode) && index === 1 ? 'unsupported' : 'supported', note: 'Checked against supplied recording.' }));
      if (mode === 'missing_fact') rows.pop();
      if (mode === 'duplicate_fact') rows[1].index = 0;
      return { claims: rows };
    }
    if (kind === 'judge') return { winner: mode === 'tie' ? 'tie' : prompt.split('Version B (JSON):')[0].includes(mode === 'single' ? texts[0] : texts[1]) ? 'A' : 'B', reasons: ['The setup leads to the payoff.'] };
    throw new Error(`Unexpected model call ${kind}`);
  };

  async function api(method: string, route: string, body?: unknown) {
    const r = await fetch(`${url}${route}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: await r.json() as any };
  }
  async function finishRun(id: string) {
    for (let i = 0; i < 300 && mw.engine.isActive(id); i++) await new Promise(r => setTimeout(r, 10));
    expect(mw.engine.isActive(id)).toBe(false);
    return (await api('GET', `/run?projectId=${base.projectId}&runId=${id}`)).json;
  }
  async function refine(extra = {}) {
    const r = await api('POST', '/refine', { projectId: base.projectId, mode: 'subscription', maxRounds: 1, episodePass: false, ...extra });
    expect(r.status).toBe(202);
    return finishRun(r.json.runId);
  }

  beforeEach(async () => {
    mode = 'good'; pauseNext = undefined; calls = [];
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-linked-'));
    const ep = path.join(root, 'public', 'transcripts', 'episodes');
    fs.mkdirSync(ep, { recursive: true });
    fs.copyFileSync(fixtureTranscriptPath(TAG), path.join(ep, `${TAG}.json`));
    mw = createScriptStudioMiddleware({ root, runner: makeFakeCli(responder, calls), getEnv: () => ({ PATH: '/bin' }),
      fetchImpl: (async () => { throw new Error('Network is forbidden in linked revision tests.'); }) as typeof fetch,
      resolveOverride: async name => ({ ok: true, file: `/usr/local/bin/${name}`, prefixArgs: [], via: 'path', found: `/usr/local/bin/${name}` }),
    });
    server = http.createServer((req, res) => { req.url = (req.url || '').replace(/^\/api\/script/, '') || '/'; void mw(req, res); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/script`;
    const p = (await api('POST', '/project', { releaseTag: TAG, targetRuntimeSec: 70 })).json.project;
    base = { ...baseline(), projectId: p.id };
    // An actual tape block must survive; no clip lookup or paid analysis is needed.
    const tapeText = mw.engine.transcript(TAG).utterances.filter(u => ['u92', 'u93'].includes(u.id)).map(u => u.text).join(' ');
    p.clips = [{ clipId: 'clip_tape', title: 'The cake', speaker: 'Oor', releaseTag: TAG, audioUrl: '/audio/test.mp3', durationSec: 34.44, text: tapeText }];
    base.segments[1].scenes[0].blocks.push({ id: 'tape', kind: 'clip', clipId: 'clip_tape', keptText: tapeText, inSec: 0, outSec: 34.44, trimBasis: 'full', fn: 'evidence', rationale: 'Original recording.' });
    p.headVersionId = base.id;
    mw.store.saveVersion(base); mw.store.saveProject(p);
  });

  afterEach(async () => {
    if (server) await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
    if (root?.startsWith(path.join(os.tmpdir(), 'sp-linked-'))) fs.rmSync(root, { recursive: true, force: true });
  });

  it('accepts a complete cross-segment group as one reversible candidate, preserving tape and cues', async () => {
    const result = await refine();
    expect(result.run).toMatchObject({ status: 'finished', refinedSceneIds: ['sc_setup', 'sc_payoff'] });
    expect(result.candidates).toHaveLength(1);
    const cand = result.candidates[0];
    expect(cand.decision).toMatchObject({ baselineId: base.id, promptVersion: 'revise-linked.v1', loopAccepted: true,
      linkedIssue: { targets: targets(base) }, judge: { consensus: 'two_wins', promptVersion: 'judge-linked.v1' }, gates: { factual: 'pass' },
    });
    expect(cand.diff.map((d: any) => [d.blockId, d.change])).toEqual([['n_setup', 'changed'], ['n_payoff', 'changed']]);
    expect(result.run.bestVersionId).toBe(cand.id);
    expect(mw.store.getProject(base.projectId)!.headVersionId).toBe(base.id);
    for (const p of calls.filter(c => c.stdin.includes('Version A (JSON):')).map(c => c.stdin)) {
      for (const text of [texts[0], texts[1], 'I paused before listening again.', 'Keep the room tone.']) expect(p).toContain(text);
      expect(p).not.toContain(base.id);
      expect(p).not.toContain('n_setup');
    }
    const fc = calls.find(c => c.stdin.includes('Combined story context'))!;
    expect(fc.stdin).toContain(texts[0]); expect(fc.stdin).toContain(texts[1]);
    expect(cand.decision.gates.factcheck).toHaveLength(2);
    const accepted = await api('POST', '/decide', { projectId: base.projectId, candidateId: cand.id, decision: 'accept' });
    expect(accepted.status).toBe(200);
    expect(accepted.json.project.headVersionId).toBe(cand.id);
    const restored = await api('POST', '/head', { projectId: base.projectId, versionId: base.id });
    expect(restored.status).toBe(200);
    expect(mw.store.getVersion(base.projectId, base.id)).toEqual(base);
    expect(restored.json.project.headVersionId).toBe(base.id);
  });

  it.each(['incomplete', 'stale', 'out_of_scope'] as const)('rejects %s groups without a candidate or partial advancement', async bad => {
    mode = bad;
    const result = await refine();
    expect(result.candidates).toEqual([]);
    expect(result.run.bestVersionId).toBe(base.id);
    expect(result.run.events.some((e: any) => e.type === 'gates' && e.message.startsWith('Revision rejected:'))).toBe(true);
    expect(mw.store.listVersions(base.projectId)).toHaveLength(1);
    expect(mw.store.getVersion(base.projectId, base.id)).toEqual(base);
    expect(calls.some(c => c.stdin.includes('Version A (JSON):'))).toBe(false);
  });

  it.each(['unsupported', 'missing_fact', 'duplicate_fact', 'bad_evidence', 'no_claims'] as const)('rejects the complete candidate when one member has %s', async bad => {
    mode = bad;
    const result = await refine();
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].decision).toMatchObject({ loopAccepted: false, gates: { factual: 'fail' } });
    expect(result.candidates[0].diff).toHaveLength(2);
    expect(result.run.bestVersionId).toBe(base.id);
    expect(calls.some(c => c.stdin.includes('Version A (JSON):'))).toBe(false);
  });

  it('keeps both scenes unchanged when the blind judge ties, and rejects the candidate through existing controls', async () => {
    mode = 'tie';
    const result = await refine();
    const cand = result.candidates[0];
    expect(cand.decision).toMatchObject({ loopAccepted: false, judge: { consensus: 'rejected' } });
    expect(result.run.bestVersionId).toBe(base.id);
    const rejected = await api('POST', '/decide', { projectId: base.projectId, candidateId: cand.id, decision: 'reject' });
    expect(rejected.status).toBe(200);
    expect(rejected.json.project.headVersionId).toBe(base.id);
  });

  it('does not widen a selected-scene run to accommodate a linked critique', async () => {
    const result = await refine({ targetSceneIds: ['sc_setup'] });
    expect(result.candidates).toEqual([]);
    expect(result.run.critiques).toEqual([]);
    expect(result.run.bestVersionId).toBe(base.id);
    expect(calls.filter(c => c.cli === 'claude')).toHaveLength(1);
  });

  it('blocks promotion over a divergent manual edit without changing either version or the decision', async () => {
    const result = await refine();
    const cand = result.candidates[0];
    const divergent = structuredClone(base);
    divergent.id = 'v_manual'; divergent.parentId = base.id;
    (divergent.segments[0].scenes[1].blocks[0] as any).text = 'My new manual narration.';
    const p = mw.store.getProject(base.projectId)!;
    mw.store.saveVersion(divergent);
    mw.store.saveProject({ ...p, headVersionId: divergent.id });
    const accepted = await api('POST', '/decide', { projectId: base.projectId, candidateId: cand.id, decision: 'accept' });
    expect(accepted).toMatchObject({ status: 409, json: { code: 'CONFLICT' } });
    expect(mw.store.getProject(base.projectId)!.headVersionId).toBe(divergent.id);
    expect(mw.store.getVersion(base.projectId, divergent.id)).toEqual(divergent);
    expect(mw.store.getVersion(base.projectId, cand.id)!.decision!.loganDecision).toBeUndefined();
  });

  it('uses both explicitly selected scenes and respects critique-only runs', async () => {
    const only = await refine({ targetSceneIds: [...allowed], critiqueOnly: true });
    expect(only.run).toMatchObject({ stopReason: 'critique_only', critiques: [{ linkedTargets: targets(base) }] });
    expect(only.candidates).toEqual([]);
    const result = await refine({ targetSceneIds: [...allowed] });
    expect(result.candidates[0].decision.loopAccepted).toBe(true);
  });

  it.each(['reviseLinked', 'factcheck', 'judge'])('pauses on %s limits, then resumes the complete group from the saved baseline', async role => {
    pauseNext = role;
    let result = await refine();
    expect(result.run.status).toBe('paused_limit');
    expect(result.run.bestVersionId).toBe(base.id);
    if (role !== 'reviseLinked') expect(result.candidates).toHaveLength(1);
    const resumed = await api('POST', '/resume', { projectId: base.projectId, runId: result.run.id });
    expect(resumed.status).toBe(202);
    result = await finishRun(result.run.id);
    expect(result.run.status).toBe('finished');
    expect(result.candidates.filter((c: any) => c.decision.loopAccepted)).toHaveLength(1);
    expect(result.run.bestVersionId).not.toBe(base.id);
    expect(mw.store.getProject(base.projectId)!.headVersionId).toBe(base.id);
  });

  it('retains legacy single-scene revisions when the critic omits linkedTargets', async () => {
    mode = 'single';
    const result = await refine({ targetSceneIds: ['sc_setup'] });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].decision).toMatchObject({ promptVersion: 'revise.v3', loopAccepted: true });
    expect(result.candidates[0].decision.linkedIssue).toBeUndefined();
    expect(result.run.refinedSceneIds).toEqual(['sc_setup']);
    expect(mw.store.getVersion(base.projectId, result.run.bestVersionId)!.segments[1]).toEqual(base.segments[1]);
  });
});
