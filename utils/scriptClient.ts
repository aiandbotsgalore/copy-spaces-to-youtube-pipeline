/** Browser client for the Script Studio API (/api/script, served by the app's own Vite server). */
import type { BlockDiff } from './scriptGates';
import type { CallStatsRow, LogEntry, LogSummary, PromptOutcomeRow, QualityReport } from './scriptQuality';
import type { RenderManifest } from './scriptCompile';
import type { DistillStatus, EpisodeAnalysis, EpisodeFormat, GateResult, RoleMap, RunEvent, ScriptProject, ScriptRun, ScriptVersion, Segment, StyleCard, StyleRule } from './scriptTypes';

export const ROLE_STORAGE_KEY = 'spacepipe_script_roles_v1';
export const PROJECT_STORAGE_KEY = 'spacepipe_script_project_v1';

export class ScriptApiError extends Error {
  constructor(public status: number, public code: string, message: string, public raw?: string, public resetHint?: string) { super(message); }
}

async function call<T>(method: 'GET' | 'POST', route: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/script${route}`, {
    method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let j: any = null;
  try { j = await res.json(); } catch { /* not JSON */ }
  if (!res.ok || (j && j.ok === false)) {
    throw new ScriptApiError(res.status, j?.code || `HTTP_${res.status}`, j?.message || `Script Studio API returned ${res.status}.`, j?.raw, j?.resetHint);
  }
  return j as T;
}

export interface ProviderHealth { ok: boolean; detail: string; provider: string; model: string; binPath?: string; code?: string }
export interface StatusResponse { providers: Record<string, ProviderHealth>; storeDir: string; interruptedAtStart: number; promptVersions: Record<string, string>; defaults: { subscription: RoleMap; fallback: RoleMap } }
export interface SpeakerStats { totalSec: number; unnamedShare: number; topUnnamed: { speaker: string; sec: number }[]; speakers: { speaker: string; sec: number }[] }
export interface VersionMeta { id: string; parentId: string | null; createdAt: number; author: string; label?: string; decision?: ScriptVersion['decision'] }
export interface RunMeta extends Omit<ScriptRun, 'events'> { eventCount: number; active: boolean }
export interface ProjectResponse {
  project: ScriptProject; versions: VersionMeta[]; runs: RunMeta[]; head: ScriptVersion | null;
  speakerStats: Record<string, SpeakerStats>; analyses: Record<string, EpisodeAnalysis | null>; transcriptChanged: string[];
  gates: (GateResult & { ok: boolean }) | null;
  formatChecks: { hard: { key: string; message: string }[]; soft: { key: string; message: string }[] } | null;
  recordings: RecordingInfo[];
}
export interface RecordingInfo { releaseTag: string; key: string; date: string | null; title: string; clips: number; analysed: boolean }
export interface StyleState {
  card: (Omit<StyleCard, 'coverage'> & { coverage: Omit<StyleCard['coverage'], 'recordingTags'> }) | null;
  freshness: { fresh: boolean; reason: string; newRecordings: number }; recordingsWithLogan: number;
  building: boolean; progress: string; lastError: { code: string; message: string; at: number } | null; narrationFiles: string[];
  rules: StyleRule[]; lastDistill: DistillStatus | null; decisionsSinceDistill: number; distillEvery: number; distilling: boolean; removedRules: string[];
}
export interface RelatedHit { releaseTag: string; title: string; date: string | null; score: number; terms: Record<string, number>; samples: { start: number; speaker: string; text: string }[] }
export interface CuratedQuote { quoteId: string; speaker: string; releaseTag: string; date: string; text: string; category: string; why: string }
export interface PaperTrailPair {
  pairId: string; title: string; pre: { quoteId: string; releaseTag: string; date: string }; post: { quoteId: string; releaseTag: string; date: string };
  preQuote: CuratedQuote | null; postQuote: CuratedQuote | null; missingTags: string[]; missingTranscripts: string[];
}

/** Logan's speaker renames from the transcript viewer (localStorage spk_names_<releaseTag>), for the style card. */
export function transcriptViewerRenames(): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || '';
      const m = /^spk_names_([A-Za-z0-9_.-]{3,120})$/.exec(k);
      if (!m) continue;
      const v = JSON.parse(localStorage.getItem(k) || 'null');
      if (v && typeof v === 'object') out[m[1]] = v;
    }
  } catch { /* no storage */ }
  return out;
}
export type { BlockDiff };
export interface RunResponse { run: ScriptRun & { active: boolean }; candidates: { id: string; parentId: string | null; decision?: ScriptVersion['decision']; diff: BlockDiff[] }[]; diffFromBase: BlockDiff[] }
export interface RoleChoice { mode: 'subscription' | 'fallback'; roleMap: Partial<RoleMap>; maxUsd: number; episodePass?: boolean; polish?: boolean }
export interface PreviewJob {
  id: string; projectId: string; versionId: string; sceneId: string | null; state: 'running' | 'finished' | 'failed' | 'cancelled';
  total: number; done: number; cached: number; synthesized: number; current: string | null;
  failures: { blockId: string; message: string }[]; unavailable: string | null; startedAt: number; finishedAt: number | null;
}
export interface RenderSummary {
  versionId: string; createdAt: number; totalSec: number; status: 'pending' | 'complete'; items: number; musicMarkers: number;
  measured: { integratedLufs: number; samplePeakDb: number } | null;
  audio?: { bytes: number; durationSec: number; sampleRate: number; channels: number; savedAt: number };
}
export type Tagging = { tagged: number; cached: boolean } | { error: string; code: string };

export const scriptApi = {
  status: () => call<StatusResponse>('GET', '/status'),
  episodes: () => call<{ episodes: { releaseTag: string; title: string }[] }>('GET', '/episodes'),
  projects: () => call<{ projects: ScriptProject[] }>('GET', '/projects'),
  createProject: (releaseTags: string[], targetRuntimeSec: number, extra: { format?: EpisodeFormat | null; thesis?: string } = {}) => call<{ project: ScriptProject }>('POST', '/project', { releaseTags, targetRuntimeSec, ...extra }),
  project: (id: string) => call<ProjectResponse>('GET', `/project?id=${encodeURIComponent(id)}`),
  updateProject: (id: string, patch: Record<string, unknown>) => call<{ project: ScriptProject }>('POST', '/project/update', { id, ...patch }),
  addClip: (id: string, fromId: string, toId: string, releaseTag?: string) => call<{ project: ScriptProject }>('POST', '/project/add-clip', { id, fromId, toId, releaseTag }),
  analyze: (projectId: string, roles: RoleChoice, force = false) => call<{ analyses: Record<string, EpisodeAnalysis>; tagging: Tagging }>('POST', '/analyze', { projectId, force, ...roles }),
  tagClips: (projectId: string, roles: RoleChoice, force = false) => call<{ project: ScriptProject; tagged: number; cached: boolean }>('POST', '/tag-clips', { projectId, force, ...roles }),
  retagClip: (id: string, clipId: string, fn: string | null) => call<{ project: ScriptProject }>('POST', '/project/update', { id, retagClips: [{ clipId, fn }] }),
  outline: (projectId: string, roles: RoleChoice) => call<{ version: ScriptVersion }>('POST', '/outline', { projectId, ...roles }),
  draft: (projectId: string, roles: RoleChoice) => call<{ version: ScriptVersion; gates: GateResult; style: { built: boolean; warning?: string } }>('POST', '/draft', { projectId, ...roles, renames: transcriptViewerRenames() }),
  saveVersion: (projectId: string, parentId: string | null, segments: Segment[], label: string) => call<{ version: ScriptVersion; gates: GateResult }>('POST', '/version', { projectId, parentId, segments, label }),
  version: (projectId: string, id: string) => call<{ version: ScriptVersion; diff: BlockDiff[] }>('GET', `/version?projectId=${encodeURIComponent(projectId)}&id=${encodeURIComponent(id)}`),
  setHead: (projectId: string, versionId: string) => call<{ project: ScriptProject }>('POST', '/head', { projectId, versionId }),
  refine: (projectId: string, roles: RoleChoice, opts: { targetSceneIds?: string[]; critiqueOnly?: boolean; spoken?: boolean } = {}) => call<{ runId: string }>('POST', '/refine', {
    projectId, ...roles, targetSceneIds: opts.targetSceneIds, critiqueOnly: !!opts.critiqueOnly, spoken: !!opts.spoken,
    episodePass: opts.spoken ? false : roles.episodePass !== false, polish: !opts.spoken && roles.mode === 'fallback' && !!roles.polish,
  }),
  run: (projectId: string, runId: string) => call<RunResponse>('GET', `/run?projectId=${encodeURIComponent(projectId)}&runId=${encodeURIComponent(runId)}`),
  cancel: (projectId: string, runId: string) => call<{ ok: boolean }>('POST', '/cancel', { projectId, runId }),
  resume: (projectId: string, runId: string, switchRole?: { role: string; spec: string }, maxUsd?: number) => call<{ runId: string }>('POST', '/resume', { projectId, runId, switchRole, maxUsd }),
  decide: (projectId: string, candidateId: string, decision: 'accept' | 'reject', reason = '', roles?: RoleChoice) => call<{ project: ScriptProject; distill: 'started' | 'running' | null }>('POST', '/decide', { projectId, candidateId, decision, reason, ...(roles || loadRoleChoice()) }),
  related: (projectId: string, q: string) => call<{ query: string; terms: string[]; hits: RelatedHit[]; scanned: number }>('GET', `/related?projectId=${encodeURIComponent(projectId)}&q=${encodeURIComponent(q)}`),
  paperTrail: (projectId: string) => call<{ quotes: CuratedQuote[]; pairs: PaperTrailPair[] }>('GET', `/paper-trail?projectId=${encodeURIComponent(projectId)}`),
  style: () => call<StyleState>('GET', '/style'),
  buildStyle: (roles: RoleChoice) => call<StyleState>('POST', '/style/build', { ...roles, renames: transcriptViewerRenames() }),
  styleRule: (change: { add?: string; remove?: string }) => call<StyleState>('POST', '/style/rules', change),
  distill: (roles: RoleChoice) => call<StyleState & { status: DistillStatus }>('POST', '/style/distill', roles),
  quality: () => call<{ report: QualityReport; prompts: PromptOutcomeRow[]; calls: CallStatsRow[]; history: { at: number; pairs: number; conclusive: number; agreementRate: number | null; kappa: number | null }[]; currentPromptVersions: Record<string, string> }>('GET', '/quality'),
  logs: () => call<{ logs: LogSummary[] }>('GET', '/logs'),
  log: (runId: string) => call<{ entries: LogEntry[] }>('GET', `/log?runId=${encodeURIComponent(runId)}`),
  preview: (projectId: string, sceneId?: string) => call<{ job: PreviewJob }>('POST', '/preview', { projectId, sceneId }),
  previewStatus: (projectId: string) => call<{ job: PreviewJob | null }>('GET', `/preview?projectId=${encodeURIComponent(projectId)}`),
  cancelPreview: (projectId: string) => call<{ cancelled: boolean }>('POST', '/preview/cancel', { projectId }),
  saveRenderManifest: (projectId: string, versionId: string, manifest: RenderManifest) => call<{ render: RenderSummary }>('POST', '/render', { projectId, versionId, manifest }),
  async uploadRender(projectId: string, versionId: string, wav: Blob): Promise<RenderSummary> {
    const res = await fetch(`/api/script/render/audio?projectId=${encodeURIComponent(projectId)}&versionId=${encodeURIComponent(versionId)}`, { method: 'PUT', headers: { 'Content-Type': 'audio/wav' }, body: wav });
    let j: any = null;
    try { j = await res.json(); } catch { /* not JSON */ }
    if (!res.ok || !j?.ok) throw new ScriptApiError(res.status, j?.code || `HTTP_${res.status}`, j?.message || `Saving the render failed (${res.status}).`);
    return j.render;
  },
  clipAudioUrl: (projectId: string, clipId: string) => `/api/script/clip-audio?projectId=${encodeURIComponent(projectId)}&clipId=${encodeURIComponent(clipId)}`,
  renders: (projectId: string) => call<{ renders: RenderSummary[] }>('GET', `/renders?projectId=${encodeURIComponent(projectId)}`),
  renderAudioUrl: (projectId: string, versionId: string) => `/api/script/render/audio?projectId=${encodeURIComponent(projectId)}&versionId=${encodeURIComponent(versionId)}`,
  renderManifestUrl: (projectId: string, versionId: string) => `/api/script/render/manifest?projectId=${encodeURIComponent(projectId)}&versionId=${encodeURIComponent(versionId)}`,
  exportUrl: (projectId: string) => `/api/script/export?projectId=${encodeURIComponent(projectId)}`,
  importProject: (data: unknown, overwrite: boolean) => call<{ project: ScriptProject }>('POST', '/import', { ...(data as object), overwrite }),
};

/** Streams a run's events (saved ones first). Returns a function that closes the stream; the run keeps going. */
export function streamRun(projectId: string, runId: string, onEvent: (e: RunEvent) => void, onIdle: () => void): () => void {
  const es = new EventSource(`/api/script/events?projectId=${encodeURIComponent(projectId)}&runId=${encodeURIComponent(runId)}`);
  es.onmessage = m => { try { onEvent(JSON.parse(m.data)); } catch { /* ignore */ } };
  es.addEventListener('idle', () => { es.close(); onIdle(); });
  es.onerror = () => { es.close(); onIdle(); };
  return () => es.close();
}

export const ROLE_SPECS = ['claude_cli:sonnet', 'claude_cli:haiku', 'codex_cli', 'ci:claude-haiku-5.5', 'ci:gpt-6-luna', 'ci:claude-sonnet-5.5'];

export function loadRoleChoice(): RoleChoice {
  try {
    const j = JSON.parse(localStorage.getItem(ROLE_STORAGE_KEY) || 'null');
    if (j && (j.mode === 'subscription' || j.mode === 'fallback')) return { mode: j.mode, roleMap: j.roleMap || {}, maxUsd: Number(j.maxUsd) || 0, episodePass: j.episodePass !== false, polish: !!j.polish };
  } catch { /* ignore */ }
  return { mode: 'subscription', roleMap: {}, maxUsd: 0, episodePass: true, polish: false };
}
export function saveRoleChoice(c: RoleChoice) { try { localStorage.setItem(ROLE_STORAGE_KEY, JSON.stringify(c)); } catch { /* ignore */ } }
