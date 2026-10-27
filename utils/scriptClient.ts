/** Browser client for the Script Studio API (/api/script, served by the app's own Vite server). */
import type { BlockDiff } from './scriptGates';
import type { EpisodeAnalysis, GateResult, RoleMap, RunEvent, ScriptProject, ScriptRun, ScriptVersion, Segment } from './scriptTypes';

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
}
export type { BlockDiff };
export interface RunResponse { run: ScriptRun & { active: boolean }; candidates: { id: string; parentId: string | null; decision?: ScriptVersion['decision']; diff: BlockDiff[] }[]; diffFromBase: BlockDiff[] }
export interface RoleChoice { mode: 'subscription' | 'fallback'; roleMap: Partial<RoleMap>; maxUsd: number }

export const scriptApi = {
  status: () => call<StatusResponse>('GET', '/status'),
  episodes: () => call<{ episodes: { releaseTag: string; title: string }[] }>('GET', '/episodes'),
  projects: () => call<{ projects: ScriptProject[] }>('GET', '/projects'),
  createProject: (releaseTag: string, targetRuntimeSec: number) => call<{ project: ScriptProject }>('POST', '/project', { releaseTag, targetRuntimeSec }),
  project: (id: string) => call<ProjectResponse>('GET', `/project?id=${encodeURIComponent(id)}`),
  updateProject: (id: string, patch: Record<string, unknown>) => call<{ project: ScriptProject }>('POST', '/project/update', { id, ...patch }),
  addClip: (id: string, fromId: string, toId: string) => call<{ project: ScriptProject }>('POST', '/project/add-clip', { id, fromId, toId }),
  analyze: (projectId: string, roles: RoleChoice, force = false) => call<{ analyses: Record<string, EpisodeAnalysis> }>('POST', '/analyze', { projectId, force, ...roles }),
  outline: (projectId: string, roles: RoleChoice) => call<{ version: ScriptVersion }>('POST', '/outline', { projectId, ...roles }),
  draft: (projectId: string, roles: RoleChoice) => call<{ version: ScriptVersion; gates: GateResult }>('POST', '/draft', { projectId, ...roles }),
  saveVersion: (projectId: string, parentId: string | null, segments: Segment[], label: string) => call<{ version: ScriptVersion; gates: GateResult }>('POST', '/version', { projectId, parentId, segments, label }),
  version: (projectId: string, id: string) => call<{ version: ScriptVersion; diff: BlockDiff[] }>('GET', `/version?projectId=${encodeURIComponent(projectId)}&id=${encodeURIComponent(id)}`),
  setHead: (projectId: string, versionId: string) => call<{ project: ScriptProject }>('POST', '/head', { projectId, versionId }),
  refine: (projectId: string, roles: RoleChoice, targetSceneIds?: string[]) => call<{ runId: string }>('POST', '/refine', { projectId, targetSceneIds, ...roles }),
  run: (projectId: string, runId: string) => call<RunResponse>('GET', `/run?projectId=${encodeURIComponent(projectId)}&runId=${encodeURIComponent(runId)}`),
  cancel: (projectId: string, runId: string) => call<{ ok: boolean }>('POST', '/cancel', { projectId, runId }),
  resume: (projectId: string, runId: string, switchRole?: { role: string; spec: string }, maxUsd?: number) => call<{ runId: string }>('POST', '/resume', { projectId, runId, switchRole, maxUsd }),
  decide: (projectId: string, candidateId: string, decision: 'accept' | 'reject', reason = '') => call<{ project: ScriptProject }>('POST', '/decide', { projectId, candidateId, decision, reason }),
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
    if (j && (j.mode === 'subscription' || j.mode === 'fallback')) return { mode: j.mode, roleMap: j.roleMap || {}, maxUsd: Number(j.maxUsd) || 0 };
  } catch { /* ignore */ }
  return { mode: 'subscription', roleMap: {}, maxUsd: 0 };
}
export function saveRoleChoice(c: RoleChoice) { try { localStorage.setItem(ROLE_STORAGE_KEY, JSON.stringify(c)); } catch { /* ignore */ } }
