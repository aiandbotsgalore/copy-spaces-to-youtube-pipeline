/**
 * Script Studio API, mounted at /api/script inside the Vite dev/preview server (like the Director).
 *
 *   GET  /status                 provider health (real available() checks) and store location
 *   GET  /episodes               transcripts on disk
 *   GET  /projects               saved projects
 *   POST /project                create a project for one recording, or several (releaseTags[]) for thematic and investigative episodes
 *   GET  /project?id=            project, versions, runs, cached analysis, speaker stats
 *   POST /project/update         format, runtime, thesis, speaker renames, clip removals, title, add or remove source recordings
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
 *   GET  /related?projectId&q    code search (BM25) over every transcript for recordings related to the thesis
 *   GET  /paper-trail?projectId  Logan's curated quotes and contradiction pairs that touch the project's recordings
 *   GET  /style                  the style card, its coverage and freshness, learned rules, distill status
 *   POST /style/build            rebuild the style card from all of Logan's speech and his narration examples -> 202
 *   POST /style/rules            add or remove one of Logan's explicit rules, or remove a learned one
 *   POST /style/distill          distil learned rules from Logan's decisions now (also automatic every 10 decisions)
 *   POST /handoff/export         pack.json for an optional Grok Bot deep pass (refine, factcheck, storyline); nothing is pushed
 *   GET  /handoffs?projectId     exported packs and what was imported from them
 *   POST /handoff/import         a returned result.json, checked in code; candidates wait for Logan's decision
 *
 * Loopback only unless DIRECTOR_ALLOW_REMOTE=1. Nothing here publishes anything; the only outside call
 * besides the model CLIs is Vox synthesis on Logan's own Hugging Face Space.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'http';
import type { DistillStatus, EpisodeAnalysis, EpisodeFormat, RoleMap, ScriptProject, ScriptVersion, Segment, StudioClip } from '../utils/scriptTypes';
import { EPISODE_FORMATS, NARRATIVE_FUNCTIONS } from '../utils/scriptTypes';
import { formatChecks } from '../utils/scriptFormats';
import { findExcerpt } from '../utils/directorValidate';
import { codeGates, diffVersions } from '../utils/scriptGates';
import { isLoopback } from './directorMiddleware';
import { catalogClipsForRelease, clipFromUtterances, resolveEpisodeAudio, isSafeTag, listEpisodes, readTranscript, speakerStats } from './scriptData';
import { createEngine, StepError, type Engine } from './scriptEngine';
import { createProviderRegistry, DEFAULT_ROLE_MAP, FALLBACK_ROLE_MAP, parseRoleSpec, roleMapNeedsBudget, verifyCrossFamily, type ProcessRunner, type ResolvedBinary } from './scriptProviders';
import { createScriptStore, isSafeId, newId, StoreError, type ScriptStore } from './scriptStore';
import { addExplicitRule, distillRules, dueForDistill, DISTILL_EVERY, recordDecision, removeRule } from './scriptMemory';
import { assignSourceKeys, buildCorpus, combineAnalyses, namesForTag, scopeNamesToTag } from './scriptCorpus';
import { buildStyleCard, cardFreshness, draftStyle, loganRecordingTags, readCard, readNarrationExamples, scanCorpus, type CorpusScan, type Renames } from './scriptStyle';
import { searchRecordings } from './scriptSearch';
import { loadPaperTrail, paperTrailFor } from './scriptPaperTrail';
import { dateOfTag } from '../utils/scriptFormats';
import {
  buildPack, checkFactchecks, checkRecordings, checkResultHeader, HANDOFF_KINDS, packHash,
  type HandoffKind, type HandoffRecord, type ImportSummary,
} from './scriptHandoff';
import { PROMPT_VERSIONS } from './scriptPrompts';
import { attachTakes } from '../utils/scriptAudio';
import { parseUploadedScript, parseTimeToSeconds } from '../utils/scriptUpload';
import { fetchGoogleDriveEvidence } from './googleDriveService';
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
  NO_LOGAN_SPEECH: 409, STYLE_FAILED: 502, SOURCE_IN_USE: 409, BAD_RESULT: 422,
};

export const MAX_SOURCES = 12;

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

  /* Sources ------------------------------------------------------------------------------------ */

  function loadSource(tag: unknown) {
    const t = String(tag || '');
    if (!isSafeTag(t)) throw new StepError('BAD_REQUEST', `Missing or invalid release tag ${JSON.stringify(tag)}.`);
    const tr = readTranscript(opts.root, t);
    if (!tr) throw new StepError('NO_TRANSCRIPT', `No transcript yet for ${t}.`);
    return tr;
  }

  function addSources(p: ScriptProject, tags: unknown[]) {
    const fresh = [...new Set(tags.map(String))].filter(t => !p.sourceTags.includes(t));
    if (p.sourceTags.length + fresh.length > MAX_SOURCES) throw new StepError('BAD_REQUEST', `A project can draw on at most ${MAX_SOURCES} recordings.`);
    const loaded = fresh.map(loadSource);
    if (!loaded.length) return;
    if (p.sourceTags.length === 1) p.speakerNames = scopeNamesToTag(p.speakerNames, p.sourceTags[0]);
    for (const t of loaded) {
      p.sourceTags.push(t.releaseTag);
      p.transcriptHashes[t.releaseTag] = t.hash;
      const { clips, excluded } = catalogClipsForRelease(opts.root, t.releaseTag);
      const have = new Set(p.clips.map(c => c.clipId));
      p.clips.push(...clips.filter(c => !have.has(c.clipId)));
      p.excludedClips.push(...excluded);
    }
    p.clipTagsKey = undefined;
    assignSourceKeys(p);
  }

  function removeSources(p: ScriptProject, tags: unknown[]) {
    const rm = new Set(tags.map(String).filter(t => p.sourceTags.includes(t)));
    if (!rm.size) return;
    if (rm.size >= p.sourceTags.length) throw new StepError('BAD_REQUEST', 'A project needs at least one recording.');
    const head = p.headVersionId ? store.getVersion(p.id, p.headVersionId) : null;
    if (head) {
      const clipTag = new Map(p.clips.map(c => [c.clipId, c.releaseTag]));
      for (const b of head.segments.flatMap(sg => sg.scenes.flatMap(sc => sc.blocks))) {
        const tag = b.kind === 'clip' ? clipTag.get(b.clipId) : b.kind === 'narration' ? b.claims.find(c => rm.has(c.releaseTag))?.releaseTag : undefined;
        if (tag && rm.has(tag)) throw new StepError('SOURCE_IN_USE', `The current script still uses ${tag} (block ${b.id}). Remove those blocks first.`);
      }
    }
    p.sourceTags = p.sourceTags.filter(t => !rm.has(t));
    for (const t of rm) delete p.transcriptHashes[t];
    p.clips = p.clips.filter((c: StudioClip) => !rm.has(c.releaseTag));
    p.speakerNames = Object.fromEntries(Object.entries(p.speakerNames || {}).filter(([k]) => ![...rm].some(t => k.startsWith(`${t}::`))));
    p.clipTagsKey = undefined;
  }

  /** The analysis of every recording, combined; with `required`, every recording must be analysed. */
  function projectAnalysis(p: ScriptProject, required: boolean): EpisodeAnalysis | null {
    const analyses: Record<string, EpisodeAnalysis> = {};
    const missing: string[] = [];
    for (const tag of p.sourceTags) {
      const a = store.getAnalysis(tag, PROMPT_VERSIONS.analysis, engine.transcript(tag).hash);
      if (a) analyses[tag] = a; else missing.push(tag);
    }
    if (required && missing.length) throw new StepError('BAD_REQUEST', p.sourceTags.length === 1 ? 'Run the episode analysis first.' : `Run the analysis first; not analysed yet: ${missing.join(', ')}.`);
    return combineAnalyses(buildCorpus(p, engine.transcript), analyses);
  }

  /* Style card ---------------------------------------------------------------------------------- */

  const style: {
    building: Promise<unknown> | null; progress: string; lastError: { code: string; message: string; at: number } | null;
    scan: CorpusScan | null; scanKey: string; tags: string[]; tagsKey: string; distilling: Promise<DistillStatus> | null;
  } = { building: null, progress: '', lastError: null, scan: null, scanKey: '', tags: [], tagsKey: '', distilling: null };

  /** Logan's renames from every project, plus the transcript viewer's (sent by the browser). */
  function allRenames(body: any): Renames {
    const out: Renames = {};
    for (const pr of store.listProjects()) for (const tag of pr.sourceTags) out[tag] = { ...(out[tag] || {}), ...namesForTag(pr.speakerNames, tag) };
    const extra = body?.renames && typeof body.renames === 'object' ? body.renames : {};
    for (const [tag, names] of Object.entries<any>(extra)) if (isSafeTag(tag)) out[tag] = { ...(out[tag] || {}), ...sanitizeNames(names) };
    return out;
  }

  function archiveKey(renames: Renames): string {
    const dir = path.join(opts.root, 'public', 'transcripts', 'episodes');
    let key = JSON.stringify(renames);
    try {
      for (const f of fs.readdirSync(dir).sort()) { if (!f.endsWith('.json')) continue; const st = fs.statSync(path.join(dir, f)); key += `|${f}:${st.size}:${st.mtimeMs}`; }
    } catch { /* no transcripts */ }
    return key;
  }

  /** The full measurement of Logan's speech (every segment), cached until a transcript or rename changes. */
  async function corpusScan(body: any): Promise<CorpusScan> {
    const renames = allRenames(body);
    const key = archiveKey(renames);
    if (style.scan && style.scanKey === key) return style.scan;
    style.scan = await scanCorpus(opts.root, renames);
    style.scanKey = key;
    return style.scan;
  }

  /** Quick check of which recordings have Logan in them, for the card's freshness. */
  function loganTags(body: any): { recordingTags: string[] } {
    const renames = allRenames(body);
    const key = archiveKey(renames);
    if (style.tagsKey !== key) { style.tags = style.scanKey === key && style.scan ? style.scan.recordingTags : loganRecordingTags(opts.root, renames); style.tagsKey = key; }
    return { recordingTags: style.tags };
  }

  function startStyleBuild(body: any): Promise<unknown> {
    if (style.building) return style.building;
    const ctx = interactiveCtx(body, 'style card');
    style.lastError = null;
    style.progress = 'Measuring every segment Logan speaks in the archive';
    style.building = corpusScan(body).then(scan => buildStyleCard({
      root: opts.root, store, now,
      call: (role, prompt, label) => engine.call(role, prompt, { ...ctx, label }),
      scan,
      onProgress: m => { style.progress = m; },
    })).catch((e: any) => {
      style.lastError = { code: e?.code || 'STYLE_FAILED', message: e?.message || String(e), at: now() };
      throw e;
    }).finally(() => { style.building = null; style.progress = ''; });
    style.building.catch(() => undefined);
    return style.building;
  }

  /** Built automatically: when there is no card, or the archive or examples changed, the draft builds one first. */
  async function ensureStyleCard(body: any): Promise<{ built: boolean; warning?: string }> {
    const fr = cardFreshness(readCard(store), loganTags(body), readNarrationExamples(opts.root).hash);
    if (fr.fresh) return { built: false };
    try {
      await startStyleBuild(body);
      return { built: true };
    } catch (e: any) {
      const card = readCard(store);
      return { built: false, warning: `${card ? 'Drafted with the previous style card' : 'Drafted without a style card'}: ${e?.message || e}` };
    }
  }

  function startDistill(body: any): Promise<DistillStatus> {
    if (style.distilling) return style.distilling;
    const ctx = interactiveCtx(body, 'distill rules');
    style.distilling = distillRules(store, (prompt, label) => engine.call('critic', prompt, { ...ctx, label }), now)
      .catch((e: any) => {
        const st: DistillStatus = { at: now(), ok: false, message: `Rules not updated: ${e?.message || e}`, decisions: store.getMemory().decisionsSinceDistill || 0, promptVersion: PROMPT_VERSIONS.distill };
        const mem = store.getMemory(); mem.lastDistill = st; store.saveMemory(mem);
        return st;
      })
      .finally(() => { style.distilling = null; });
    return style.distilling;
  }

  function styleState(body: any) {
    const card = readCard(store);
    const tags = loganTags(body);
    const mem = store.getMemory();
    const fresh = cardFreshness(card, tags, readNarrationExamples(opts.root).hash);
    return {
      card: card ? { ...card, coverage: { ...card.coverage, recordingTags: undefined } } : null,
      freshness: fresh, recordingsWithLogan: tags.recordingTags.length, building: !!style.building, progress: style.progress, lastError: style.lastError,
      narrationFiles: readNarrationExamples(opts.root).files,
      rules: mem.styleRules, lastDistill: mem.lastDistill || null, decisionsSinceDistill: mem.decisionsSinceDistill || 0, distillEvery: DISTILL_EVERY,
      distilling: !!style.distilling, removedRules: mem.removedRules || [],
    };
  }

  /* Grok Bot handoff (files only) ------------------------------------------------------------------ */

  const handoffPath = (projectId: string, requestId: string) => path.join(store.base, 'projects', projectId, 'handoffs', `${requestId}.json`);
  function listHandoffs(projectId: string): HandoffRecord[] {
    const dir = path.join(store.base, 'projects', projectId, 'handoffs');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => store.readJson<HandoffRecord>(path.join(dir, f))).filter((x): x is HandoffRecord => !!x).sort((a, b) => b.createdAt - a.createdAt);
  }

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
      const tags: unknown[] = Array.isArray(body?.releaseTags) && body.releaseTags.length ? body.releaseTags : [body?.releaseTag];
      if (tags.length > MAX_SOURCES) throw new StepError('BAD_REQUEST', `A project can draw on at most ${MAX_SOURCES} recordings.`);
      const t = loadSource(tags[0]);
      const tag = t.releaseTag;
      const { clips, excluded } = catalogClipsForRelease(opts.root, tag);
      const p: ScriptProject = {
        id: newId('prj'), title: String(body?.title || t.title).slice(0, 200), createdAt: now(), updatedAt: now(),
        format: null, sourceTags: [tag], targetRuntimeSec: Math.max(30, Number(body?.targetRuntimeSec) || 900),
        transcriptHashes: { [tag]: t.hash }, speakerNames: sanitizeNames(body?.speakerNames), clips, excludedClips: excluded, headVersionId: null,
      };
      if (typeof body?.thesis === 'string' && body.thesis.trim()) p.thesis = body.thesis.trim().slice(0, 500);
      if (EPISODE_FORMATS.includes(body?.format)) p.format = body.format;
      if (tags.length > 1) addSources(p, tags.slice(1));
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
        stats[tag] = speakerStats(t.utterances, namesForTag(p.speakerNames, tag));
        analyses[tag] = store.getAnalysis(tag, PROMPT_VERSIONS.analysis, t.hash);
        if (p.transcriptHashes[tag] && p.transcriptHashes[tag] !== t.hash) transcriptChanged.push(tag);
      }
      const gates = head ? codeGates(head.segments, { ...engine.gateContext(p, head.segments), changedBlockIds: undefined }) : null;
      const format = head ? formatChecks(head.segments, p.format, { clipTags: Object.fromEntries(p.clips.map(c => [c.clipId, c.releaseTag])), sourceCount: p.sourceTags.length }) : null;
      const corpus = buildCorpus(p, engine.transcript);
      const recordings = p.sourceTags.map(tag => {
        const r = corpus.byTag(tag);
        return { releaseTag: tag, key: r?.key || '', date: dateOfTag(tag), title: r?.t.title || tag, clips: p.clips.filter(c => c.releaseTag === tag).length, analysed: !!analyses[tag] };
      });
      return send(res, 200, { ok: true, project: p, versions, runs, head, speakerStats: stats, analyses, transcriptChanged, gates, formatChecks: format, recordings });
    }

    if (route === '/project/update' && method === 'POST') {
      const body = await readBody(req);
      const p = getProject(body?.id);
      if (body.format !== undefined) {
        if (body.format !== null && !EPISODE_FORMATS.includes(body.format)) throw new StepError('BAD_REQUEST', `Unknown format ${body.format}.`);
        p.format = body.format as EpisodeFormat | null;
      }
      if (body.targetRuntimeSec !== undefined) p.targetRuntimeSec = Math.max(30, Math.min(4 * 3600, Number(body.targetRuntimeSec) || p.targetRuntimeSec));
      if (body.runtimeTolerance !== undefined) {
        const tol = Number(body.runtimeTolerance);
        p.runtimeTolerance = Number.isFinite(tol) && tol >= 0 ? Math.min(2.0, tol) : undefined;
      }
      if (body.speakerNames !== undefined) p.speakerNames = sanitizeNames(body.speakerNames);
      if (typeof body.title === 'string') p.title = body.title.slice(0, 200);
      if (typeof body.thesis === 'string') p.thesis = body.thesis.trim().slice(0, 500) || undefined;
      if (typeof body.googleDriveFolderUrl === 'string') p.googleDriveFolderUrl = body.googleDriveFolderUrl.trim() || undefined;
      if (Array.isArray(body.addSourceTags)) addSources(p, body.addSourceTags);
      if (Array.isArray(body.removeSourceTags)) removeSources(p, body.removeSourceTags);
      if (Array.isArray(body.removeClipIds)) {
        const rm = new Set(body.removeClipIds.map(String));
        for (const c of p.clips) if (rm.has(c.clipId)) p.excludedClips.push({ clipId: c.clipId, reason: 'Removed by Logan.' });
        p.clips = p.clips.filter(c => !rm.has(c.clipId));
      }
      if (Array.isArray(body.clips)) {
        if (!Array.isArray(p.clips)) p.clips = [];
        const existingMap = new Map(p.clips.map(c => [c.clipId || (c as any).id, c]));
        for (const c of body.clips) {
          if (!c) continue;
          const cid = String(c.clipId || c.id || '');
          if (!cid) continue;
          c.clipId = cid;
          c.id = cid;
          const existing = existingMap.get(cid);
          if (existing) {
            Object.assign(existing, c);
          } else {
            p.clips.push(c);
            existingMap.set(cid, c);
          }
        }
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
      const clip = clipFromUtterances(t, String(body?.fromId), String(body?.toId || body?.fromId), namesForTag(p.speakerNames, tag), audioUrl);
      if (!clip) throw new StepError('BAD_REQUEST', 'Could not cut a clip: unknown utterance ids, or the episode has no audio URL.');
      if (!p.clips.some(c => c.clipId === clip.clipId)) p.clips.push(clip);
      touch(p);
      return send(res, 200, { ok: true, clip, project: p });
    }

    if (route === '/project/upload-script' && method === 'POST') {
      const body = await readBody(req);
      const scriptText = String(body?.scriptText || '').trim();
      if (!scriptText) throw new StepError('BAD_REQUEST', 'scriptText is required.');

      let p: ScriptProject;
      let isNew = false;
      if (body?.projectId) {
        p = getProject(body.projectId);
      } else {
        isNew = true;
        const availableEpisodes = listEpisodes(opts.root);
        const tags: unknown[] = Array.isArray(body?.releaseTags) && body.releaseTags.length
          ? body.releaseTags
          : (body?.releaseTag ? [body.releaseTag] : (availableEpisodes[0]?.releaseTag ? [availableEpisodes[0].releaseTag] : []));
        if (tags.length > MAX_SOURCES) throw new StepError('BAD_REQUEST', `A project can draw on at most ${MAX_SOURCES} recordings.`);
        if (!tags.length) throw new StepError('BAD_REQUEST', 'No available episode recordings found to associate with project.');
        const t = loadSource(tags[0]);
        const tag = t.releaseTag;
        const { clips, excluded } = catalogClipsForRelease(opts.root, tag);
        p = {
          id: newId('prj'),
          title: String(body?.title || (body?.filename ? body.filename.replace(/\.[^/.]+$/, '') : 'Uploaded Script')).slice(0, 200),
          createdAt: now(),
          updatedAt: now(),
          format: EPISODE_FORMATS.includes(body?.format) ? body.format : null,
          sourceTags: [tag],
          targetRuntimeSec: Math.max(30, Number(body?.targetRuntimeSec) || 900),
          transcriptHashes: { [tag]: t.hash },
          speakerNames: sanitizeNames(body?.speakerNames),
          clips,
          excludedClips: excluded,
          headVersionId: null,
          evidenceDocs: [],
        };
        if (typeof body?.thesis === 'string' && body.thesis.trim()) p.thesis = body.thesis.trim().slice(0, 500);
        if (typeof body?.googleDriveFolderUrl === 'string' && body.googleDriveFolderUrl.trim()) {
          p.googleDriveFolderUrl = body.googleDriveFolderUrl.trim();
        }
        if (tags.length > 1) addSources(p, tags.slice(1));
      }

      if (!isNew && typeof body?.googleDriveFolderUrl === 'string') {
        p.googleDriveFolderUrl = body.googleDriveFolderUrl.trim() || undefined;
      }

      if (Array.isArray(body?.evidenceDocs) && body.evidenceDocs.length) {
        p.evidenceDocs = p.evidenceDocs || [];
        for (const doc of body.evidenceDocs) {
          if (doc?.content && typeof doc.content === 'string') {
            p.evidenceDocs.push({
              id: newId('doc'),
              name: String(doc.name || 'Evidence Document').slice(0, 100),
              type: String(doc.type || 'text') as any,
              content: String(doc.content).slice(0, 500_000),
              addedAt: now(),
              sizeBytes: Buffer.byteLength(doc.content, 'utf8'),
              sourceUrl: typeof doc.sourceUrl === 'string' ? doc.sourceUrl : undefined,
              source: doc.source || (doc.sourceUrl?.includes('drive.google.com') ? 'google_drive' : 'upload'),
            });
          }
        }
      }

      const parsed = parseUploadedScript(scriptText, { idGenerator: newId, defaultTitle: p.title });

      // Automatically register any archival clips found in the parsed script into the project's Clip Bin (p.clips)
      const existingClips = new Map(p.clips.map(c => [c.clipId, c]));
      for (const seg of parsed) {
        for (const sc of seg.scenes) {
          for (const b of sc.blocks) {
            if (b.kind === 'clip' && (b.type === 'ARCHIVAL_CLIP' || b.clipNumber)) {
              if (!existingClips.has(b.clipId)) {
                const newClip: StudioClip = {
                  clipId: b.clipId,
                  title: b.spaceTitle ? `${b.spaceTitle} (#${b.clipNumber || b.clipId.replace(/^clip_/, '')})` : (b.speaker && b.time ? `${b.speaker} (${b.time})` : `Clip ${b.clipId}`),
                  speaker: b.speaker || 'Tape',
                  releaseTag: p.sourceTags[0] || 'catalog',
                  audioUrl: '',
                  durationSec: Math.max(1.5, b.outSec - b.inSec || 5),
                  text: b.keptText || '',
                  episodeStartSec: b.time ? parseTimeToSeconds(b.time) : undefined,
                  fn: 'evidence',
                  fnRationale: 'Parsed from uploaded script',
                };
                p.clips.push(newClip);
                existingClips.set(b.clipId, newClip);
              }
            }
          }
        }
      }

      const segments = withTakes(validateSegments(parsed, p));
      const v: ScriptVersion = {
        id: newId('v'),
        parentId: p.headVersionId,
        projectId: p.id,
        createdAt: now(),
        author: 'logan',
        label: String(body?.label || (body?.filename ? `Uploaded: ${body.filename}` : 'Uploaded script')).slice(0, 80),
        segments,
      };
      store.saveVersion(v);
      p.headVersionId = v.id;
      touch(p);
      return send(res, isNew ? 201 : 200, { ok: true, project: p, version: v, gates: codeGates(segments, { ...engine.gateContext(p, segments), changedBlockIds: undefined }) });
    }

    if (route === '/project/evidence' && method === 'POST') {
      const body = await readBody(req);
      const p = getProject(body?.projectId);
      p.evidenceDocs = p.evidenceDocs || [];
      if (typeof body?.googleDriveFolderUrl === 'string') {
        p.googleDriveFolderUrl = body.googleDriveFolderUrl.trim() || undefined;
      }
      const docs = Array.isArray(body?.documents) ? body.documents : (body?.document ? [body.document] : []);
      if (!docs.length) throw new StepError('BAD_REQUEST', 'No documents provided.');
      for (const d of docs) {
        if (!d?.content || typeof d.content !== 'string') continue;
        p.evidenceDocs.push({
          id: newId('doc'),
          name: String(d.name || 'Evidence Document').slice(0, 100),
          type: String(d.type || 'text') as any,
          content: String(d.content).slice(0, 500_000),
          addedAt: now(),
          sizeBytes: Buffer.byteLength(d.content, 'utf8'),
          sourceUrl: typeof d.sourceUrl === 'string' ? d.sourceUrl : undefined,
          source: d.source || (d.sourceUrl?.includes('drive.google.com') ? 'google_drive' : 'manual'),
        });
      }
      touch(p);
      return send(res, 200, { ok: true, project: p });
    }

    if (route === '/project/evidence/remove' && method === 'POST') {
      const body = await readBody(req);
      const p = getProject(body?.projectId);
      const docId = String(body?.documentId || '');
      p.evidenceDocs = (p.evidenceDocs || []).filter(d => d.id !== docId);
      touch(p);
      return send(res, 200, { ok: true, project: p });
    }

    if (route === '/google-drive/fetch' && method === 'POST') {
      const body = await readBody(req);
      const url = String(body?.url || body?.folderUrl || '').trim();
      if (!url) throw new StepError('BAD_REQUEST', 'Google Drive folder or document URL is required.');
      const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : undefined;
      const accessToken = typeof body?.accessToken === 'string' ? body.accessToken.trim() : undefined;
      const result = await fetchGoogleDriveEvidence({
        urlOrId: url,
        apiKey,
        accessToken,
        env: opts.getEnv(),
        fetchImpl: opts.fetchImpl ?? fetch,
      });
      return send(res, 200, result);
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
        const r = await engine.tagClips(p, projectAnalysis(p, true)!, ctx);
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
      const analysis = projectAnalysis(p, true)!;
      const r = await engine.tagClips(p, analysis, ctx, !!body?.force);
      return send(res, 200, { ok: true, project: r.project, tagged: r.tagged, cached: r.cached, spentUsd: ctx.budget.spentUsd });
    }

    if (route === '/outline' && method === 'POST') {
      const body = await readBody(req);
      const p = getProject(body?.projectId);
      const ctx = interactiveCtx(body, 'outline');
      const analysis = projectAnalysis(p, true)!;
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
      const analysis = projectAnalysis(p, false);
      const styleStatus = await ensureStyleCard(body);
      const styleIn = draftStyle(store, opts.root);
      const out = await engine.draft(p, base, analysis, ctx, styleIn.styleCard, styleIn.approvedPassages);
      p.headVersionId = out.version.id;
      touch(p);
      return send(res, 200, { ok: true, version: out.version, gates: out.gates, spentUsd: ctx.budget.spentUsd, style: styleStatus });
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
      if (!cand.decision) cand.decision = { candidateId: cand.id, baselineId: cand.parentId || '', round: -1, promptVersion: 'manual', gates: { factual: 'pass', faithful: 'pass', locksIntact: true, clipBoundsOk: true, runtimeOk: true, failures: [], warnings: [] }, loopAccepted: false };
      cand.decision.loganDecision = decision;
      store.saveVersion(cand);
      const parent = cand.parentId ? store.getVersion(p.id, cand.parentId) : null;
      const mem = recordDecision(store, p, parent, cand, decision, String(body?.reason || ''));
      // Every 10 decisions the critic distils learned rules in the background; Logan's explicit rules are never touched.
      let distill: 'started' | 'running' | null = null;
      if (dueForDistill(mem)) {
        distill = style.distilling ? 'running' : 'started';
        try { void startDistill(body); } catch { distill = null; /* a bad role map leaves the counter for the next decision */ }
      }
      if (decision === 'accept') { p.headVersionId = cand.id; touch(p); }
      // Quality history: recomputed after every decision, so the judge check needs nothing set up.
      if (cand.decision.judge) {
        try {
          const o = qualityReport(allPairs()).overall;
          store.appendQualityHistory({ at: now(), candidateId: cand.id, decision, pairs: o.pairs, conclusive: o.conclusive, agreementRate: o.agreementRate, kappa: o.kappa });
        } catch { /* the decision itself is saved; history is best effort and recomputed on read */ }
      }
      return send(res, 200, { ok: true, project: p, version: cand, distill });
    }

    if (route === '/related' && method === 'GET') {
      const p = getProject(q('projectId'));
      const query = String(q('q') || p.thesis || p.title).slice(0, 300);
      const r = searchRecordings(opts.root, query, { exclude: p.sourceTags, limit: 10 });
      return send(res, 200, { ok: true, query, ...r });
    }

    if (route === '/paper-trail' && method === 'GET') {
      const p = getProject(q('projectId'));
      const pt = paperTrailFor(loadPaperTrail(opts.root), p.sourceTags);
      const onDisk = new Set(listEpisodes(opts.root).map(e => e.releaseTag));
      return send(res, 200, { ok: true, quotes: pt.quotes, pairs: pt.pairs.map(x => ({ ...x, missingTranscripts: x.missingTags.filter(t => !onDisk.has(t)) })) });
    }

    if (route === '/style' && method === 'GET') return send(res, 200, { ok: true, ...styleState({}) });

    if (route === '/style/build' && method === 'POST') {
      const body = await readBody(req);
      void startStyleBuild(body).catch(() => undefined);
      return send(res, 202, { ok: true, ...styleState(body) });
    }

    if (route === '/style/rules' && method === 'POST') {
      const body = await readBody(req);
      try {
        if (typeof body?.add === 'string') addExplicitRule(store, body.add, now);
        if (typeof body?.remove === 'string') removeRule(store, body.remove);
      } catch (e: any) { throw new StepError('BAD_REQUEST', e?.message || String(e)); }
      return send(res, 200, { ok: true, ...styleState(body) });
    }

    if (route === '/style/distill' && method === 'POST') {
      const body = await readBody(req);
      const status = await startDistill(body);
      return send(res, 200, { ok: true, status, ...styleState(body) });
    }

    if (route === '/handoff/export' && method === 'POST') {
      const body = await readBody(req);
      const p = getProject(body?.projectId);
      const kind = String(body?.kind) as HandoffKind;
      if (!HANDOFF_KINDS.includes(kind)) throw new StepError('BAD_REQUEST', `kind must be one of ${HANDOFF_KINDS.join(', ')}.`);
      const id = body?.versionId || p.headVersionId;
      if (!id) throw new StepError('NO_SCRIPT', 'There is no script version to hand off yet. Outline or draft first.');
      const base = getVersion(p, id);
      if (kind === 'factcheck' && !base.segments.some(sg => sg.scenes.some(sc => sc.blocks.some(b => b.kind === 'narration')))) throw new StepError('NO_SCRIPT', 'This version has no narration to fact-check.');
      const requestId = newId('ho');
      const mem = store.getMemory();
      const corpus = engine.corpusFor(p);
      const pack = buildPack({
        kind, requestId, createdAt: now(), project: p, base, corpus, analysis: projectAnalysis(p, false),
        clips: p.clips, styleCard: draftStyle(store, opts.root).styleCard,
        rules: mem.styleRules.map(r => r.rule), approvedPassages: mem.approvedPassages.slice(-5).map(x => x.text),
      });
      const json = JSON.stringify(pack, null, 1);
      const rec: HandoffRecord = {
        requestId, projectId: p.id, kind, baseVersionId: base.id, createdAt: now(), promptVersion: PROMPT_VERSIONS.handoff,
        packHash: packHash(json), packBytes: Buffer.byteLength(json), note: String(body?.note || '').slice(0, 300), status: 'exported', imports: [],
      };
      store.writeJson(handoffPath(p.id, requestId), rec);
      res.setHeader('Content-Disposition', `attachment; filename="spacepipe-pack-${requestId}.json"`);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Request-Id', requestId);
      res.end(json);
      return;
    }

    if (route === '/handoffs' && method === 'GET') {
      const p = getProject(q('projectId'));
      // Each imported candidate with Logan's decision so far and its changes against the version it was exported from.
      const handoffs = listHandoffs(p.id).map(h => {
        const baseV = store.getVersion(p.id, h.baseVersionId);
        return {
          ...h,
          candidates: h.imports.flatMap(im => im.candidates.filter(c => c.versionId).map(c => {
            const v = store.getVersion(p.id, c.versionId!);
            return { versionId: c.versionId!, label: c.label, loganDecision: v?.decision?.loganDecision || null, diff: baseV && v ? diffVersions(baseV.segments, v.segments) : [] };
          })),
        };
      });
      return send(res, 200, { ok: true, handoffs });
    }

    if (route === '/handoff/import' && method === 'POST') {
      const body = await readBody(req);
      const p = getProject(body?.projectId);
      const raw = body?.result;
      const requestId = String(raw?.requestId || '');
      const rec = isSafeId(requestId) ? store.readJson<HandoffRecord>(handoffPath(p.id, requestId)) : null;
      if (!rec) throw new StepError('NOT_FOUND', `No exported pack ${requestId || '(missing requestId)'} for this project. Import the result into the project it was exported from.`);
      const bad = checkResultHeader(raw, rec);
      if (bad) throw new StepError('BAD_RESULT', bad);
      const base = getVersion(p, rec.baseVersionId);
      const warnings: string[] = [];
      const cache = new Map();
      const summary: ImportSummary = { at: now(), report: String(raw.report || '').slice(0, 20_000), warnings, candidates: [], factchecks: [], recordings: [] };
      if (rec.kind !== 'refine' && raw.candidates?.length) warnings.push(`A ${rec.kind} pass should not return candidates; ${raw.candidates.length} ignored.`);
      if (rec.kind === 'refine') {
        for (const c of (raw.candidates || []).slice(0, 5)) {
          const label = `Grok Bot: ${String(c?.label || 'candidate')}`;
          const r = await engine.importCandidate(p, base, Array.isArray(c?.scenes) ? c.scenes : [], { label, promptVersion: `${PROMPT_VERSIONS.handoff}:${rec.kind}` });
          summary.candidates.push(r.ok
            ? { label, summary: String(c?.summary || '').slice(0, 1000), versionId: r.version.id, gatesOk: r.gates.ok, failures: r.gates.failures, warnings: r.gates.warnings }
            : { label, summary: String(c?.summary || '').slice(0, 1000), error: r.reason });
        }
      }
      if (rec.kind === 'factcheck') summary.factchecks = checkFactchecks(opts.root, raw.factchecks, base, cache, warnings);
      if (rec.kind === 'storyline') summary.recordings = checkRecordings(opts.root, raw.recordings, p, cache, warnings);
      rec.imports.push(summary);
      rec.status = 'imported';
      store.writeJson(handoffPath(p.id, rec.requestId), rec);
      return send(res, 200, { ok: true, handoff: rec, summary });
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
    if (typeof val === 'string' && val.trim() && k.length < 200) out[k] = val.trim().slice(0, 100);
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
        if (!['narration', 'clip', 'pause', 'music', 'heading', 'cue'].includes(b?.kind)) throw new StepError('BAD_REQUEST', `Block ${b?.id} has unknown kind ${b?.kind}.`);
        if (b.kind === 'clip') {
          const clip = clips.get(b.clipId);
          if (!clip) {
            if (b.type === 'ARCHIVAL_CLIP' || b.spaceTitle || b.clipNumber) {
              continue;
            }
            throw new StepError('BAD_REQUEST', `Block ${b.id} names unknown clip ${b.clipId}.`);
          }
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
        if (b.kind === 'cue' && b.sec !== undefined && !(Number.isFinite(b.sec) && b.sec >= 0 && b.sec <= 30)) throw new StepError('BAD_REQUEST', `Cue ${b.id} pause duration must be 0 to 30 seconds.`);
        if (b.kind === 'heading' && typeof b.text !== 'string') throw new StepError('BAD_REQUEST', `Heading ${b.id} needs text.`);
      }
    }
  }
  return raw as Segment[];
}

export { draftStyle };
