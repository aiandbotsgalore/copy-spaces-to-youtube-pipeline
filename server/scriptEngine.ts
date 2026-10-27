/**
 * Script Studio engine: analysis, clip tagging, outline, draft and the background refinement loop.
 * Pure orchestration over injected providers, store and data, so every step is unit-testable with
 * injected process runners and no real CLI or network.
 */
import { EventEmitter } from 'node:events';
import type {
  Critique, EpisodeAnalysis, EpisodeFormat, MomentInsight, RefinementDecision, Role, RoleMap, RunEvent, RunOptions,
  ScriptProject, ScriptRun, ScriptVersion, Segment, StudioClip, NarrativeFunction,
} from '../utils/scriptTypes';
import { NARRATIVE_FUNCTIONS } from '../utils/scriptTypes';
import {
  allBlocks, anonymousScene, applyPatch, boundaryLines, changedBlockIds, codeGates, episodeOutlineView, findScene, judgeConsensus,
  localTextChecks, materializeBlocks, mostConsequential, reorderScenes, verifyVerbatim, type PatchBlock, type TrimFn,
} from '../utils/scriptGates';
import { formatChecks } from '../utils/scriptFormats';
import { makeClipTrim } from '../utils/scriptTrim';
import { attachTakes, countTakes, spokenChecks, spokenSceneView } from '../utils/scriptAudio';
import * as P from './scriptPrompts';
import {
  chunkUtterances, displayName, namedSegments, readTranscript, toEvidenceRefs,
  type LoadedTranscript,
} from './scriptData';
import { buildCorpus, namesForTag, type Corpus } from './scriptCorpus';
import { readCard, voiceSummary } from './scriptStyle';
import { linkQuoteIds, loadPaperTrail, paperTrailFor } from './scriptPaperTrail';
import { dateOfTag } from '../utils/scriptFormats';
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
    const names = namesForTag(project.speakerNames, releaseTag);
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

  const clipView = (c: StudioClip, maxText = 280, multi = false) => ({
    clipId: c.clipId, title: c.title, speaker: c.speaker, fn: c.fn ?? null, durationSec: c.durationSec, text: c.text.slice(0, maxText),
    ...(multi ? { recorded: dateOfTag(c.releaseTag) } : {}),
  });
  const corpusFor = (project: ScriptProject): Corpus => buildCorpus(project, transcript);
  const isMulti = (project: ScriptProject) => project.sourceTags.length > 1;

  /** Tags clips with a narrative function (one analyst call). Logan's own tags are kept. Saves the project. */
  async function tagClips(project: ScriptProject, analysis: EpisodeAnalysis, ctx: CallCtx, force = false): Promise<{ project: ScriptProject; tagged: number; cached: boolean }> {
    const key = `${analysis.transcriptHash}|${P.PROMPT_VERSIONS.clipTags}|${project.clips.map(c => c.clipId).sort().join(',')}`;
    const open = project.clips.filter(c => c.fnRationale !== 'Set by Logan.');
    if (!open.length || (!force && project.clipTagsKey === key)) return { project, tagged: 0, cached: project.clipTagsKey === key };
    const summary = JSON.stringify({ themes: analysis.themes.map(t => ({ label: t.label, summary: t.summary })), moments: analysis.moments.slice(0, 40).map(m => ({ kind: m.kind, why: m.why })) });
    const r = await call('analyst', P.clipTagsPrompt({ analysisSummary: summary, clips: JSON.stringify(open.map(c => clipView(c))) }), { ...ctx, label: 'clip tags' });
    if (!r.ok) throw failToError(r, 'Clip tagging');
    const ids = new Set(open.map(c => c.clipId));
    const tags = new Map<string, { fn: NarrativeFunction; rationale: string }>();
    for (const t of (r.json as any)?.tags || []) {
      if (t?.clipId && ids.has(String(t.clipId)) && NARRATIVE_FUNCTIONS.includes(t.fn)) tags.set(String(t.clipId), { fn: t.fn, rationale: String(t.rationale || '') });
    }
    project.clips = project.clips.map(c => (tags.has(c.clipId) ? { ...c, fn: tags.get(c.clipId)!.fn, fnRationale: tags.get(c.clipId)!.rationale } : c));
    project.clipTagsKey = key;
    project.updatedAt = now();
    deps.store.saveProject(project);
    return { project, tagged: tags.size, cached: false };
  }

  /* ---------------------------------------------------------------------------------------------- */
  /* Outline and draft                                                                              */
  /* ---------------------------------------------------------------------------------------------- */

  const memoryText = () => deps.store.getMemory().styleRules.slice(0, 30).map(r => `- ${r.rule}`).join('\n');

  async function outline(project: ScriptProject, analysis: EpisodeAnalysis, ctx: CallCtx): Promise<ScriptVersion> {
    const r = await call('reviser', P.outlinePrompt({
      format: project.format, targetRuntimeSec: project.targetRuntimeSec, memory: memoryText(),
      recordings: corpusFor(project).legend(), thesis: project.thesis || '',
      analysis: JSON.stringify({
        themes: analysis.themes, dynamics: analysis.dynamics, moments: analysis.moments.map(m => ({ id: m.id, kind: m.kind, why: m.why, speakers: m.speakers, themes: m.themes, ...(isMulti(project) ? { recorded: dateOfTag(m.releaseTag) } : {}) })), openQuestions: analysis.openQuestions,
        ...(project.format === 'investigative' ? { paperTrail: paperTrailView(project) } : {}),
      }),
      clips: JSON.stringify(project.clips.map(c => clipView(c, 280, isMulti(project)))),
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

  /** Logan's curated contradiction pairs and quotes (The Paper Trail) that touch this project's recordings. */
  function paperTrailView(project: ScriptProject) {
    const pt = paperTrailFor(loadPaperTrail(deps.root), project.sourceTags);
    if (!pt.pairs.length && !pt.quotes.length) return undefined;
    return {
      note: "Logan's curated quotes and contradiction pairs. Context for structure only: cite the transcript lines themselves.",
      pairs: pt.pairs.map(p => ({ title: p.title, before: { date: p.pre.date, speaker: p.preQuote?.speaker, quote: p.preQuote?.text.slice(0, 400) }, after: { date: p.post.date, speaker: p.postQuote?.speaker, quote: p.postQuote?.text.slice(0, 400) }, bothRecordingsInProject: !p.missingTags.length })),
      quotes: pt.quotes.slice(0, 30).map(q => ({ date: q.date, speaker: q.speaker, category: q.category, quote: q.text.slice(0, 300) })),
    };
  }

  function trimFor(project: ScriptProject): TrimFn {
    return makeClipTrim(tag => { try { return namedSegments(transcript(tag), namesForTag(project.speakerNames, tag)); } catch { return undefined; } });
  }

  /** Transcript lines (two either side) around the cited moments and utterances, grouped per recording. Ids may be qualified (E1.u92). */
  function evidenceLines(project: ScriptProject, analysis: EpisodeAnalysis | null, momentIds: string[], extraUtteranceIds: string[] = []): string {
    const corpus = corpusFor(project);
    const picked = new Map<string, Set<number>>();
    const add = (qid: string) => {
      const hit = corpus.resolve(qid);
      if (!hit) return;
      const set = picked.get(hit.rec.tag) || new Set<number>();
      for (let k = Math.max(0, hit.index - 2); k <= Math.min(hit.rec.t.utterances.length - 1, hit.index + 2); k++) set.add(k);
      picked.set(hit.rec.tag, set);
    };
    for (const m of analysis?.moments || []) if (momentIds.includes(m.id)) m.utteranceIds.forEach(add);
    extraUtteranceIds.forEach(add);
    const out: string[] = [];
    let budget = 400;
    for (const rec of corpus.recordings) {
      const set = picked.get(rec.tag);
      if (!set || budget <= 0) continue;
      const lines = [...set].sort((a, b) => a - b).slice(0, budget).map(i => corpus.line(rec, i));
      budget -= lines.length;
      if (corpus.multi) out.push(`# ${rec.key}, recorded ${rec.date || 'date unknown'}: ${rec.t.title}`);
      out.push(...lines);
    }
    return out.join('\n');
  }

  function toPatch(blocks: any[], project: ScriptProject): { ok: true; patch: PatchBlock[] } | { ok: false; reason: string } {
    const corpus = corpusFor(project);
    const out: PatchBlock[] = [];
    for (const b of blocks || []) {
      if (b?.kind === 'narration') {
        const ev = corpus.toEvidenceRefs(b.claims);
        if (ev.ok === false) return ev;
        out.push({ kind: 'narration', text: String(b.text || ''), mode: b.mode === 'polished' ? 'polished' : 'live', claims: linkQuoteIds(ev.refs, loadPaperTrail(deps.root)) });
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
    for (const tag of project.sourceTags) { try { tr[tag] = namedSegments(transcript(tag), namesForTag(project.speakerNames, tag)); } catch { /* missing */ } }
    return {
      baseline, transcripts: tr, clipsById: Object.fromEntries(project.clips.map(c => [c.clipId, c])), targetRuntimeSec: project.targetRuntimeSec, format: project.format as EpisodeFormat | null,
      formatCheck: (segs: Segment[]) => formatChecks(segs, project.format, formatOpts(project)),
    };
  }

  function formatOpts(project: ScriptProject) {
    return { clipTags: Object.fromEntries(project.clips.map(c => [c.clipId, c.releaseTag])), sourceCount: project.sourceTags.length };
  }

  /** The style card text for the polish role (same sources as the draft). */
  function draftStyleFor(): string {
    return readCard(deps.store)?.text || '';
  }

  async function draft(project: ScriptProject, base: ScriptVersion, analysis: EpisodeAnalysis | null, ctx: CallCtx, styleCard = '', approvedPassages = ''): Promise<{ version: ScriptVersion; gates: ReturnType<typeof codeGates> }> {
    const clipsById = Object.fromEntries(project.clips.map(c => [c.clipId, c]));
    const trim = trimFor(project);
    const segments: Segment[] = [];
    for (const seg of base.segments) {
      const sceneView = seg.scenes.map(sc => ({ sceneId: sc.id, title: sc.title, purpose: sc.purpose, clipIds: sc.suggestedClipIds || [], lockedBlocks: sc.blocks.filter(b => b.locked) }));
      const usedClipIds = [...new Set(seg.scenes.flatMap(sc => sc.suggestedClipIds || []))];
      const clips = (usedClipIds.length ? usedClipIds.map(id => clipsById[id]).filter(Boolean) : project.clips).map(c => clipView(c, 1200, isMulti(project)));
      const momentIds = seg.scenes.flatMap(sc => sc.momentIds || []);
      const r = await call('reviser', P.draftPrompt({
        format: project.format, segmentTitle: seg.title, scenes: JSON.stringify(sceneView), styleCard, approvedPassages,
        recordings: corpusFor(project).legend(), thesis: project.thesis || '',
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

  /**
   * A candidate written outside the loop (the optional Grok Bot deep pass): scene block lists in the same
   * block format the draft uses. Converted and checked exactly like a draft: ids resolve to real
   * utterances, clip times are computed in code from the kept words, locked blocks must survive, and the
   * code gates run against the base. Saved as a candidate (author grok_bot) for Logan to accept or reject.
   */
  async function importCandidate(project: ScriptProject, base: ScriptVersion, scenes: { sceneId: string; blocks: unknown[] }[], meta: { label: string; promptVersion: string }):
    Promise<{ ok: true; version: ScriptVersion; gates: ReturnType<typeof codeGates> } | { ok: false; reason: string }> {
    const clipsById = Object.fromEntries(project.clips.map(c => [c.clipId, c]));
    const trim = trimFor(project);
    const byScene = new Map(scenes.map(s => [String(s.sceneId), s.blocks]));
    const known = new Set(base.segments.flatMap(sg => sg.scenes.map(sc => sc.id)));
    const unknown = [...byScene.keys()].filter(id => !known.has(id));
    if (unknown.length) return { ok: false, reason: `Unknown scene ids ${unknown.join(', ')}.` };
    if (!byScene.size) return { ok: false, reason: 'The candidate changes no scene.' };
    const segments: Segment[] = [];
    for (const seg of base.segments) {
      const out = [];
      for (const sc of seg.scenes) {
        const blocks = byScene.get(sc.id);
        if (!blocks) { out.push(sc); continue; }
        if (!Array.isArray(blocks)) return { ok: false, reason: `Scene ${sc.id}: blocks must be a list.` };
        const conv = toPatch(blocks as any[], project);
        if (conv.ok === false) return { ok: false, reason: `Scene ${sc.id}: ${conv.reason}` };
        const existing = new Map(sc.blocks.map(b => [b.id, b]));
        const mat = await materializeBlocks(conv.patch, existing, { clipsById, trim, newId: () => newId('b'), onBadTrim: 'flag' });
        if (mat.ok === false) return { ok: false, reason: `Scene ${sc.id}: ${mat.reason}` };
        const missing = sc.blocks.filter(b => b.locked && !mat.blocks.some(x => x.id === b.id));
        if (missing.length) return { ok: false, reason: `Scene ${sc.id} dropped Logan's locked block ${missing[0].id}.` };
        out.push({ ...sc, blocks: mat.blocks });
      }
      segments.push({ ...seg, scenes: out });
    }
    const changed = changedBlockIds(base.segments, segments);
    const gates = codeGates(segments, { ...gateContext(project, base.segments), changedBlockIds: changed });
    const id = newId('v');
    const version: ScriptVersion = {
      id, parentId: base.id, projectId: project.id, createdAt: now(), author: 'grok_bot', label: meta.label.slice(0, 80), segments,
      changedScope: { level: 'scene', ids: [...byScene.keys()] },
      decision: { candidateId: id, baselineId: base.id, round: -1, promptVersion: meta.promptVersion, gates, loopAccepted: false, notJudged: 'Imported from a Grok Bot deep pass; not judged in the app.' },
    };
    deps.store.saveVersion(version);
    return { ok: true, version, gates };
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
  /** Real Vox durations for narration whose text has a cached take (stale takes are dropped). */
  function withTakes(segments: Segment[]): Segment[] { return attachTakes(segments, deps.store.getTakes()); }

  function createRun(project: ScriptProject, opts: { roleMap: RoleMap; mode: 'subscription' | 'fallback'; maxUsd: number; targetSceneIds?: string[]; maxRounds?: number; options?: RunOptions }): ScriptRun {
    if (opts.options?.polish && !opts.roleMap.polish) throw new StepError('NO_ROLE', 'Polish needs a polish model (fallback mode, ci:claude-sonnet-5.5).');
    const cross = verifyCrossFamily(opts.roleMap);
    if (cross.ok === false) throw new StepError('CROSS_FAMILY', cross.reason);
    if (!project.headVersionId) throw new StepError('NO_SCRIPT', 'The project has no script version to refine yet.');
    if (opts.options?.spoken) {
      const head = deps.store.getVersion(project.id, project.headVersionId);
      if (!head || countTakes(withTakes(head.segments)).withTake === 0) throw new StepError('NO_TAKES', 'Critiquing the sound needs Vox takes: preview the audio first.');
    }
    const maxUsd = opts.mode === 'subscription' ? 0 : Math.max(0, Number(opts.maxUsd) || 0);
    if (roleMapNeedsBudget(opts.roleMap) && !(maxUsd > 0)) throw new StepError('NO_BUDGET', 'Fallback models need a dollar cap above $0 for this run.');
    const run: ScriptRun = {
      id: newId('run'), projectId: project.id, createdAt: now(), updatedAt: now(), status: 'queued', mode: opts.mode,
      maxUsd, spentUsd: 0, roleMap: opts.roleMap, baseVersionId: project.headVersionId, bestVersionId: project.headVersionId,
      currentRound: 0, maxRounds: Math.min(MAX_ROUNDS, Math.max(1, opts.maxRounds || MAX_ROUNDS)), staleCount: 0,
      targetSceneIds: opts.targetSceneIds?.length ? opts.targetSceneIds : undefined, refinedSceneIds: [], candidateIds: [], events: [],
      stage: 'scenes', options: { critiqueOnly: !!opts.options?.critiqueOnly, episodePass: opts.options?.spoken ? !!opts.options?.episodePass : opts.options?.episodePass !== false, polish: !!opts.options?.polish, spoken: !!opts.options?.spoken },
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
    run.stage ??= 'scenes';
    emit(run, { type: 'status', message: run.currentRound > 0 || run.stage !== 'scenes' ? `Resumed (${run.stage === 'scenes' ? `round ${run.currentRound + 1}` : `${run.stage} pass`}).` : 'Started.' });
    save(run);

    const handleFail = (role: string, r: Extract<CompleteResult, { ok: false }>): 'pause' | 'budget' | 'cancel' | 'skip' => {
      syncBudget();
      emit(run, { type: 'call', message: `${role} failed: ${r.code}: ${r.message}`, role, provider: r.provider, model: r.model, durationMs: r.durationMs, data: { raw: r.rawOutput.slice(0, 4000) } });
      if (r.code === 'ABORTED') return 'cancel';
      if (r.code === 'BUDGET_EXCEEDED') return 'budget';
      if (PAUSE_CODES.has(r.code)) { pause(run, role, r); return 'pause'; }
      return 'skip';
    };
    /** Handles a failed call that ends the run (pause, cancel, budget). Returns true when the job must stop. */
    const halted = (h: ReturnType<typeof handleFail>, budgetMsg: string): boolean => {
      if (h === 'pause') return true;
      if (h === 'cancel') { finish(run, 'cancelled', 'Cancelled.'); return true; }
      if (h === 'budget') { finish(run, 'budget', budgetMsg); return true; }
      return false;
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
      let best: ScriptVersion = { ...loaded, segments: withTakes(loaded.segments) };
      const spoken = !!run.options?.spoken;
      const targetIds = new Set(run.targetSceneIds || best.segments.flatMap(s => s.scenes.map(sc => sc.id)));
      const notRefined = () => [...targetIds].filter(id => !run.refinedSceneIds.includes(id)).join(', ') || 'none';

      /** Fact check of changed claims; returns true when the run must stop. */
      const factcheck = async (cand: ScriptVersion, changed: Set<string>, decision: RefinementDecision): Promise<boolean> => {
        const claims = allBlocks(cand.segments).filter(b => b.kind === 'narration' && changed.has(b.id) && b.claims.length)
          .map((b, index) => ({ index, narration: (b as any).text, excerpts: (b as any).claims.map((c: any) => `${c.speaker}: ${c.verbatim}`) }));
        if (!claims.length) return false;
        const fc = await call('factcheck', P.factcheckPrompt({ claims: JSON.stringify(claims) }), ctxFor('fact check'));
        if (!fc.ok) {
          const h = handleFail('factcheck', fc);
          if (h === 'pause' || h === 'cancel') { if (h === 'cancel') finish(run, 'cancelled', 'Cancelled.'); return true; }
          decision.notJudged = `Fact check failed: ${fc.code}: ${fc.message}`;
          return false;
        }
        okCall('factcheck', fc, `checked ${claims.length} claims`);
        const labels = ((fc.json as any)?.claims || []).map((c: any) => ({ claim: claims[c.index]?.narration?.slice(0, 200) || `#${c.index}`, label: c.label, note: String(c.note || '') }));
        decision.gates.factcheck = labels;
        const bad = labels.filter((l: any) => l.label !== 'supported');
        if (bad.length) { decision.gates.factual = 'fail'; decision.gates.failures.push(...bad.map((l: any) => `Fact check: "${l.claim.slice(0, 80)}" is ${l.label}: ${l.note}`)); }
        return false;
      };

      /* -------------------------------- Scene rounds -------------------------------- */
      if (run.stage === 'scenes') {
        let sceneEnd: ScriptRun['sceneStop'];
        for (let round = run.currentRound; round < run.maxRounds; round++) {
          emit(run, { type: 'round', message: `Round ${round + 1} of ${run.maxRounds}.` });
          // CRITIQUE: one call per segment that contains target scenes; locked blocks excluded.
          const crits: Critique[] = [];
          for (let si = 0; si < best.segments.length; si++) {
            const seg = best.segments[si];
            const scenes = seg.scenes.filter(sc => targetIds.has(sc.id));
            if (!scenes.length) continue;
            const view = spoken
              ? { segmentId: seg.id, title: seg.title, scenes: scenes.map(sc => spokenSceneView(sc, clipsById)) }
              : { segmentId: seg.id, title: seg.title, scenes: scenes.map(sc => ({ sceneId: sc.id, title: sc.title, purpose: sc.purpose, blocks: sc.blocks.filter(b => !b.locked).map(b => anonymousBlock(b, clipsById)) })) };
            const prev = boundaryLines(best.segments[si - 1]?.scenes.slice(-1)[0]);
            const next = boundaryLines(best.segments[si + 1]?.scenes[0]);
            const neighbours = [prev ? `Before: ...${prev.last}` : '', next ? `After: ${next.first}...` : ''].filter(Boolean).join('\n');
            const fmt = formatChecks([{ ...seg, scenes }], project.format, formatOpts(project));
            const notes = spoken
              ? scenes.flatMap(spokenChecks)
              : [...scenes.flatMap(localTextChecks), ...fmt.hard.map(f => `Format rule broken: ${f.message}`), ...fmt.soft.map(f => f.message)];
            const r = await call('critic', P.critiquePrompt({ format: project.format, segment: JSON.stringify(view), neighbours, localNotes: notes.join('\n'), memory: memory.styleRules.map(x => `- ${x.rule}`).join('\n'), spoken, voice: voiceSummary(deps.store) }), ctxFor(`${spoken ? 'spoken critique' : 'critique'} ${seg.title}`));
            if (!r.ok) {
              if (halted(handleFail('critic', r), `Stopped at budget. Scenes not yet refined: ${notRefined()}.`)) return;
              emit(run, { type: 'error', message: `Critique of segment "${seg.title}" failed this round and was skipped.` });
              continue;
            }
            okCall('critic', r, `critiqued "${seg.title}"`);
            const sceneIds = new Set(scenes.map(s => s.id));
            const perScene = new Map<string, number>();
            for (const c of (r.json as any)?.critiques || []) {
              const tid = String(c?.targetId);
              if (!sceneIds.has(tid) || (perScene.get(tid) || 0) >= 3) continue;
              perScene.set(tid, (perScene.get(tid) || 0) + 1);
              crits.push({ id: newId('cr'), versionId: best.id, level: 'scene', targetId: tid, issue: String(c.issue), consequence: String(c.consequence), criterion: c.criterion, severity: c.severity, proposedFix: String(c.proposedFix) });
            }
          }
          run.critiques = crits;
          emit(run, { type: 'critique', message: `${crits.length} critiques.`, data: crits });
          save(run);
          if (run.options?.critiqueOnly) return finish(run, 'critique_only', `Critique only: ${crits.length} critiques, nothing revised.`);
          const target = mostConsequential(crits);
          if (!target || target.severity === 'minor') { sceneEnd = { reason: 'no_major_issues', message: target ? 'Only minor critiques left.' : 'No critiques left.' }; break; }

          // REVISE the one target scene.
          const loc = findScene(best.segments, target.targetId)!;
          const lockedIds = loc.scene.blocks.filter(b => b.locked).map(b => b.id);
          const neighbourScenes = [loc.segment.scenes[loc.sceneIndex - 1], loc.segment.scenes[loc.sceneIndex + 1]];
          const neighbours = neighbourScenes.map((s, i) => { const b = boundaryLines(s); return b ? `${i === 0 ? 'Before' : 'After'}: ${i === 0 ? b.last : b.first}` : ''; }).filter(Boolean).join('\n');
          const sceneClips = [...new Set([...(loc.scene.suggestedClipIds || []), ...loc.scene.blocks.filter(b => b.kind === 'clip').map(b => (b as any).clipId)])].map(id => clipsById[id]).filter(Boolean);
          const claimUtts = loc.scene.blocks.flatMap(b => (b.kind === 'narration' ? b.claims : [])).flatMap(c => {
            const t = transcript(c.releaseTag);
            return t.utterances.filter(u => u.end >= c.segStart && u.start <= c.segEnd).map(u => corpusFor(project!).qualify(c.releaseTag, u.id));
          });
          const rev = await call('reviser', P.revisePrompt({
            format: project.format, critique: JSON.stringify(target), neighbours, lockedIds,
            scene: JSON.stringify({ sceneId: loc.scene.id, title: loc.scene.title, purpose: loc.scene.purpose, blocks: loc.scene.blocks }),
            evidence: evidenceLines(project, null, [], claimUtts), clips: JSON.stringify((sceneClips.length ? sceneClips : project.clips).map(c => clipView(c, 1200, isMulti(project!)))),
            recordings: corpusFor(project!).legend(),
            styleRules: memory.styleRules.map(x => `- ${x.rule}`).join('\n'), styleCard: draftStyleFor(),
          }), ctxFor(`revise ${loc.scene.title}`));
          if (!rev.ok) {
            if (halted(handleFail('reviser', rev), `Stopped at budget. Scenes not yet refined: ${notRefined()}.`)) return;
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
          const cand: ScriptVersion = { ...patched.version, label: `Round ${round + 1}: ${loc.scene.title}`, changedScope: { level: 'scene', ids: [loc.scene.id] } };
          const changed = changedBlockIds(best.segments, cand.segments);
          cand.segments = withTakes(cand.segments);
          const gates = codeGates(cand.segments, { ...gateContext(project, best.segments), changedBlockIds: changed });
          const decision: RefinementDecision = { candidateId: cand.id, baselineId: best.id, round, promptVersion: P.PROMPT_VERSIONS.revise, gates, loopAccepted: false };

          if (gates.ok && await factcheck(cand, changed, decision)) return;
          emit(run, { type: 'gates', message: decision.gates.failures.length ? `Gates failed: ${decision.gates.failures.join(' | ')}` : decision.notJudged || 'Gates passed.', data: decision.gates });

          if (decision.gates.failures.length === 0 && !decision.notJudged) {
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
              decision.judge = { provider: A.provider, model: A.model, promptVersion: P.PROMPT_VERSIONS.judge, winnerAB: wAB, winnerBA: wBA, consensus: verdict.consensus, reasons: [...((A.json as any)?.reasons || []), ...((B.json as any)?.reasons || [])].map(String) };
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
        run.sceneStop = sceneEnd ?? (run.staleCount >= 2
          ? { reason: 'marginal_gains', message: 'Stopped after two rounds without a win.' }
          : { reason: 'max_rounds', message: 'Reached the round limit.' });
        run.stage = 'episode';
        save(run);
      }

      /* -------------------------------- Episode pass -------------------------------- */
      if (run.stage === 'episode') {
        if (run.options?.episodePass !== false && !run.targetSceneIds) {
          if (await episodePass()) return;
        }
        run.stage = 'polish';
        save(run);
      }

      /* -------------------------------- Optional polish ------------------------------ */
      if (run.stage === 'polish') {
        if (run.options?.polish && run.roleMap.polish) {
          if (await polishPass()) return;
        }
        run.stage = 'done';
        save(run);
      }
      const stop = run.sceneStop ?? { reason: 'max_rounds' as const, message: 'Done.' };
      return finish(run, stop.reason, stop.message);

      /** Structural critique of the whole episode; proposals become review-only candidates. True = stop. */
      async function episodePass(): Promise<boolean> {
        emit(run!, { type: 'round', message: 'Episode pass: structure (order, arc, payoff).' });
        const r = await call('critic', P.episodeCritiquePrompt({ format: project!.format, targetRuntimeSec: project!.targetRuntimeSec, outline: JSON.stringify(episodeOutlineView(best.segments, true)), memory: memory.styleRules.map(x => `- ${x.rule}`).join('\n') }), ctxFor('episode critique'));
        if (!r.ok) {
          if (halted(handleFail('critic', r), 'Stopped at budget before the episode pass.')) return true;
          emit(run!, { type: 'error', message: 'The episode pass critique failed and was skipped.' });
          return false;
        }
        okCall('critic', r, 'critiqued the episode structure');
        const raw: any[] = ((r.json as any)?.structuralCritiques || []).slice(0, 3);
        const crits: Critique[] = raw.map(c => ({
          id: newId('cr'), versionId: best.id, level: 'episode', targetId: 'episode', issue: String(c.issue), consequence: String(c.consequence),
          criterion: c.criterion, severity: c.severity, proposedFix: String(c.proposedFix), structuralKind: c.kind, proposedOrder: Array.isArray(c.proposedOrder) ? c.proposedOrder : null,
        }));
        run!.critiques = [...(run!.critiques || []).filter(c => c.level !== 'episode'), ...crits];
        emit(run!, { type: 'critique', message: `Episode pass: ${crits.length} structural critiques.`, data: crits });
        save(run!);
        for (const c of crits) {
          if (!c.proposedOrder) continue;
          const re = reorderScenes(best.segments, c.proposedOrder);
          if (re.ok === false) { emit(run!, { type: 'gates', message: `Structural proposal rejected: ${re.reason}` }); continue; }
          const cand: ScriptVersion = {
            id: newId('v'), parentId: best.id, projectId: project!.id, createdAt: now(), author: 'loop', label: `Structure: ${c.structuralKind || 'order'}`,
            segments: re.segments, changedScope: { level: 'episode', ids: re.moved },
          };
          cand.segments = withTakes(cand.segments);
          const gates = codeGates(cand.segments, { ...gateContext(project!, best.segments), changedBlockIds: new Set() });
          const decision: RefinementDecision = { candidateId: cand.id, baselineId: best.id, round: run!.currentRound, promptVersion: P.PROMPT_VERSIONS.episodeCritique, gates, loopAccepted: false, reviewOnly: 'Structural moves always wait for Logan.' };
          if (gates.ok) {
            const a = episodeOutlineView(best.segments, false);
            const b = episodeOutlineView(cand.segments, false);
            const [ab, ba] = await Promise.all([
              call('judge', P.judgePrompt({ format: project!.format, a, b, level: 'episode' }), ctxFor('episode judge A=baseline')),
              call('judge', P.judgePrompt({ format: project!.format, a: b, b: a, level: 'episode' }), ctxFor('episode judge A=candidate')),
            ]);
            const failed = [ab, ba].find(x => !x.ok) as Extract<CompleteResult, { ok: false }> | undefined;
            if (failed) {
              const h = handleFail('judge', failed);
              if (h === 'pause' || h === 'cancel') {
                cand.decision = { ...decision, notJudged: `Judge ${h === 'pause' ? 'paused' : 'cancelled'}: ${failed.code}` };
                deps.store.saveVersion(cand); run!.candidateIds.push(cand.id); save(run!);
                if (h === 'cancel') finish(run!, 'cancelled', 'Cancelled.');
                return true;
              }
              decision.notJudged = `Judge failed: ${failed.code}: ${failed.message}`;
            } else {
              const A = ab as Extract<CompleteResult, { ok: true }>;
              const B = ba as Extract<CompleteResult, { ok: true }>;
              okCall('judge', A, 'judged structure AB'); okCall('judge', B, 'judged structure BA');
              const verdict = judgeConsensus((A.json as any)?.winner, (B.json as any)?.winner, c.severity);
              decision.judge = { provider: A.provider, model: A.model, promptVersion: P.PROMPT_VERSIONS.judge, winnerAB: (A.json as any)?.winner, winnerBA: (B.json as any)?.winner, consensus: verdict.consensus, reasons: [...((A.json as any)?.reasons || []), ...((B.json as any)?.reasons || [])].map(String) };
              decision.loopAccepted = verdict.win;
              emit(run!, { type: 'judge', message: `Structure judge: AB=${decision.judge.winnerAB}, BA=${decision.judge.winnerBA} -> ${verdict.consensus}.`, data: decision.judge });
            }
          } else emit(run!, { type: 'gates', message: `Structural proposal failed gates: ${gates.failures.join(' | ')}`, data: gates });
          cand.decision = decision;
          deps.store.saveVersion(cand);
          run!.candidateIds.push(cand.id);
          emit(run!, { type: 'decision', message: `Structural proposal ${cand.id} saved for your review${decision.loopAccepted ? ' (the judge preferred it)' : ''}.`, data: { candidateId: cand.id, loopAccepted: decision.loopAccepted, reviewOnly: true } });
          save(run!);
        }
        return false;
      }

      /** One optional line edit of all unlocked narration by the polish role; a review-only candidate. True = stop. */
      async function polishPass(): Promise<boolean> {
        emit(run!, { type: 'round', message: `Polish pass (${run!.roleMap.polish}).` });
        const blocks = best.segments.flatMap(s => s.scenes.flatMap(sc => sc.blocks));
        const items = blocks.map((b, i) => ({ b, i })).filter(({ b }) => b.kind === 'narration' && !b.locked).map(({ b, i }) => {
          const n = b as Extract<typeof b, { kind: 'narration' }>;
          const near = (d: -1 | 1) => { const x = blocks[i + d]; return x?.kind === 'clip' ? x.keptText.slice(0, 200) : ''; };
          return { id: n.id, text: n.text, quotes: n.claims.map(c => c.verbatim), clipBefore: near(-1), clipAfter: near(1) };
        });
        if (!items.length) { emit(run!, { type: 'status', message: 'Polish skipped: no unlocked narration.' }); return false; }
        const style = draftStyleFor();
        const r = await call('polish', P.polishPrompt({ format: project!.format, narration: JSON.stringify(items), styleCard: style }), ctxFor('polish'));
        if (!r.ok) {
          if (halted(handleFail('polish', r), 'Stopped at budget before the polish pass.')) return true;
          emit(run!, { type: 'error', message: 'The polish pass failed and was skipped.' });
          return false;
        }
        okCall('polish', r, 'polished narration');
        const allowed = new Set(items.map(x => x.id));
        const edits = new Map<string, string>();
        for (const e of (r.json as any)?.blocks || []) if (allowed.has(String(e?.id)) && typeof e.text === 'string' && e.text.trim()) edits.set(String(e.id), e.text.trim());
        if (!edits.size) { emit(run!, { type: 'status', message: 'Polish proposed no changes.' }); return false; }
        const segments: Segment[] = best.segments.map(seg => ({ ...seg, scenes: seg.scenes.map(sc => ({ ...sc, blocks: sc.blocks.map(b => (b.kind === 'narration' && edits.has(b.id) ? { ...b, text: edits.get(b.id)!, mode: 'polished' as const, takeUrl: undefined, takeSec: undefined, takeTextHash: undefined } : b)) })) }));
        const cand: ScriptVersion = { id: newId('v'), parentId: best.id, projectId: project!.id, createdAt: now(), author: 'loop', label: 'Polish', segments, changedScope: { level: 'episode', ids: [...edits.keys()] } };
        const changed = changedBlockIds(best.segments, cand.segments);
        cand.segments = withTakes(cand.segments);
          const gates = codeGates(cand.segments, { ...gateContext(project!, best.segments), changedBlockIds: changed });
        const decision: RefinementDecision = { candidateId: cand.id, baselineId: best.id, round: run!.currentRound, promptVersion: P.PROMPT_VERSIONS.polish, gates, loopAccepted: false, reviewOnly: 'A polish is never accepted by the loop; compare it and decide.' };
        if (gates.ok && await factcheck(cand, changed, decision)) return true;
        emit(run!, { type: 'gates', message: decision.gates.failures.length ? `Polish gates failed: ${decision.gates.failures.join(' | ')}` : 'Polish gates passed.', data: decision.gates });
        cand.decision = decision;
        deps.store.saveVersion(cand);
        run!.candidateIds.push(cand.id);
        emit(run!, { type: 'decision', message: `Polish ${cand.id} (${edits.size} blocks) saved for your review.`, data: { candidateId: cand.id, loopAccepted: false, reviewOnly: true } });
        save(run!);
        return false;
      }
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
    bus, call, analyze, tagClips, outline, draft, transcript, gateContext, createRun, runJob, importCandidate, corpusFor,
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
