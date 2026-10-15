/**
 * Browser-side client for /api/montage/direct. Handles the backup key header, aborts and error mapping.
 */
import type { DirectorFail, DirectorRequest, DirectorResult, DirectorStatus } from './directorTypes';
import type { SortOk, SortRequest } from './aiSort';
import { loadDirectorKey, loadDirectorModel } from './storage';

const BASE = '/api/montage/direct';
const UNAVAILABLE: DirectorFail = {
  ok: false,
  code: 'SERVER_UNAVAILABLE',
  message: 'The Director needs the app server (run `npm run dev`). A static build has no AI endpoint.',
};

let statusCache: { at: number; value: DirectorStatus | null } | null = null;

export function invalidateDirectorStatus() {
  statusCache = null;
}

async function parseJson(res: Response): Promise<any | null> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** null = the Director endpoint is not reachable (e.g. static hosting). */
export async function fetchDirectorStatus(force = false): Promise<DirectorStatus | null> {
  if (!force && statusCache && Date.now() - statusCache.at < 15_000) return statusCache.value;
  try {
    const res = await fetch(`${BASE}/status`, { cache: 'no-store' });
    const j = await parseJson(res);
    const value = j && typeof j.keyConfigured === 'boolean' ? (j as DirectorStatus) : null;
    statusCache = { at: Date.now(), value };
    return value;
  } catch {
    statusCache = { at: Date.now(), value: null };
    return null;
  }
}

async function buildHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const status = await fetchDirectorStatus();
  const backup = loadDirectorKey();
  // The backup key is sent only when the server has no key of its own.
  if (backup && status && !status.keyConfigured) headers['x-director-key'] = backup;
  return headers;
}

async function request(path: string, init: RequestInit): Promise<{ ok: true; json: any } | DirectorFail> {
  try {
    const res = await fetch(`${BASE}${path}`, init);
    const json = await parseJson(res);
    if (!json || typeof json !== 'object') return UNAVAILABLE;
    if (json.ok === false) return json as DirectorFail;
    return { ok: true, json };
  } catch (err: any) {
    if (err && err.name === 'AbortError') return { ok: false, code: 'ABORTED', message: 'Cancelled.' };
    return UNAVAILABLE;
  }
}

export async function callDirector(req: DirectorRequest, signal?: AbortSignal): Promise<DirectorResult> {
  const model = req.model || loadDirectorModel() || undefined;
  const headers = await buildHeaders();
  const r = await request('', { method: 'POST', headers, body: JSON.stringify({ ...req, model }), signal });
  if (r.ok === false) return r;
  return r.json as DirectorResult;
}

export async function listDirectorModels(): Promise<{ models: string[]; default: string } | DirectorFail> {
  const headers = await buildHeaders();
  const r = await request('/models', { method: 'GET', headers, cache: 'no-store' });
  if (r.ok === false) return r;
  return { models: Array.isArray(r.json.models) ? r.json.models : [], default: String(r.json.default || '') };
}

export async function testDirectorConnection(): Promise<{ ok: true; model: string; ms: number; fellBack: boolean } | DirectorFail> {
  invalidateDirectorStatus();
  const headers = await buildHeaders();
  const r = await request('/test', { method: 'POST', headers, body: '{}' });
  if (r.ok === false) return r;
  return { ok: true, model: String(r.json.model || ''), ms: Number(r.json.ms) || 0, fellBack: !!r.json.fellBack };
}

/** AI Sort: asks the model to order the reel's clips. The response is a permutation of the request's refs. */
export async function callSortClips(req: SortRequest, signal?: AbortSignal): Promise<SortOk | DirectorFail> {
  const model = req.model || loadDirectorModel() || undefined;
  const headers = await buildHeaders();
  const r = await request('/sort', { method: 'POST', headers, body: JSON.stringify({ ...req, model }), signal });
  if (r.ok === false) return r;
  return r.json as SortOk;
}
