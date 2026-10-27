/**
 * Script Studio API, mounted at /api/script inside the Vite dev/preview server (like the Director).
 *
 *   GET  /status                 provider health (real available() checks) and store location
 *   GET  /episodes               transcripts on disk
 *   GET  /projects               saved projects
 *   POST /project                create a project for one episode
 *   GET  /project?id=            project, versions, runs, cached analysis, speaker stats
 *   POST /project/update         format, runtime, speaker renames, clip removals, title
 *   POST /project/add-clip       add a clip cut from transcript utterances
 *   POST /analyze                chunked episode analysis (cached by transcript hash + prompt version), then clip tags
 *   POST /tag-clips              narrative-function tags for the project's clips (Logan's own tags are kept)
 *   POST /outline                beat outline -> new version
 *   POST /draft                  draft every segment -> new version, with code-gate results
 *   POST /version                save Logan's edit (rejected unless its parent is the current head)
 *   POST /head                   move the head version (rollback)
 *   POST /refine                 start a detached refinement run -> 202 { runId }
 *   GET  /events?projectId&runId SSE: replays saved events, then streams live ones
 *   GET  /run?projectId&runId    run record with its candidates and diffs
 *   POST /cancel                 cancel a run
 *   POST /resume                 resume a paused or interrupted run (optionally switching one role)
 *   POST /decide                 Logan accepts or rejects a candidate
 *   GET  /export?projectId       one JSON with project, versions, runs and memory
 *   POST /import                 restore an exported project
 *   GET  /log?runId              the call log of a run
 *   GET  /logs                   every call log with a summary (calls, failures, time, cost)
 *   GET  /quality                judge vs Logan's decisions, judge order consistency, prompt version comparisons
 *   POST /preview                speak the narration (whole script or one scene) in Logan's Vox voice -> 202 { job }
 *   GET  /preview?projectId      progress of the latest preview job
 *   POST /preview/cancel         stop a preview job after the take in progress
 *   POST /render                 the manifest of a finished episode render (before its audio)
 *   PUT  /render/audio?projectId&versionId   the rendered WAV (raw body), saved under the project's renders/
 *   GET  /render/audio?projectId&versionId   the saved WAV, with byte ranges for the player
 *   GET  /render/manifest?projectId&versionId
 *   GET  /renders?projectId      saved renders of a project
 *   GET  /clip-audio?projectId&clipId   a transcript cut as WAV (ffmpeg reads only that window of the episode)
 *
 * Loopback only unless DIRECTOR_ALLOW_REMOTE=1. Nothing here publishes anything; the only outside call
 * besides the model CLIs is Vox synthesis on Logan's own Hugging Face Space.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'http';
import type { EpisodeFormat, RoleMap, ScriptProject, ScriptVersion, Segment } from '../utils/scriptTypes';
import { EPISODE_FORMATS, NARRATIVE_FUNCTIONS } from '../utils/scriptTypes';
import { formatChecks } from '../utils/scriptFormats';
import { findExcerpt } from '../utils/directorValidate';
import { codeGates, diffVersions } from '../utils/scriptGates';
import { isLoopback } from './directorMiddleware';
import { catalogClipsForRelease, clipFromUtterances, resolveEpisodeAudio, isSafeTag, listEpisodes, readTranscript, speakerStats } from './scriptData';
import { createEngine, StepError, type Engine } from './scriptEngine';
import { createProviderRegistry, DEFAULT_ROLE_MAP, FALLBACK_ROLE_MAP, parseRoleSpec, roleMapNeedsBudget, verifyCrossFamily, type ProcessRunner, type ResolvedBinary } from './scriptProviders';
import { createScriptStore, isSafeId, newId, StoreError, type ScriptStore } from './scriptStore';
import { recordDecision } from './scriptMemory';
import { PROMPT_VERSIONS } from './scriptPrompts';
import { attachTakes } from '../utils/scriptAudio';
import { createAudioService, type AudioService, type FfmpegRunner } from './scriptAudioService';
import type { AsyncSynth } from './voxSynthesize';
import { callStats, collectPairs, promptOutcomes, qualityReport, summarizeLog, type LogEntry } from '../utils/scriptQuality';

export interface ScriptStudioOptions {
  root: string;
  getEnv: () => Record<string, string | undefined>;
  runner?: ProcessRunner;
  fetchImpl?: typeof fetch;
  platform?: NodeJS.Platform;
  resolveOverride?: (name: 'claude' | 'codex') => Promise<ResolvedBinary>;
  now?: () => number;
  /** Vox synthesis and duration probe (defaults: the HF Space script and ffprobe). */
  synth?: AsyncSynth;
  probe?: (fullPath: string) => Promise<number | null>;
  ffmpeg?: FfmpegRunner;
}

const BODY_LIMIT = 8_000_000;

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > BODY_LIMIT) { reject(new StepError('TOO_LARGE', 'Request body too large.')); req.destroy(); return; }
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try { resolve(JSON.parse(text)); } catch { reject(new StepError('BAD_JSON', 'Request body is not valid JSON.')); }
    });
    req.on('error', reject);
  });
}

const STATUS_FOR_CODE: Record<string, number> = {
  BAD_REQUEST: 400, BAD_JSON: 400, TOO_LARGE: 413, NOT_FOUND: 404, CONFLICT: 409, CROSS_FAMILY: 400, NO_BUDGET: 400,
  NO_TRANSCRIPT: 404, INVENTED_CLIP: 422, BAD_OUTPUT: 502, UPSTREAM: 502, TIMEOUT: 504, RATE_LIMIT: 429, USAGE_LIMIT: 429,
  NOT_SIGNED_IN: 401, NOT_INSTALLED: 503, NO_KEY: 503, BUDGET_EXCEEDED: 402, ANALYSIS_FAILED: 502, ABORTED: 499, NOT_ALLOWED: 400,
  NO_SCRIPT: 409, NO_ROLE: 400, NO_VERSION: 404, NO_TAKES: 409, VOX_UNAVAILABLE: 502, NO_EPISODE_AUDIO: 502, NO_FFMPEG: 503,
};

export function resolveRoleMap(body: any): { roleMap: RoleMap; mode: 'subscription' | 'fallback'; maxUsd: number } {
  const mode = body?.mode === 'fallback' ? 'fallback' : 'subscription';
  const base = mode === 'fallback' ? FALLBACK_ROLE_MAP : DEFAULT_ROLE_MAP;
  const roleMap: RoleMap = { ...base };
  const req = body?.roleMap && typeof body.roleMap === 'object' ? body.roleMap : {};
  for (const r of ['analyst', 'critic', 'reviser', 'judge', 'factcheck', 'polish'] as const) {
    if (typeof req[r] === 'string') {
      if (!parseRoleSpec(req[r])) throw new StepError('BAD_REQUEST', `Unknown provider "${req[r]}" for ${r}.`);
      roleMap[r] = req[r];
    }
  }
  if (mode === 'subscription') delete roleMap.polish;
  const cross = verifyCrossFamily(roleMap);
  if (cross.ok === false) throw new StepError('CROSS_FAMILY', cross.reason);
  const maxUsd = roleMapNeedsBudget(roleMap) ? Math.max(0, Number(body?.maxUsd) || 0) : 0;
  return { roleMap, mode, maxUsd };
}

export function createScriptStudioMiddleware(opts: ScriptStudioOptions) {
  const store: ScriptStore = createScriptStore(opts.root);
  const registry = createProviderRegistry({ env: opts.getEnv, runner: opts.runner, fetchImpl: opts.fetchImpl, platform: opts.platform, resolveOverride: opts.resolveOverride });
  const engine: Engine = createEngine({ root: opts.root, store, registry, now: opts.now });
  const now = opts.now ?? Date.now;
  const audio: AudioService = createAudioService({ root: opts.root, store, getEnv: opts.getEnv, synth: opts.synth, probe: opts.probe, ffmpeg: opts.ffmpeg, now });
  const withTakes = (segments: Segment[]) => attachTakes(segments, store.getTakes());
  let interruptedAtStart = 0;
  try { interruptedAtStart = engine.markInterrupted(); } catch { interruptedAtStart = 0; }

  const getProject = (id: unknown): ScriptProject => {
    if (typeof id !== 'string' || !isSafeId(id)) throw new StepError('BAD_REQUEST', 'Missing or invalid project id.');
    const p = store.getProject(id);
    if (!p) throw new StepError('NOT_FOUND', `Project ${id} not found.`);
    return p;
  };
  const getVersion = (p: ScriptProject, id: unknown): ScriptVersion => {
    if (typeof id !== 'string' || !isSafeId(id)) throw new StepError('BAD_REQUEST', 'Missing or invalid version id.');
    const v = store.getVersion(p.id, id);
    if (!v) throw new StepError('NOT_FOUND', `Version ${id} not found.`);
    return v;
  };
  const touch = (p: ScriptProject) => { p.updatedAt = now(); store.saveProject(p); };
  const allPairs = () => collectPairs(store.listProjects().flatMap(pr => store.listVersions(pr.id)));
  const interactiveCtx = (body: any, label: string) => {
    const { roleMap, maxUsd } = resolveRoleMap(body);
    return { roleMap, budget: { maxUsd, spentUsd: 0 }, signal: new AbortController().signal, label };
  };

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url || '/', 'http://local');
    const route = url.pathname.replace(/\/+$/, '') || '/';
    const q = (k: string) => url.searchParams.get(k);
    const method = req.method || 'GET';

    if (route === '/status' && method === 'GET') {
      return send(res, 200, { ok: true, providers: await registry.health(), storeDir: store.base, interruptedAtStart, promptVersions: PROMPT_VERSIONS, defaults: { subscription: DEFAULT_ROLE_MAP, fallback: FALLBACK_ROLE_MAP } });
    }
    if (route === '/episodes' && method === 'GET') return send(res, 200, { ok: true, episodes: listEpisodes(opts.root) });
    if (route === '/projects' && method === 'GET') return send(res, 200, { ok: true, projects: store.listProjects() });

    if (route === '/project' && method === 'POST') {
      const body = await readBody(req);
      const tag = String(body?.releaseTag || '');
      if (!isSafeTag(tag)) throw new StepError('BAD_REQUEST', 'Missing or invalid releaseTag.');
      const t = readTranscript(opts.root, tag);
      if (!t) throw new StepError('NO_TRANSCRIPT', `No transcript yet for ${tag}.`);
      const { clips, excluded } = catalogClipsForRelease(opts.root, tag);
      const p: ScriptProject = {
        id: newId('prj'), title: String(body?.title || t.title).slice(0, 200), createdAt: now(), updatedAt: now(),
        format: null, sourceTags: [tag], targetRuntimeSec: Math.max(30, Number(body?.targetRuntimeSec) || 900),
        transcriptHashes: { [tag]: t.hash }, speakerNames: sanitizeNames(body?.speakerNames), clips, excludedClips: excluded, headVersionId: null,
      };
      store.saveProject(p);
      return send(res, 201, { ok: true, project: p });
    }

    if (route === '/project' && method === 'GET') {
      const p = getProject(q('id'));
      const versions = store.listVersions(p.id).map(v => ({ id: v.id, parentId: v.parentId, createdAt: v.createdAt, author: v.author, label: v.label, decision: v.decision }));
      const runs = store.listRuns(p.id).map(r => ({ ...r, events: undefined, eventCount: r.events.length, active: engine.isActive(r.id) }));
      const stored = p.headVersionId ? store.getVersion(p.id, p.headVersionId) : null;
      const head = stored ? { ...stored, segments: withTakes(stored.segments) } : null;
      const stats: Record<string, unknown> = {};
      const analyses: Record<string, unknown> = {};
      const transcriptChanged: string[] = [];
      for (const tag of p.sourceTags) {
        const t = readTranscript(opts.root, tag);
        if (!t) continue;
        stats[tag] = speakerStats(t.utterances, p.speakerNames || {});
        analyses[tag] = store.getAnalysis(tag, PROMPT_VERSIONS.analysis, t.hash);
        if (p.transcriptHashes[tag] && p.transcriptHashes[tag] !== t.hash) transcriptChanged.push(tag);
      }
      const gates = head ? codeGates(head.segments, { ...engine.gateContext(p, head.segments), changedBlockIds: undefined }) : null;
      const format = head ? formatChecks(head.segments, p.format, { clipTags: Object.fromEntries(p.clips.map(c => [c.clipId, c.releaseTag])), sourceCount: p.sourceTags.length }) : null;
      return send(res, 200, { ok: true, project: p, versions, runs, head, speakerStats: stats, analyses, transcriptChanged, gates, formatChecks: format });
    }

    if (route === '/project/update' && method === 'POST') {
      const body = await readBody(req);
      const p = getProject(body?.id);
      if (body.format !== undefined) {
        if (body.format !== null && !EPISODE_FORMATS.includes(body.format)) throw new StepError('BAD_REQUEST', `Unknown format ${body.format}.`);
        p.format = body.format as EpisodeFormat | null;
      }
      if (body.targetRuntimeSec !== undefined) p.targetRuntimeSec = Math.max(30, Math.min(4 * 3600, Number(body.targetRuntimeSec) || p.targetRuntimeSec));
      if (body.speakerNames !== undefined) p.speakerNames = sanitizeNames(body.speakerNames);
      if (typeof body.title === 'string') p.title = body.title.slice(0, 200);
      if (Array.isArray(body.removeClipIds)) {
        const rm = new Set(body.removeClipIds.map(String));
        for (const c of p.clips) if (rm.has(c.clipId)) p.excludedClips.push({ clipId: c.clipId, reason: 'Removed by Logan.' });
        p.clips = p.clips.filter(c => !rm.has(c.clipId));
      }
      if (Array.isArray(body.retagClips)) {
        for (const t of body.retagClips) {
          const c = p.clips.find(x => x.clipId === t?.clipId);
          if (!c) continue;
          if (t.fn === null) { c.fn = undefined; c.fnRationale = undefined; } // back to untagged; the next tagging may set it
          else if (NARRATIVE_FUNCTIONS.includes(t.fn)) { c.fn = t.fn; c.fnRationale = 'Set by Logan.'; }
          else throw new StepError('BAD_REQUEST', `Unknown narrative function ${t.fn}.`);
        }
      }
      touch(p);
      return send(res, 200, { ok: true, project: p });
    }

    if (route === '/project/add-clip' && method === 'POST') {
      const body = await readBody(req);
      const p = getProject(body?.id);
      const tag = String(body?.releaseTag || p.sourceTags[0]);
      if (!p.sourceTags.includes(tag)) throw new StepError('BAD_REQUEST', `${tag} is not a source of this project.`);
      const t = engine.transcript(tag);
      let audioUrl = typeof body?.audioUrl === 'string' && /^https:\/\/github\.com\//.test(body.audioUrl) ? body.audioUrl : undefined;
      if (!audioUrl) {
        // Transcript times are episode times, so the cut must point into the full recording, not a clip file.
        const env = opts.getEnv();
        const r = await resolveEpisodeAudio(t, opts.fetchImpl ?? fetch, env.GITHUB_TOKEN);
        if (r.ok === false) throw new StepError('NO_EPISODE_AUDIO', `Could not cut a clip: ${r.reason}`);
        audioUrl = r.url;
      }
      const clip = clipFromUtterances(t, String(body?.fromId), String(body?.toId || body?.fromId), p.speakerNames || {}, audioUrl);
      if (!clip) throw new StepError('BAD_REQUEST', 'Could not cut a clip: unknown utterance ids, or the episode has no audio URL.');
      if (!p.clips.some(c => c.clipId === clip.clipId)) p.clips.push(clip);
      touch(p);
      return send(res, 200, { ok: true, clip, project: p });
    }

    if (route === '/analyze' && method === 'POST') {
      const body = await readBody(req);
      const p = getProject(body?.projectId);
      const ctx = interactiveCtx(body, 'analysis');
      const out: Record<string, unknown> = {};
      for (const tag of p.sourceTags) out[tag] = await engine.analyze(p, tag, ctx, !!body?.force);
      // Clip tags follow the analysis; a tagging failure is reported, never hidden, and does not lose the analysis.
      let tagging: { tagged: number; cached: boolean } | { error: string; code: string };
      try {
        const r = await engine.tagClips(p, out[p.sourceTags[0]] as any, ctx);
        tagging = { tagged: r.tagged, cached: r.cached };
      } catch (e: any) {
        tagging = { error: e?.message || String(e), code: e?.code || 'INTERNAL' };
      }
      return send(res, 200, { ok: true, analyses: out, tagging, spentUsd: ctx.budget.spentUsd });
    }

    if (route === '/tag-clips' && method === 'POST') {
      const body = await readBody(req);
      const p = getProject(body?.projectId);
      const ctx = interactiveCtx(body, 'clip tags');
      const t = engine.transcript(p.sourceTags[0]);
      const analysis = store.getAnalysis(p.sourceTags[0], PROMPT_VERSIONS.analysis, t.hash);
      if (!analysis) throw new StepError('BAD_REQUEST', 'Run the episode analysis first.');
      const r = await engine.tagClips(p, analysis, ctx, !!body?.force);
      return send(res, 200, { ok: true, project: r.project, tagged: r.tagged, cached: r.cached, spentUsd: ctx.budget.spentUsd });
    }

    if (route === '/outline' && method === 'POST') {
      const body = await readBody(req);
      const p = getProject(body?.projectId);
      const ctx = interactiveCtx(body, 'outline');
      const t = engine.transcript(p.sourceTags[0]);
      const analysis = store.getAnalysis(p.sourceTags[0], PROMPT_VERSIONS.analysis, t.hash);
      if (!analysis) throw new StepError('BAD_REQUEST', 'Run the episode analysis first.');
      const v = await engine.outline(p, analysis, ctx);
      p.headVersionId = v.id;
      touch(p);
      return send(res, 200, { ok: true, version: v, spentUsd: ctx.budget.spentUsd });
    }

    if (route === '/draft' && method === 'POST') {
      const body = await readBody(req);
      const p = getProject(body?.projectId);
      const base = getVersion(p, body?.versionId || p.headVersionId);
      const ctx = interactiveCtx(body, 'draft');
      const t = engine.transcript(p.sourceTags[0]);
      const analysis = store.getAnalysis(p.sourceTags[0], PROMPT_VERSIONS.analysis, t.hash);
      const style = draftStyle(store, opts.root);
      const out = await engine.draft(p, base, analysis, ctx, style.styleCard, style.approvedPassages);
      p.headVersionId = out.version.id;
      touch(p);
      return send(res, 200, { ok: true, version: out.version, gates: out.gates, spentUsd: ctx.budget.spentUsd });
    }

    if (route === '/version' && method === 'POST') {
      const body = await readBody(req);
      const p = getProject(body?.projectId);
      if ((body?.parentId ?? null) !== p.headVersionId) throw new StepError('CONFLICT', 'This edit is based on an older version than the current head. Reload the project before saving.');
      const segments = withTakes(validateSegments(body?.segments, p)); // take fields come only from the take index
      const v: ScriptVersion = { id: newId('v'), parentId: p.headVersionId, projectId: p.id, createdAt: now(), author: 'logan', label: String(body?.label || 'Edit').slice(0, 80), segments };
      store.saveVersion(v);
      p.headVersionId = v.id;
      touch(p);
      return send(res, 200, { ok: true, version: v, gates: codeGates(segments, { ...engine.gateContext(p, segments), changedBlockIds: undefined }) });
    }

    if (route === '/head' && method === 'POST') {
      const body = await readBody(req);
      const p = getProject(body?.projectId);
      const v = getVersion(p, body?.versionId);
      p.headVersionId = v.id;
      touch(p);
      return send(res, 200, { ok: true, project: p });
    }

    if (route === '/version' && method === 'GET') {
      const p = getProject(q('projectId'));
      const v = getVersion(p, q('id'));
      const parent = v.parentId ? store.getVersion(p.id, v.parentId) : null;
      return send(res, 200, { ok: true, version: v, diff: parent ? diffVersions(parent.segments, v.segments) : [] });
    }

    if (route === '/refine' && method === 'POST') {
      const body = await readBody(req);
      const p = getProject(body?.projectId);
      const { roleMap, mode, maxUsd } = resolveRoleMap(body);
      const spoken = !!body?.spoken;
      const options = { critiqueOnly: !!body?.critiqueOnly, episodePass: spoken ? body?.episodePass === true : body?.episodePass !== false, polish: !!body?.polish, spoken };
      const run = engine.createRun(p, { roleMap, mode, maxUsd, targetSceneIds: Array.isArray(body?.targetSceneIds) ? body.targetSceneIds.map(String) : undefined, maxRounds: Number(body?.maxRounds) || undefined, options });
      engine.start(run);
      return send(res, 202, { ok: true, runId: run.id });
    }

    if (route === '/events' && method === 'GET') {
      const p = getProject(q('projectId'));
      const runId = String(q('runId') || '');
      const run = isSafeId(runId) ? store.getRun(p.id, runId) : null;
      if (!run) throw new StepError('NOT_FOUND', 'Run not found.');
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Connection', 'keep-alive');
      const after = Number(q('after') || 0);
      for (const ev of run.events) if (ev.seq > after) res.write(`id: ${ev.seq}\ndata: ${JSON.stringify(ev)}\n\n`);
      if (!engine.isActive(run.id)) { res.write(`event: idle\ndata: ${JSON.stringify({ status: run.status })}\n\n`); res.end(); return; }
      const onEv = (ev: any) => {
        res.write(`id: ${ev.seq}\ndata: ${JSON.stringify(ev)}\n\n`);
        if (ev.type === 'finished' || (ev.type === 'status' && /^Paused/.test(ev.message))) { cleanup(); res.end(); }
      };
      const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
      const cleanup = () => { clearInterval(ping); engine.bus.off(run.id, onEv); };
      engine.bus.on(run.id, onEv);
      req.on('close', cleanup); // closing the stream never stops the run
      return;
    }

    if (route === '/run' && method === 'GET') {
      const p = getProject(q('projectId'));
      const runId = String(q('runId') || '');
      const run = isSafeId(runId) ? store.getRun(p.id, runId) : null;
      if (!run) throw new StepError('NOT_FOUND', 'Run not found.');
      const base = store.getVersion(p.id, run.baseVersionId);
      const candidates = run.candidateIds.map(id => store.getVersion(p.id, id)).filter((v): v is ScriptVersion => !!v).map(v => {
        const parent = v.parentId ? store.getVersion(p.id, v.parentId) : null;
        return { id: v.id, parentId: v.parentId, decision: v.decision, diff: parent ? diffVersions(parent.segments, v.segments) : [] };
      });
      const best = store.getVersion(p.id, run.bestVersionId);
      return send(res, 200, { ok: true, run: { ...run, active: engine.isActive(run.id) }, candidates, diffFromBase: base && best ? diffVersions(base.segments, best.segments) : [] });
    }

    if (route === '/cancel' && method === 'POST') {
      const body = await readBody(req);
      const p = getProject(body?.projectId);
      return send(res, 200, { ok: engine.cancel(p.id, String(body?.runId || '')) });
    }

    if (route === '/resume' && method === 'POST') {
      const body = await readBody(req);
      const p = getProject(body?.projectId);
      const run = store.getRun(p.id, String(body?.runId || ''));
      if (!run) throw new StepError('NOT_FOUND', 'Run not found.');
      if (engine.isActive(run.id)) throw new StepError('CONFLICT', 'The run is already running.');
      if (!['paused_limit', 'interrupted'].includes(run.status)) throw new StepError('CONFLICT', `A ${run.status} run cannot be resumed.`);
      if (body?.switchRole && typeof body.switchRole === 'object') {
        const role = String(body.switchRole.role) as keyof RoleMap;
        const spec = String(body.switchRole.spec);
        if (!parseRoleSpec(spec)) throw new StepError('BAD_REQUEST', `Unknown provider ${spec}.`);
        const next = { ...run.roleMap, [role]: spec } as RoleMap;
        const cross = verifyCrossFamily(next);
        if (cross.ok === false) throw new StepError('CROSS_FAMILY', cross.reason);
        run.roleMap = next;
        if (roleMapNeedsBudget(next)) {
          run.mode = 'fallback';
          run.maxUsd = Math.max(run.maxUsd, Number(body?.maxUsd) || 0);
          if (!(run.maxUsd > 0)) throw new StepError('NO_BUDGET', 'Switching to a fallback model needs a dollar cap above $0.');
        }
      }
      store.saveRun(run);
      engine.start(run);
      return send(res, 202, { ok: true, runId: run.id });
    }

    if (route === '/decide' && method === 'POST') {
      const body = await readBody(req);
      const p = getProject(body?.projectId);
      const cand = getVersion(p, body?.candidateId);
      const decision = body?.decision === 'accept' ? 'accept' : body?.decision === 'reject' ? 'reject' : null;
      if (!decision) throw new StepError('BAD_REQUEST', 'decision must be accept or reject.');
      if (!cand.decision) cand.decision = { candidateId: cand.id, baselineId: cand.parentId || '', round: -1, promptVersion: 'manual', gates: { factual: 'pass', faithful: 'pass', locksIntact: true, clipBoundsOk: true, runtimeOk: true, failures: [] }, loopAccepted: false };
      cand.decision.loganDecision = decision;
      store.saveVersion(cand);
      const parent = cand.parentId ? store.getVersion(p.id, cand.parentId) : null;
      recordDecision(store, p, parent, cand, decision, String(body?.reason || ''));
      if (decision === 'accept') { p.headVersionId = cand.id; touch(p); }
      // Quality history: recomputed after every decision, so the judge check needs nothing set up.
      if (cand.decision.judge) {
        try {
          const o = qualityReport(allPairs()).overall;
          store.appendQualityHistory({ at: now(), candidateId: cand.id, decision, pairs: o.pairs, conclusive: o.conclusive, agreementRate: o.agreementRate, kappa: o.kappa });
        } catch { /* the decision itself is saved; history is best effort and recomputed on read */ }
      }
      return send(res, 200, { ok: true, project: p, version: cand });
    }

    if (route === '/export' && method === 'GET') {
      const p = getProject(q('projectId'));
      res.setHeader('Content-Disposition', `attachment; filename="script-project-${p.id}.json"`);
      return send(res, 200, { kind: 'spacepipe-script-project', exportedAt: now(), project: p, versions: store.listVersions(p.id), runs: store.listRuns(p.id), memory: store.getMemory() });
    }

    if (route === '/import' && method === 'POST') {
      const body = await readBody(req);
      if (body?.kind !== 'spacepipe-script-project' || !body.project?.id || !isSafeId(body.project.id)) throw new StepError('BAD_REQUEST', 'Not a Script Studio project export.');
      if (store.getProject(body.project.id) && !body.overwrite) throw new StepError('CONFLICT', `Project ${body.project.id} already exists. Import with overwrite to replace it.`);
      store.saveProject(body.project);
      for (const v of body.versions || []) if (v?.id && isSafeId(v.id) && v.projectId === body.project.id) store.saveVersion(v);
      for (const r of body.runs || []) if (r?.id && isSafeId(r.id) && r.projectId === body.project.id) store.saveRun({ ...r, status: r.status === 'running' ? 'interrupted' : r.status });
      if (body.importMemory && body.memory) store.saveMemory(body.memory);
      return send(res, 200, { ok: true, project: body.project });
    }

    if (route === '/log' && method === 'GET') {
      const runId = String(q('runId') || '');
      if (!isSafeId(runId)) throw new StepError('BAD_REQUEST', 'Invalid run id.');
      return send(res, 200, { ok: true, entries: store.readLog(runId) });
    }

    if (route === '/logs' && method === 'GET') {
      const runProject = new Map(store.allRuns().map(r => [r.id, r.projectId]));
      const logs = store.listLogIds().map(id => summarizeLog(id, runProject.get(id) ?? null, store.readLog(id) as LogEntry[]))
        .sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0));
      return send(res, 200, { ok: true, logs });
    }

    if (route === '/quality' && method === 'GET') {
      const versions = store.listProjects().flatMap(pr => store.listVersions(pr.id));
      const entries = store.listLogIds().flatMap(id => store.readLog(id) as LogEntry[]);
      return send(res, 200, {
        ok: true, report: qualityReport(collectPairs(versions)), prompts: promptOutcomes(versions), calls: callStats(entries),
        history: store.readQualityHistory().slice(-200), currentPromptVersions: PROMPT_VERSIONS,
      });
    }

    /* ------------------------------------ audio ------------------------------------ */

    if (route === '/preview' && method === 'POST') {
      const body = await readBody(req);
      const p = getProject(body?.projectId);
      const stored = getVersion(p, body?.versionId || p.headVersionId);
      const sceneId = typeof body?.sceneId === 'string' && body.sceneId ? body.sceneId : null;
      const job = audio.startPreview(p, stored, sceneId);
      return send(res, 202, { ok: true, job });
    }
    if (route === '/preview' && method === 'GET') {
      const p = getProject(q('projectId'));
      return send(res, 200, { ok: true, job: audio.previewJob(p.id) });
    }
    if (route === '/preview/cancel' && method === 'POST') {
      const body = await readBody(req);
      const p = getProject(body?.projectId);
      return send(res, 200, { ok: true, cancelled: audio.cancelPreview(p.id) });
    }
    if (route === '/render' && method === 'POST') {
      const body = await readBody(req);
      const p = getProject(body?.projectId);
      const v = getVersion(p, body?.versionId);
      return send(res, 200, { ok: true, render: audio.saveManifest(p, v, body?.manifest) });
    }
    if (route === '/render/audio' && (method === 'PUT' || method === 'POST')) {
      const p = getProject(q('projectId'));
      const v = getVersion(p, q('versionId'));
      const ct = String(req.headers['content-type'] || '');
      if (!/^audio\/(wav|x-wav|wave)\b/.test(ct)) throw new StepError('BAD_REQUEST', 'Send the render as audio/wav.');
      return send(res, 200, { ok: true, render: await audio.receiveWav(req, p, v.id) });
    }
    if (route === '/render/audio' && (method === 'GET' || method === 'HEAD')) {
      const p = getProject(q('projectId'));
      const versionId = String(q('versionId') || '');
      if (!isSafeId(versionId)) throw new StepError('BAD_REQUEST', 'Invalid version id.');
      return audio.serveWav(req, res, p.id, versionId);
    }
    if (route === '/render/manifest' && method === 'GET') {
      const p = getProject(q('projectId'));
      const versionId = String(q('versionId') || '');
      if (!isSafeId(versionId)) throw new StepError('BAD_REQUEST', 'Invalid version id.');
      const r = audio.readRender(p.id, versionId);
      if (!r) throw new StepError('NOT_FOUND', 'No saved render for this version.');
      res.setHeader('Content-Disposition', `attachment; filename="render-${p.id}-${versionId}.json"`);
      return send(res, 200, r.manifest);
    }
    if (route === '/clip-audio' && (method === 'GET' || method === 'HEAD')) {
      const p = getProject(q('projectId'));
      return audio.serveClipCut(req, res, p, String(q('clipId') || ''));
    }
    if (route === '/renders' && method === 'GET') {
      const p = getProject(q('projectId'));
      return send(res, 200, { ok: true, renders: audio.listRenders(p.id).map(r => ({ ...r, manifest: undefined, measured: r.manifest.measured ?? null, items: r.manifest.items.length, musicMarkers: r.manifest.musicMarkers.length })) });
    }

    return send(res, 404, { ok: false, code: 'NOT_FOUND', message: `No route ${method} ${route}.` });
  }

  const middleware = async function scriptStudio(req: IncomingMessage, res: ServerResponse) {
    try {
      if (opts.getEnv().DIRECTOR_ALLOW_REMOTE !== '1' && !isLoopback(req.socket?.remoteAddress)) {
        return send(res, 403, { ok: false, code: 'FORBIDDEN_ORIGIN', message: 'Script Studio only accepts requests from this computer.' });
      }
      await handle(req, res);
    } catch (e: any) {
      if (res.headersSent) { try { res.end(); } catch { /* ignore */ } return; }
      if (e instanceof StepError) return send(res, STATUS_FOR_CODE[e.code] || 500, { ok: false, code: e.code, message: e.message, raw: e.rawOutput ? e.rawOutput.slice(0, 8000) : undefined, ...e.extra });
      if (e instanceof StoreError) return send(res, 500, { ok: false, code: 'DISK', message: e.message, path: e.filePath });
      return send(res, 500, { ok: false, code: 'INTERNAL', message: e?.message || String(e) });
    }
  };
  return Object.assign(middleware, { engine, store, registry, audio });
}

function sanitizeNames(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (v && typeof v === 'object') for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string' && val.trim() && k.length < 100) out[k] = val.trim().slice(0, 100);
  }
  return out;
}

/** Shape-checks an edited script and resolves nothing: clip times stay as code computed them. */
export function validateSegments(raw: unknown, p: ScriptProject): Segment[] {
  if (!Array.isArray(raw)) throw new StepError('BAD_REQUEST', 'segments must be an array.');
  const clips = new Map(p.clips.map(c => [c.clipId, c]));
  const ids = new Set<string>();
  const checkId = (id: unknown) => {
    if (typeof id !== 'string' || !isSafeId(id) || ids.has(id)) throw new StepError('BAD_REQUEST', `Invalid or duplicate id ${String(id)}.`);
    ids.add(id);
  };
  for (const seg of raw as any[]) {
    checkId(seg?.id);
    if (!Array.isArray(seg?.scenes)) throw new StepError('BAD_REQUEST', `Segment ${seg?.id} has no scenes array.`);
    for (const sc of seg.scenes) {
      checkId(sc?.id);
      if (!Array.isArray(sc?.blocks)) throw new StepError('BAD_REQUEST', `Scene ${sc?.id} has no blocks array.`);
      for (const b of sc.blocks) {
        checkId(b?.id);
        if (!['narration', 'clip', 'pause', 'music'].includes(b?.kind)) throw new StepError('BAD_REQUEST', `Block ${b?.id} has unknown kind ${b?.kind}.`);
        if (b.kind === 'clip') {
          const clip = clips.get(b.clipId);
          if (!clip) throw new StepError('BAD_REQUEST', `Block ${b.id} names unknown clip ${b.clipId}.`);
          if (typeof b.keptText !== 'string' || !b.keptText.trim() || !findExcerpt(clip.text, b.keptText)) {
            throw new StepError('BAD_REQUEST', `Clip block ${b.id}: the kept words are not a contiguous excerpt of clip ${b.clipId}.`);
          }
          if (!(Number.isFinite(b.inSec) && Number.isFinite(b.outSec) && b.inSec >= 0 && b.inSec < b.outSec && b.outSec <= clip.durationSec + 1e-6)) {
            throw new StepError('BAD_REQUEST', `Clip block ${b.id}: ${b.inSec}s to ${b.outSec}s is outside 0 to ${clip.durationSec}s.`);
          }
          if (!['segment', 'silence', 'estimated', 'full'].includes(b.trimBasis)) throw new StepError('BAD_REQUEST', `Clip block ${b.id}: unknown trim basis ${b.trimBasis}.`);
          if (!NARRATIVE_FUNCTIONS.includes(b.fn)) throw new StepError('BAD_REQUEST', `Clip block ${b.id}: unknown narrative function ${b.fn}.`);
        }
        if (b.kind === 'pause' && !(Number.isFinite(b.sec) && b.sec >= 0 && b.sec <= 30)) throw new StepError('BAD_REQUEST', `Pause ${b.id} must be 0 to 30 seconds.`);
        if (b.kind === 'music' && !['sting', 'bed_in', 'bed_out', 'transition'].includes(b.cue)) throw new StepError('BAD_REQUEST', `Music marker ${b.id} has unknown cue ${b.cue}.`);
        if (b.kind === 'narration' && (typeof b.text !== 'string' || !Array.isArray(b.claims))) throw new StepError('BAD_REQUEST', `Narration ${b.id} needs text and claims.`);
      }
    }
  }
  return raw as Segment[];
}

/** Phase 1 style input: the committed canonical narration example plus Logan's approved passages. */
export function draftStyle(store: ScriptStore, root: string): { styleCard: string; approvedPassages: string } {
  const mem = store.getMemory();
  const approved = mem.approvedPassages.slice(-3).map(p => `- ${p.text}`).join('\n');
  let example = '';
  try {
    const f = path.join(root, 'speaker_samples', 'Logan', 'narration_examples', 'gary_mckinnon_narration.txt');
    if (fs.existsSync(f)) example = fs.readFileSync(f, 'utf8').slice(0, 3000);
  } catch { example = ''; }
  const card = store.readJson<{ text: string }>(path.join(store.base, 'style-card.json'));
  const styleCard = [card?.text, example ? `Example of Logan's narration (excerpt):\n${example}` : ''].filter(Boolean).join('\n\n');
  return { styleCard, approvedPassages: approved };
}
