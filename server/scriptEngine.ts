/**
 * Script Studio engine: analysis, clip tagging, outline, draft and the background refinement loop.
 * Pure orchestration over injected providers, store and data, so every step is unit-testable with
 * injected process runners and no real CLI or network.
 */
import { EventEmitter } from 'node:events';
import type {
  Critique, EpisodeAnalysis, EpisodeFormat, MomentInsight, RefinementDecision, Role, RoleMap, RunEvent,
  ScriptProject, ScriptRun, ScriptVersion, Segment, StudioClip,
} from '../utils/scriptTypes';
import {
  allBlocks, anonymousScene, applyPatch, boundaryLines, changedBlockIds, codeGates, findScene, judgeConsensus,
  localTextChecks, materializeBlocks, mostConsequential, verifyVerbatim, type PatchBlock, type TrimFn,
} from '../utils/scriptGates';
import { makeClipTrim } from '../utils/scriptTrim';
import * as P from './scriptPrompts';
import {
  chunkUtterances, displayName, namedSegments, readTranscript, toEvidenceRefs, utteranceLine,
  type LoadedTranscript,
} from './scriptData';
import { roleMapNeedsBudget, verifyCrossFamily, type Budget, type CompleteResult, type ProviderRegistry } from './scriptProviders';
import { newId, StoreError, type ScriptStore } from './scriptStore';
import { Limiter } from './directorMiddleware';

export const MAX_ROUNDS = 4;
export const LEDGER_MAX_CHARS = 1500 * 4;
const CALL_TIMEOUT_MS = 10 * 60_000;
// Provider problems Logan can fix (or switch away from) without losing the run: the run pauses.
const PAUSE_CODES = new Set(['USAGE_LIMIT', 'RATE_LIMIT', 'NOT_SIGNED_IN', 'NOT_INSTALLED', 'NO_KEY', 'NOT_ALLOWED']);

export interface EngineDeps {
  root: string;
  store: ScriptStore;
  registry: ProviderRegistry;
  now?: () => number;
  limiter?: Limiter;
}

export class StepError extends Error {
  constructor(public code: string, message: string, public rawOutput = '', public extra: Record<string, unknown> = {}) { super(message); }
}

type CallCtx = { roleMap: RoleMap; budget: Budget; signal: AbortSignal; runId?: string; label: string };

export function createEngine(deps: EngineDeps) {
  const now = deps.now ?? Date.now;
  const limiter = deps.limiter ?? new Limiter(3);
  const bus = new EventEmitter();
  bus.setMaxListeners(100);
  const controllers = new Map<string, AbortController>();
  const transcripts = new Map<string, LoadedTranscript>();

  function transcript(tag: string): LoadedTranscript {
    const cached = transcripts.get(tag);
    if (cached) return cached;
    const t = readTranscript(deps.root, tag);
    if (!t) throw new StepError('NO_TRANSCRIPT', `No transcript on disk for ${tag} (public/transcripts/episodes/${tag}.json).`);
    transcripts.set(tag, t);
    return t;
  }

  async function call(role: Role, prompt: P.Prompt, ctx: CallCtx): Promise<CompleteResult & { promptVersion: string }> {
    const spec = ctx.roleMap[role];
    if (!spec) throw new StepError('NO_ROLE', `No provider configured for the ${role} role.`);
    const adapter = deps.registry.adapterFor(spec, ctx.budget);
    if (!adapter) throw new StepError('NO_ROLE', `Unknown provider "${spec}" for the ${role} role.`);
    const r = await limiter.run(() => adapter.complete({
      role, system: prompt.system, user: prompt.user, schema: prompt.schema, schemaName: prompt.schemaName,
      maxTokens: prompt.maxTokens, timeoutMs: CALL_TIMEOUT_MS, signal: ctx.signal,
    }));
    const entry = {
      at: now(), role, label: ctx.label, provider: r.provider, model: r.model, promptVersion: prompt.version,
      ok: r.ok, code: r.ok ? undefined : r.code, durationMs: r.durationMs,
      inTok: r.ok ? r.usage?.inTok : undefined, outTok: r.ok ? r.usage?.outTok : undefined, costUsd: r.ok ? r.usage?.costUsd : undefined,
      message: r.ok ? undefined : r.message,
    };
    if (ctx.runId) deps.store.appendLog(ctx.runId, entry);
    else deps.store.appendLog('interactive', entry);
    return { ...r, promptVersion: prompt.version };
  }

  const failToError = (r: Extract<CompleteResult, { ok: false }>, what: string) =>
    new StepError(r.code, `${what}: ${r.provider} (${r.model}) ${r.code}: ${r.message}`, r.rawOutput, { resetHint: r.resetHint, provider: r.provider });

  /* ---------------------------------------------------------------------------------------------- */
  /* Analysis                                                                                       */
  /* ---------------------------------------------------------------------------------------------- */

  async function analyze(project: ScriptProject, releaseTag: string, ctx: CallCtx, force = false): Promise<EpisodeAnalysis> {
    const t = transcript(releaseTag);
    const names = project.speakerNames || {};
    if (!force) {
      const cached = deps.store.getAnalysis(releaseTag, P.PROMPT_VERSIONS.analysis, t.hash);
      if (cached) return cached;
    }
    const chunks = chunkUtterances(t.utterances, names);
    const byId = new Map(t.utterances.map(u => [u.id, u]));
    const segs = namedSegments(t, names);
    let ledger = '';
    const chunkStatus: EpisodeAnalysis['chunks'] = [];
    const partials: any[] = [];
    let provider = '';
    let model = '';
    for (let i = 0; i < chunks.length; i++) {
      const prompt = P.analysisPrompt({ releaseTag, title: t.title, chunkIndex: i, chunkCount: chunks.length, lines: chunks[i], ledger });
      let r = await call('analyst', prompt, { ...ctx, label: `analysis chunk ${i + 1}/${chunks.length}` });
      if (!r.ok && !PAUSE_CODES.has(r.code) && r.code !== 'ABORTED') r = await call('analyst', prompt, { ...ctx, label: `analysis chunk ${i + 1}/${chunks.length} (retry)` });
      if (!r.ok) {
        if (PAUSE_CODES.has(r.code) || r.code === 'ABORTED' || r.code === 'BUDGET_EXCEEDED') throw failToError(r, `Analysis chunk ${i + 1} of ${chunks.length}`);
        chunkStatus.push({ index: i, ok: false, error: `chunk ${i + 1} of ${chunks.length} failed: ${r.code}: ${r.message}` });
        continue;
      }
      provider = r.provider; model = r.model;
      const j: any = r.json;
      ledger = String(j?.ledger || '').slice(0, LEDGER_MAX_CHARS);
      partials.push(j);
      chunkStatus.push({ index: i, ok: true });
    }
    if (!partials.length) throw new StepError('ANALYSIS_FAILED', `Every analysis chunk failed: ${chunkStatus.map(c => c.error).join('; ')}`);

    // Validate moments in code: utterance ids must exist; quotes must be verbatim same-speaker speech.
    const moments: MomentInsight[] = [];
    const seen = new Set<string>();
    for (const part of partials) for (const m of Array.isArray(part?.moments) ? part.moments : []) {
      const ids: string[] = (m?.utteranceIds || []).filter((id: string) => byId.has(id));
      if (!ids.length || !m?.id || seen.has(m.id)) continue;
      const us = ids.map(id => byId.get(id)!);
      const ev = toEvidenceRefs(m.quotes, t, names);
      const evidence = ev.ok ? ev.refs.filter(r => verifyVerbatim(r, segs, {}).ok) : [];
      seen.add(m.id);
      moments.push({
        id: String(m.id), releaseTag, start: Math.min(...us.map(u => u.start)), end: Math.max(...us.map(u => u.end)),
        kind: m.kind, why: String(m.why || ''), themes: Array.isArray(m.themes) ? m.themes.map(String) : [],
        speakers: [...new Set(us.map(u => displayName(u.speaker, names)))], evidence, utteranceIds: ids,
      });
    }
    let themes = partials.flatMap(p => (Array.isArray(p?.themes) ? p.themes : []));
    let dynamics = partials.flatMap(p => (Array.isArray(p?.dynamics) ? p.dynamics : []));
    let openQuestions: string[] = partials.flatMap(p => (Array.isArray(p?.openQuestions) ? p.openQuestions : []));
    let kept = moments;
    if (partials.length > 1) {
      const summaries = JSON.stringify(partials.map(p => ({ themes: p.themes, dynamics: p.dynamics, moments: (p.moments || []).map((m: any) => ({ id: m.id, kind: m.kind, why: m.why, themes: m.themes })), openQuestions: p.openQuestions })));
      const r = await call('analyst', P.reducePrompt({ releaseTag, title: t.title, chunkSummaries: summaries, ledger }), { ...ctx, label: 'analysis reduce' });
      if (!r.ok) throw failToError(r, 'Analysis merge');
      const j: any = r.json;
      themes = j.themes || themes;
      dynamics = j.dynamics || dynamics;
      openQuestions = j.openQuestions || openQuestions;
      const keep = new Set<string>((j.keepMomentIds || []).map(String));
      if (keep.size) kept = moments.filter(m => keep.has(m.id));
    }
    const momentIds = new Set(kept.map(m => m.id));
    const analysis: EpisodeAnalysis = {
      releaseTag, transcriptHash: t.hash, promptVersion: P.PROMPT_VERSIONS.analysis, provider, model,
      themes: themes.map((th: any) => ({ id: String(th.id), label: String(th.label), summary: String(th.summary), momentIds: (th.momentIds || []).map(String).filter((id: string) => momentIds.has(id)) })),
      dynamics: dynamics.map((d: any) => ({ speaker: String(d.speaker), role: String(d.role), stance: String(d.stance) })),
      moments: kept, openQuestions: openQuestions.map(String), chunks: chunkStatus, createdAt: now(),
    };
    deps.store.saveAnalysis(analysis);
    return analysis;
  }

  /* ---------------------------------------------------------------------------------------------- */
  /* Clips                                                                                          */
  /* ---------------------------------------------------------------------------------------------- */

  const clipView = (c: StudioClip, maxText = 280) => ({ clipId: c.clipId, title: c.title, speaker: c.speaker, fn: c.fn ?? null, durationSec: c.durationSec, text: c.text.slice(0, maxText) });

  async function tagClips(project: ScriptProject, analysis: EpisodeAnalysis, ctx: CallCtx): Promise<StudioClip[]> {
    if (!project.clips.length) return project.clips;
    const summary = JSON.stringify({ themes: analysis.themes.map(t => ({ label: t.label, summary: t.summary })), moments: analysis.moments.slice(0, 40).map(m => ({ kind: m.kind, why: m.why })) });
    const r = await call('analyst', P.clipTagsPrompt({ analysisSummary: summary, clips: JSON.stringify(project.clips.map(c => clipView(c))) }), { ...ctx, label: 'clip tags' });
    if (!r.ok) throw failToError(r, 'Clip tagging');
    const tags = new Map<string, { fn: any; rationale: string }>();
    for (const t of (r.json as any)?.tags || []) if (t?.clipId) tags.set(String(t.clipId), { fn: t.fn, rationale: String(t.rationale || '') });
    return project.clips.map(c => (tags.has(c.clipId) ? { ...c, fn: tags.get(c.clipId)!.fn, fnRationale: tags.get(c.clipId)!.rationale } : c));
  }

  /* ---------------------------------------------------------------------------------------------- */
  /* Outline and draft                                                                              */
  /* ---------------------------------------------------------------------------------------------- */

  const memoryText = () => deps.store.getMemory().styleRules.slice(0, 30).map(r => `- ${r.rule}`).join('\n');

  async function outline(project: ScriptProject, analysis: EpisodeAnalysis, ctx: CallCtx): Promise<ScriptVersion> {
    const r = await call('reviser', P.outlinePrompt({
      format: project.format, targetRuntimeSec: project.targetRuntimeSec, memory: memoryText(),
      analysis: JSON.stringify({ themes: analysis.themes, dynamics: analysis.dynamics, moments: analysis.moments.map(m => ({ id: m.id, kind: m.kind, why: m.why, speakers: m.speakers, themes: m.themes })), openQuestions: analysis.openQuestions }),
      clips: JSON.stringify(project.clips.map(c => clipView(c))),
    }), { ...ctx, label: 'outline' });
    if (!r.ok) throw failToError(r, 'Outline');
    const clipIds = new Set(project.clips.map(c => c.clipId));
    const momentIds = new Set(analysis.moments.map(m => m.id));
    const j: any = r.json;
    const segments: Segment[] = [];
    for (const s of j?.segments || []) {
      const scenes = [];
      for (const sc of s?.scenes || []) {
        const bad = (sc?.clipIds || []).filter((id: string) => !clipIds.has(id));
        if (bad.length) throw new StepError('INVENTED_CLIP', `The outline names clip ids that do not exist: ${bad.join(', ')}. Outline not saved.`, JSON.stringify(j));
        scenes.push({ id: newId('sc'), title: String(sc.title || ''), purpose: String(sc.purpose || ''), blocks: [], suggestedClipIds: sc.clipIds || [], momentIds: (sc.momentIds || []).filter((id: string) => momentIds.has(id)) });
      }
      segments.push({ id: newId('seg'), title: String(s.title || ''), scenes });
    }
    if (!segments.length) throw new StepError('BAD_OUTPUT', 'The outline had no segments.', JSON.stringify(j));
    const v: ScriptVersion = { id: newId('v'), parentId: project.headVersionId, projectId: project.id, createdAt: now(), author: 'loop', label: 'Outline', segments };
    deps.store.saveVersion(v);
    return v;
  }

  function trimFor(project: ScriptProject): TrimFn {
    return makeClipTrim(tag => { try { return namedSegments(transcript(tag), project.speakerNames || {}); } catch { return undefined; } });
  }

  function evidenceLines(project: ScriptProject, analysis: EpisodeAnalysis | null, momentIds: string[], extraUtteranceIds: string[] = []): string {
    const tag = project.sourceTags[0];
    const t = transcript(tag);
    const names = project.speakerNames || {};
    const idx = new Set<number>();
    const byId = new Map(t.utterances.map((u, i) => [u.id, i]));
    const add = (id: string) => { const i = byId.get(id); if (i == null) return; for (let k = Math.max(0, i - 2); k <= Math.min(t.utterances.length - 1, i + 2); k++) idx.add(k); };
    for (const m of analysis?.moments || []) if (momentIds.includes(m.id)) m.utteranceIds.forEach(add);
    extraUtteranceIds.forEach(add);
    return [...idx].sort((a, b) => a - b).slice(0, 400).map(i => utteranceLine(t.utterances[i], names)).join('\n');
  }

  function toPatch(blocks: any[], project: ScriptProject): { ok: true; patch: PatchBlock[] } | { ok: false; reason: string } {
    const t = transcript(project.sourceTags[0]);
    const out: PatchBlock[] = [];
    for (const b of blocks || []) {
      if (b?.kind === 'narration') {
        const ev = toEvidenceRefs(b.claims, t, project.speakerNames || {});
        if (ev.ok === false) return ev;
        out.push({ kind: 'narration', text: String(b.text || ''), mode: b.mode === 'polished' ? 'polished' : 'live', claims: ev.refs });
      } else if (b?.kind === 'keep') out.push({ kind: 'keep', id: String(b.id) });
      else if (b?.kind === 'clip') out.push({ kind: 'clip', clipId: String(b.clipId), keptText: String(b.keptText || ''), fn: b.fn || undefined, rationale: String(b.rationale || '') });
      else if (b?.kind === 'pause') out.push({ kind: 'pause', sec: Number(b.sec) });
      else if (b?.kind === 'music') out.push({ kind: 'music', cue: String(b.cue), note: String(b.note || '') });
      else return { ok: false, reason: `Unknown block kind ${b?.kind}.` };
    }
    return { ok: true, patch: out };
  }

  function gateContext(project: ScriptProject, baseline: Segment[]) {
    const tr: Record<string, ReturnType<typeof namedSegments>> = {};
    for (const tag of project.sourceTags) { try { tr[tag] = namedSegments(transcript(tag), project.speakerNames || {}); } catch { /* missing */ } }
    return { baseline, transcripts: tr, clipsById: Object.fromEntries(project.clips.map(c => [c.clipId, c])), targetRuntimeSec: project.targetRuntimeSec, format: project.format as EpisodeFormat | null };
  }

  async function draft(project: ScriptProject, base: ScriptVersion, analysis: EpisodeAnalysis | null, ctx: CallCtx, styleCard = '', approvedPassages = ''): Promise<{ version: ScriptVersion; gates: ReturnType<typeof codeGates> }> {
    const clipsById = Object.fromEntries(project.clips.map(c => [c.clipId, c]));
    const trim = trimFor(project);
    const segments: Segment[] = [];
    for (const seg of base.segments) {
      const sceneView = seg.scenes.map(sc => ({ sceneId: sc.id, title: sc.title, purpose: sc.purpose, clipIds: sc.suggestedClipIds || [], lockedBlocks: sc.blocks.filter(b => b.locked) }));
      const usedClipIds = [...new Set(seg.scenes.flatMap(sc => sc.suggestedClipIds || []))];
      const clips = (usedClipIds.length ? usedClipIds.map(id => clipsById[id]).filter(Boolean) : project.clips).map(c => clipView(c, 1200));
      const momentIds = seg.scenes.flatMap(sc => sc.momentIds || []);
      const r = await call('reviser', P.draftPrompt({
        format: project.format, segmentTitle: seg.title, scenes: JSON.stringify(sceneView), styleCard, approvedPassages,
        evidence: evidenceLines(project, analysis, momentIds), clips: JSON.stringify(clips), memory: memoryText(),
      }), { ...ctx, label: `draft ${seg.title}` });
      if (!r.ok) {
        if (PAUSE_CODES.has(r.code) || r.code === 'ABORTED' || r.code === 'BUDGET_EXCEEDED') throw failToError(r, `Draft of "${seg.title}"`);
        segments.push({ ...seg, notDrafted: `${r.code}: ${r.message}` });
        continue;
      }
      const byScene = new Map<string, any[]>(((r.json as any)?.scenes || []).map((s: any) => [String(s.sceneId), s.blocks || []]));
      const scenes = [];
      let segError = '';
      for (const sc of seg.scenes) {
        const conv = toPatch(byScene.get(sc.id) || [], project);
        if (conv.ok === false) { segError = conv.reason; break; }
        const existing = new Map(sc.blocks.map(b => [b.id, b]));
        const mat = await materializeBlocks(conv.patch, existing, { clipsById, trim, newId: () => newId('b'), onBadTrim: 'flag' });
        if (mat.ok === false) { segError = mat.reason; break; }
        const missingLocks = sc.blocks.filter(b => b.locked && !mat.blocks.some(x => x.id === b.id));
        if (missingLocks.length) { segError = `Draft dropped locked block ${missingLocks[0].id}.`; break; }
        scenes.push({ ...sc, blocks: mat.blocks });
      }
      segments.push(segError ? { ...seg, notDrafted: segError } : { ...seg, scenes, notDrafted: undefined });
    }
    const v: ScriptVersion = { id: newId('v'), parentId: base.id, projectId: project.id, createdAt: now(), author: 'loop', label: 'Draft', segments };
    deps.store.saveVersion(v);
    return { version: v, gates: codeGates(segments, { ...gateContext(project, base.segments), changedBlockIds: undefined }) };
  }

  /* ---------------------------------------------------------------------------------------------- */
  /* Refinement runs                                                                                */
  /* ---------------------------------------------------------------------------------------------- */

  function emit(run: ScriptRun, e: Omit<RunEvent, 'seq' | 'at'>) {
    const ev: RunEvent = { seq: run.events.length + 1, at: now(), ...e };
    run.events.push(ev);
    run.updatedAt = ev.at;
    bus.emit(run.id, ev);
  }
  function save(run: ScriptRun) { deps.store.saveRun(run); }

  function createRun(project: ScriptProject, opts: { roleMap: RoleMap; mode: 'subscription' | 'fallback'; maxUsd: number; targetSceneIds?: string[]; maxRounds?: number }): ScriptRun {
    const cross = verifyCrossFamily(opts.roleMap);
    if (cross.ok === false) throw new StepError('CROSS_FAMILY', cross.reason);
    if (!project.headVersionId) throw new StepError('NO_SCRIPT', 'The project has no script version to refine yet.');
    const maxUsd = opts.mode === 'subscription' ? 0 : Math.max(0, Number(opts.maxUsd) || 0);
    if (roleMapNeedsBudget(opts.roleMap) && !(maxUsd > 0)) throw new StepError('NO_BUDGET', 'Fallback models need a dollar cap above $0 for this run.');
    const run: ScriptRun = {
      id: newId('run'), projectId: project.id, createdAt: now(), updatedAt: now(), status: 'queued', mode: opts.mode,
      maxUsd, spentUsd: 0, roleMap: opts.roleMap, baseVersionId: project.headVersionId, bestVersionId: project.headVersionId,
      currentRound: 0, maxRounds: Math.min(MAX_ROUNDS, Math.max(1, opts.maxRounds || MAX_ROUNDS)), staleCount: 0,
      targetSceneIds: opts.targetSceneIds?.length ? opts.targetSceneIds : undefined, refinedSceneIds: [], candidateIds: [], events: [],
    };
    emit(run, { type: 'status', message: 'Run created.' });
    save(run);
    return run;
  }

  function finish(run: ScriptRun, reason: ScriptRun['stopReason'], message: string) {
    run.status = reason === 'cancelled' ? 'cancelled' : reason === 'error' ? 'failed' : 'finished';
    run.stopReason = reason;
    emit(run, { type: 'finished', message, data: { stopReason: reason, bestVersionId: run.bestVersionId } });
    save(run);
  }

  function pause(run: ScriptRun, role: string, e: StepError | Extract<CompleteResult, { ok: false }>) {
    const code = e instanceof StepError ? e.code : e.code;
    const message = e instanceof StepError ? e.message : e.message;
    const provider = e instanceof StepError ? String(e.extra.provider || '') : e.provider;
    run.status = 'paused_limit';
    run.pausedInfo = { role, provider, code, message: `${message}${(e as any).resetHint || (e instanceof StepError && e.extra.resetHint) ? ` (${(e as any).resetHint || e instanceof StepError && e.extra.resetHint})` : ''}`, at: now() };
    emit(run, { type: 'status', message: `Paused: ${role} on ${provider} returned ${code}: ${message}`, role, provider, data: { raw: e instanceof StepError ? e.rawOutput : e.rawOutput } });
    save(run);
  }

  async function runJob(runId: string, projectId: string) {
    const run = deps.store.getRun(projectId, runId);
    if (!run) return;
    const project = deps.store.getProject(projectId);
    if (!project) return;
    const ctl = new AbortController();
    controllers.set(run.id, ctl);
    const budget: Budget = { maxUsd: run.maxUsd, spentUsd: run.spentUsd };
    const ctxFor = (label: string): CallCtx => ({ roleMap: run.roleMap, budget, signal: ctl.signal, runId: run.id, label });
    const syncBudget = () => { run.spentUsd = budget.spentUsd; };
    run.status = 'running';
    run.pausedInfo = undefined;
    emit(run, { type: 'status', message: run.currentRound > 0 ? `Resumed at round ${run.currentRound + 1}.` : 'Started.' });
    save(run);

    const handleFail = (role: string, r: Extract<CompleteResult, { ok: false }>): 'pause' | 'budget' | 'cancel' | 'skip' => {
      syncBudget();
      emit(run, { type: 'call', message: `${role} failed: ${r.code}: ${r.message}`, role, provider: r.provider, model: r.model, durationMs: r.durationMs, data: { raw: r.rawOutput.slice(0, 4000) } });
      if (r.code === 'ABORTED') return 'cancel';
      if (r.code === 'BUDGET_EXCEEDED') return 'budget';
      if (PAUSE_CODES.has(r.code)) { pause(run, role, r); return 'pause'; }
      return 'skip';
    };
    const okCall = (role: string, r: Extract<CompleteResult, { ok: true }>, what: string) => {
      syncBudget();
      emit(run, { type: 'call', message: `${role}: ${what}`, role, provider: r.provider, model: r.model, durationMs: r.durationMs, data: r.usage });
    };

    try {
      const transcriptSegs = gateContext(project, []).transcripts;
      if (!Object.keys(transcriptSegs).length) throw new StepError('NO_TRANSCRIPT', 'The project transcript is not on disk.');
      const clipsById = Object.fromEntries(project.clips.map(c => [c.clipId, c]));
      const trim = trimFor(project);
      const memory = deps.store.getMemory();
      const loaded = deps.store.getVersion(project.id, run.bestVersionId);
      if (!loaded) throw new StepError('NO_VERSION', `Version ${run.bestVersionId} is missing.`);
      let best: ScriptVersion = loaded;
      const targetIds = new Set(run.targetSceneIds || best.segments.flatMap(s => s.scenes.map(sc => sc.id)));

      for (let round = run.currentRound; round < run.maxRounds; round++) {
        emit(run, { type: 'round', message: `Round ${round + 1} of ${run.maxRounds}.` });
        // CRITIQUE: one call per segment that contains target scenes; locked blocks excluded.
        const crits: Critique[] = [];
        for (let si = 0; si < best.segments.length; si++) {
          const seg = best.segments[si];
          const scenes = seg.scenes.filter(sc => targetIds.has(sc.id));
          if (!scenes.length) continue;
          const view = { segmentId: seg.id, title: seg.title, scenes: scenes.map(sc => ({ sceneId: sc.id, title: sc.title, purpose: sc.purpose, blocks: sc.blocks.filter(b => !b.locked).map(b => anonymousBlock(b, clipsById)) })) };
          const prev = boundaryLines(best.segments[si - 1]?.scenes.slice(-1)[0]);
          const next = boundaryLines(best.segments[si + 1]?.scenes[0]);
          const neighbours = [prev ? `Before: ...${prev.last}` : '', next ? `After: ${next.first}...` : ''].filter(Boolean).join('\n');
          const r = await call('critic', P.critiquePrompt({ format: project.format, segment: JSON.stringify(view), neighbours, localNotes: scenes.flatMap(localTextChecks).join('\n'), memory: memory.styleRules.map(x => `- ${x.rule}`).join('\n') }), ctxFor(`critique ${seg.title}`));
          if (!r.ok) {
            const h = handleFail('critic', r);
            if (h === 'pause') return;
            if (h === 'cancel') return finish(run, 'cancelled', 'Cancelled.');
            if (h === 'budget') return finish(run, 'budget', `Stopped at budget. Scenes not yet refined: ${[...targetIds].filter(id => !run.refinedSceneIds.includes(id)).join(', ') || 'none'}.`);
            emit(run, { type: 'error', message: `Critique of segment "${seg.title}" failed this round and was skipped.` });
            continue;
          }
          okCall('critic', r, `critiqued "${seg.title}"`);
          const sceneIds = new Set(scenes.map(s => s.id));
          for (const c of (r.json as any)?.critiques || []) {
            if (!sceneIds.has(String(c?.targetId))) continue;
            crits.push({ id: newId('cr'), versionId: best.id, level: 'scene', targetId: String(c.targetId), issue: String(c.issue), consequence: String(c.consequence), criterion: c.criterion, severity: c.severity, proposedFix: String(c.proposedFix) });
          }
        }
        emit(run, { type: 'critique', message: `${crits.length} critiques.`, data: crits });
        save(run);
        const target = mostConsequential(crits);
        if (!target || target.severity === 'minor') return finish(run, 'no_major_issues', target ? 'Only minor critiques left.' : 'No critiques left.');

        // REVISE the one target scene.
        const loc = findScene(best.segments, target.targetId)!;
        const lockedIds = loc.scene.blocks.filter(b => b.locked).map(b => b.id);
        const neighbourScenes = [loc.segment.scenes[loc.sceneIndex - 1], loc.segment.scenes[loc.sceneIndex + 1]];
        const neighbours = neighbourScenes.map((s, i) => { const b = boundaryLines(s); return b ? `${i === 0 ? 'Before' : 'After'}: ${i === 0 ? b.last : b.first}` : ''; }).filter(Boolean).join('\n');
        const sceneClips = [...new Set([...(loc.scene.suggestedClipIds || []), ...loc.scene.blocks.filter(b => b.kind === 'clip').map(b => (b as any).clipId)])].map(id => clipsById[id]).filter(Boolean);
        const claimUtts = loc.scene.blocks.flatMap(b => (b.kind === 'narration' ? b.claims : [])).flatMap(c => {
          const t = transcript(c.releaseTag);
          return t.utterances.filter(u => u.end >= c.segStart && u.start <= c.segEnd).map(u => u.id);
        });
        const rev = await call('reviser', P.revisePrompt({
          format: project.format, critique: JSON.stringify(target), neighbours, lockedIds,
          scene: JSON.stringify({ sceneId: loc.scene.id, title: loc.scene.title, purpose: loc.scene.purpose, blocks: loc.scene.blocks }),
          evidence: evidenceLines(project, null, [], claimUtts), clips: JSON.stringify((sceneClips.length ? sceneClips : project.clips).map(c => clipView(c, 1200))),
          styleRules: memory.styleRules.map(x => `- ${x.rule}`).join('\n'),
        }), ctxFor(`revise ${loc.scene.title}`));
        if (!rev.ok) {
          const h = handleFail('reviser', rev);
          if (h === 'pause') return;
          if (h === 'cancel') return finish(run, 'cancelled', 'Cancelled.');
          if (h === 'budget') return finish(run, 'budget', 'Stopped at budget.');
          run.staleCount++; run.currentRound = round + 1; save(run);
          if (run.staleCount >= 2) break;
          continue;
        }
        okCall('reviser', rev, `revised "${loc.scene.title}"`);
        const conv = toPatch((rev.json as any)?.blocks || [], project);
        const patched: { ok: true; version: ScriptVersion } | { ok: false; reason: string } = conv.ok
          ? await applyPatch(best, loc.scene.id, conv.patch, { clipsById, trim, newId: () => newId('b'), onBadTrim: 'reject', newVersionId: newId('v'), now: now() })
          : conv;
        if (patched.ok === false) {
          emit(run, { type: 'gates', message: `Revision rejected: ${patched.reason}` });
          run.staleCount++; run.currentRound = round + 1; save(run);
          if (run.staleCount >= 2) break;
          continue;
        }
        const cand: ScriptVersion = patched.version;
        const changed = changedBlockIds(best.segments, cand.segments);
        const gates = codeGates(cand.segments, { ...gateContext(project, best.segments), changedBlockIds: changed });
        const decision: RefinementDecision = { candidateId: cand.id, baselineId: best.id, round, promptVersion: P.PROMPT_VERSIONS.revise, gates, loopAccepted: false };

        // FACT CHECK (different family from the writer) on the changed claims.
        if (gates.ok) {
          const claims = allBlocks(cand.segments).filter(b => b.kind === 'narration' && changed.has(b.id) && b.claims.length)
            .map((b, index) => ({ index, narration: (b as any).text, excerpts: (b as any).claims.map((c: any) => `${c.speaker}: ${c.verbatim}`) }));
          if (claims.length) {
            const fc = await call('factcheck', P.factcheckPrompt({ claims: JSON.stringify(claims) }), ctxFor('fact check'));
            if (!fc.ok) {
              const h = handleFail('factcheck', fc);
              if (h === 'pause') return;
              if (h === 'cancel') return finish(run, 'cancelled', 'Cancelled.');
              decision.notJudged = `Fact check failed: ${fc.code}: ${fc.message}`;
            } else {
              okCall('factcheck', fc, `checked ${claims.length} claims`);
              const labels = ((fc.json as any)?.claims || []).map((c: any) => ({ claim: claims[c.index]?.narration?.slice(0, 200) || `#${c.index}`, label: c.label, note: String(c.note || '') }));
              decision.gates.factcheck = labels;
              const bad = labels.filter((l: any) => l.label !== 'supported');
              if (bad.length) { decision.gates.factual = 'fail'; decision.gates.failures.push(...bad.map((l: any) => `Fact check: "${l.claim.slice(0, 80)}" is ${l.label}: ${l.note}`)); }
            }
          }
        }
        emit(run, { type: 'gates', message: decision.gates.failures.length ? `Gates failed: ${decision.gates.failures.join(' | ')}` : decision.notJudged || 'Gates passed.', data: decision.gates });
        const gatesPass = decision.gates.failures.length === 0;

        if (gatesPass && !decision.notJudged) {
          // BLIND PAIRWISE JUDGE, both orders at once.
          const baseView = anonymousScene(loc.scene, clipsById);
          const candView = anonymousScene(findScene(cand.segments, loc.scene.id)!.scene, clipsById);
          const [ab, ba] = await Promise.all([
            call('judge', P.judgePrompt({ format: project.format, a: baseView, b: candView }), ctxFor('judge A=baseline')),
            call('judge', P.judgePrompt({ format: project.format, a: candView, b: baseView }), ctxFor('judge A=candidate')),
          ]);
          const failed = [ab, ba].find(x => !x.ok) as Extract<CompleteResult, { ok: false }> | undefined;
          if (failed) {
            const h = handleFail('judge', failed);
            if (h === 'pause') { cand.decision = { ...decision, notJudged: `Judge paused: ${failed.code}` }; deps.store.saveVersion(cand); run.candidateIds.push(cand.id); save(run); return; }
            if (h === 'cancel') return finish(run, 'cancelled', 'Cancelled.');
            decision.notJudged = `Judge failed: ${failed.code}: ${failed.message}`;
          } else {
            const A = ab as Extract<CompleteResult, { ok: true }>;
            const B = ba as Extract<CompleteResult, { ok: true }>;
            okCall('judge', A, 'judged order AB'); okCall('judge', B, 'judged order BA');
            const wAB = (A.json as any)?.winner;
            const wBA = (B.json as any)?.winner;
            const verdict = judgeConsensus(wAB, wBA, target.severity);
            decision.judge = { provider: A.provider, model: A.model, winnerAB: wAB, winnerBA: wBA, consensus: verdict.consensus, reasons: [...((A.json as any)?.reasons || []), ...((B.json as any)?.reasons || [])].map(String) };
            decision.loopAccepted = verdict.win;
            emit(run, { type: 'judge', message: `Judge: AB=${wAB}, BA=${wBA} -> ${verdict.consensus}.`, data: decision.judge });
          }
        }
        cand.decision = decision;
        deps.store.saveVersion(cand);
        run.candidateIds.push(cand.id);
        if (!run.refinedSceneIds.includes(loc.scene.id)) run.refinedSceneIds.push(loc.scene.id);
        emit(run, { type: 'decision', message: decision.loopAccepted ? `Candidate ${cand.id} accepted by the loop.` : `Candidate ${cand.id} not accepted${decision.notJudged ? ` (${decision.notJudged})` : ''}.`, data: { candidateId: cand.id, loopAccepted: decision.loopAccepted } });
        if (decision.loopAccepted) { best = cand; run.bestVersionId = cand.id; run.staleCount = 0; } else run.staleCount++;
        run.currentRound = round + 1;
        save(run);
        if (run.staleCount >= 2) break;
      }
      return finish(run, run.currentRound >= run.maxRounds ? 'max_rounds' : 'marginal_gains', run.staleCount >= 2 ? 'Stopped after two rounds without a win.' : 'Reached the round limit.');
    } catch (e: any) {
      syncBudget();
      if (e instanceof StepError && PAUSE_CODES.has(e.code)) { pause(run, 'unknown', e); return; }
      const msg = e instanceof StoreError ? `Disk write failed at ${e.filePath}: ${e.osMessage}` : e?.message || String(e);
      run.error = msg;
      if (e instanceof StoreError) { run.status = 'paused_limit'; run.pausedInfo = { role: 'store', provider: 'disk', code: 'DISK', message: msg, at: now() }; emit(run, { type: 'error', message: `Paused: ${msg}` }); try { save(run); } catch { /* disk is failing */ } return; }
      emit(run, { type: 'error', message: msg });
      finish(run, 'error', `Failed: ${msg}`);
    } finally {
      controllers.delete(run.id);
    }
  }

  function anonymousBlock(b: any, clipsById: Record<string, StudioClip>) {
    if (b.kind === 'clip') return { id: b.id, kind: 'clip', speaker: clipsById[b.clipId]?.speaker, keptText: b.keptText, seconds: Math.round((b.outSec - b.inSec) * 10) / 10, fn: b.fn };
    if (b.kind === 'narration') return { id: b.id, kind: 'narration', text: b.text };
    return b;
  }

  return {
    bus, call, analyze, tagClips, outline, draft, transcript, gateContext, createRun, runJob,
    start(run: ScriptRun) { void runJob(run.id, run.projectId); },
    cancel(projectId: string, runId: string): boolean {
      const c = controllers.get(runId);
      if (c) { c.abort(); return true; }
      const run = deps.store.getRun(projectId, runId);
      if (run && (run.status === 'paused_limit' || run.status === 'interrupted' || run.status === 'queued')) { finish(run, 'cancelled', 'Cancelled.'); return true; }
      return false;
    },
    isActive: (runId: string) => controllers.has(runId),
    /** On server start: any run still marked running is marked interrupted and offered for Resume. */
    markInterrupted() {
      let n = 0;
      for (const r of deps.store.allRuns()) {
        if (r.status === 'running' || r.status === 'queued') {
          r.status = 'interrupted';
          emit(r, { type: 'status', message: 'Interrupted by a server restart. Resume continues at the saved round.' });
          save(r);
          n++;
        }
      }
      return n;
    },
  };
}
export type Engine = ReturnType<typeof createEngine>;
