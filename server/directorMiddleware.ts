/**
 * Server side of the AI Prompt Director (runs inside the Vite dev/preview server, never in the browser).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'http';
import type {
  CutId,
  DirectorCandidate,
  DirectorCurrentItem,
  DirectorErrorCode,
  DirectorFail,
  DirectorRequest,
  DirectorUsage,
} from '../utils/directorTypes';
import {
  CUT_IDS,
  DEFAULT_DIRECTOR_MODEL,
  DIRECTOR_MAX_TOKENS,
  DIRECTOR_TIMEOUT_MS,
  FALLBACK_DIRECTOR_MODEL,
  GENERATE_SCHEMA,
  REFINE_SCHEMA,
  buildSystemPrompt,
  targetForCut,
} from '../utils/directorProfile';
import {
  SORT_MAX_CLIPS,
  SORT_MIN_CLIPS,
  SORT_SCHEMA,
  buildSortMessages,
  validateSort,
  type SortItem,
  type SortRequest,
} from '../utils/aiSort';
import {
  enforceRuntimeDrop,
  estimateRuntime,
  parseJsonLoose,
  runtimeCheck,
  validateGenerate,
  validateRefine,
} from '../utils/directorValidate';
import type { CopilotAction, CopilotContextPayload, CopilotRequestBody, InspectedRunEvidence } from '../utils/copilotTypes';
import { getWorkflowRuns, inspectRunFailure, getReleases } from '../utils/github';
import { diffTranscriptGaps, enqueueMissingTranscripts } from './transcriptGapService';
import { buildCopilotSystemPrompt, extractCopilotActions } from './copilotPrompt';
import { sanitizeCopilotText } from '../utils/copilotText';
import {
  searchTranscriptArchive,
  detectSearchIntent,
  getArchiveStats,
  getEpisodeTranscript,
  loadSummaries,
  handleSearchTranscripts,
  registerEpisodeSegments,
  formatTimestamp,
  type TranscriptMatch,
} from './transcriptSearchService';

export interface DirectorEnv {
  [k: string]: string | undefined;
}

export interface DirectorMiddlewareOptions {
  getEnv: () => DirectorEnv;
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URL = 'https://api.inceptionlabs.ai/v1';
const BODY_LIMIT = 1_000_000;
const MAX_CONCURRENT = 3;

export function isValidModelId(id: string): boolean {
  return /^[a-z0-9][a-z0-9._:\/-]{0,99}$/i.test(id);
}

const STATUS_FOR: Record<DirectorErrorCode, number> = {
  NO_KEY: 401,
  UNAUTHORIZED: 401,
  RATE_LIMIT: 429,
  TIMEOUT: 504,
  UPSTREAM: 502,
  MODEL_NOT_FOUND: 404,
  NOT_FOUND: 404,
  BAD_OUTPUT: 502,
  BAD_REQUEST: 400,
  NO_CANDIDATES: 400,
  FORBIDDEN_ORIGIN: 403,
  SERVER_UNAVAILABLE: 503,
  ABORTED: 499,
};

export function isLoopback(addr: string | undefined): boolean {
  if (!addr) return false;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

export function scrub(text: string, key?: string): string {
  let t = String(text ?? '');
  if (key) t = t.split(key).join('[redacted]');
  return t
    .replace(/ci_live_[A-Za-z0-9]+/g, '[redacted]')
    .replace(/sk_[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/cohere_[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]');
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function fail(res: ServerResponse, code: DirectorErrorCode, message: string, extra: Partial<DirectorFail> = {}) {
  const body: DirectorFail = { ok: false, code, message, ...extra };
  send(res, STATUS_FOR[code], body);
}

function readBody(req: IncomingMessage): Promise<{ ok: true; text: string } | { ok: false; tooLarge: boolean }> {
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on('data', (c: Buffer | string) => {
      if (done) return;
      const b = Buffer.isBuffer(c) ? c : Buffer.from(c);
      size += b.length;
      if (size > BODY_LIMIT) {
        done = true;
        resolve({ ok: false, tooLarge: true });
        return;
      }
      chunks.push(b);
    });
    req.on('end', () => {
      if (!done) {
        done = true;
        resolve({ ok: true, text: Buffer.concat(chunks).toString('utf8') });
      }
    });
    req.on('error', () => {
      if (!done) {
        done = true;
        resolve({ ok: false, tooLarge: false });
      }
    });
  });
}

export class Limiter {
  private active = 0;
  private queue: Array<() => void> = [];
  constructor(private max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>(r => this.queue.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
};

interface GatewayParams {
  fetchImpl: typeof fetch;
  baseUrl: string;
  key: string;
  model: string;
  messages: ChatMessage[];
  tools?: any[];
  tool_choice?: any;
  schemaName?: string;
  schema?: unknown;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  clientSignal: AbortSignal;
}

type GatewayOutcome =
  | {
      ok: true;
      text: string;
      tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
      finish_reason?: string;
      usage: DirectorUsage;
      model: string;
      fellBack: boolean;
    }
  | { ok: false; code: DirectorErrorCode; message: string; retryAfterSec?: number };

let schemaSupported: boolean | null = null;
export function __resetGatewayMemory() {
  schemaSupported = null;
}

const addUsage = (a: DirectorUsage, b: DirectorUsage): DirectorUsage => ({
  promptTokens: a.promptTokens + b.promptTokens,
  completionTokens: a.completionTokens + b.completionTokens,
});

async function callGateway(p: GatewayParams): Promise<GatewayOutcome> {
  let useSchema = Boolean(p.schema && schemaSupported !== false);
  let tokenParam: 'max_tokens' | 'max_completion_tokens' = 'max_tokens';
  let model = p.model;
  let fellBack = false;

  const timeoutCtl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    timeoutCtl.abort();
  }, p.timeoutMs);
  const onClientAbort = () => timeoutCtl.abort();
  if (p.clientSignal.aborted) timeoutCtl.abort();
  p.clientSignal.addEventListener('abort', onClientAbort, { once: true });

  try {
    for (let attempt = 0; attempt < 6; attempt++) {
      const body: Record<string, unknown> = {
        model,
        messages: p.messages,
        temperature: p.temperature,
        [tokenParam]: p.maxTokens,
      };
      if (p.tools && p.tools.length > 0) {
        body.tools = p.tools;
        if (p.tool_choice) body.tool_choice = p.tool_choice;
      }
      if (useSchema && p.schemaName && p.schema) {
        body.response_format = {
          type: 'json_schema',
          json_schema: { name: p.schemaName, strict: true, schema: p.schema },
        };
      }

      let res: Response;
      try {
        res = await p.fetchImpl(`${p.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.key}` },
          body: JSON.stringify(body),
          signal: timeoutCtl.signal,
        });
      } catch (err: any) {
        if (err && err.name === 'AbortError') {
          if (p.clientSignal.aborted && !timedOut) return { ok: false, code: 'ABORTED', message: 'Request cancelled.' };
          return { ok: false, code: 'TIMEOUT', message: `The model did not answer within ${Math.round(p.timeoutMs / 1000)} s.` };
        }
        return { ok: false, code: 'UPSTREAM', message: scrub(`Could not reach the gateway: ${err?.message || 'network error'}`, p.key) };
      }

      if (res.ok) {
        let json: any;
        try {
          json = await res.json();
        } catch {
          return { ok: false, code: 'UPSTREAM', message: 'Gateway returned a non-JSON response.' };
        }
        const choice = json?.choices?.[0];
        const msg = choice?.message;
        const content = msg?.content;
        const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((c: any) => c?.text || '').join('') : '';
        const tool_calls = Array.isArray(msg?.tool_calls) ? msg.tool_calls : undefined;
        if (!text && (!tool_calls || tool_calls.length === 0)) return { ok: false, code: 'BAD_OUTPUT', message: 'The model returned an empty response.' };
        if (useSchema && schemaSupported === null) schemaSupported = true;
        return {
          ok: true,
          text,
          tool_calls,
          finish_reason: choice?.finish_reason,
          model: json?.model || model,
          fellBack,
          usage: {
            promptTokens: Number(json?.usage?.prompt_tokens) || 0,
            completionTokens: Number(json?.usage?.completion_tokens) || 0,
          },
        };
      }

      const errText = scrub((await res.text().catch(() => '')).slice(0, 400), p.key);
      const lower = errText.toLowerCase();

      if (res.status === 401 || res.status === 403) {
        return { ok: false, code: 'UNAUTHORIZED', message: 'The gateway rejected the API key.' };
      }
      if (res.status === 429) {
        const ra = Number(res.headers.get('retry-after'));
        return { ok: false, code: 'RATE_LIMIT', message: 'Rate limited by the gateway.', retryAfterSec: Number.isFinite(ra) && ra > 0 ? ra : undefined };
      }

      const isModelError =
        (res.status === 404 || res.status === 400 || res.status === 422) &&
        /model/.test(lower) &&
        /(not found|does not exist|unknown|invalid|unsupported|no such)/.test(lower);
      if (isModelError) {
        if (!fellBack && model !== FALLBACK_DIRECTOR_MODEL) {
          model = FALLBACK_DIRECTOR_MODEL;
          fellBack = true;
          continue;
        }
        return { ok: false, code: 'MODEL_NOT_FOUND', message: `Model "${model}" is not available on the gateway.` };
      }

      if (res.status === 400 || res.status === 422) {
        if (body.tools || /(tool|tools|function|parameters|tool_use|tool_result)/i.test(lower)) {
          delete body.tools;
          delete body.tool_choice;
          p.tools = undefined;
          if (Array.isArray(body.messages)) {
            body.messages = body.messages.map((m: any) => {
              if (m.role === 'tool') {
                return { role: 'user', content: `[Tool Result: ${m.name || 'search'}]\n${m.content || ''}` };
              }
              if (m.tool_calls) {
                const { tool_calls, ...rest } = m;
                return { ...rest, content: m.content || 'Searched transcripts' };
              }
              return m;
            });
          }
          continue;
        }
        if (useSchema && /(response_format|json_schema|structured|schema)/.test(lower)) {
          useSchema = false;
          schemaSupported = false;
          continue;
        }
        if (tokenParam === 'max_tokens' && /max_tokens/.test(lower)) {
          tokenParam = 'max_completion_tokens';
          continue;
        }
        if (tokenParam === 'max_completion_tokens' && /max_completion_tokens/.test(lower)) {
          tokenParam = 'max_tokens';
          continue;
        }
        return { ok: false, code: 'UPSTREAM', message: `Gateway rejected the request (${res.status}). ${errText}`.trim() };
      }

      return { ok: false, code: 'UPSTREAM', message: `Gateway error ${res.status}. ${errText}`.trim() };
    }
    return { ok: false, code: 'UPSTREAM', message: 'Gateway kept rejecting the request.' };
  } finally {
    clearTimeout(timer);
    p.clientSignal.removeEventListener('abort', onClientAbort);
  }
}

function parseRequest(raw: any): { ok: true; req: DirectorRequest } | { ok: false; message: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, message: 'Body must be a JSON object.' };
  const mode = raw.mode;
  if (mode !== 'generate' && mode !== 'refine') return { ok: false, message: 'mode must be "generate" or "refine".' };
  if (!CUT_IDS.includes(raw.cutId)) return { ok: false, message: 'cutId must be cut_a, cut_b or cut_c.' };
  const userPrompt = typeof raw.userPrompt === 'string' ? raw.userPrompt.slice(0, 2000) : '';
  const target = Number(raw.targetWindowSec);
  if (!Number.isFinite(target) || target < 5 || target > 3600) return { ok: false, message: 'targetWindowSec must be between 5 and 3600.' };
  if (!Array.isArray(raw.candidates)) return { ok: false, message: 'candidates must be an array.' };
  if (raw.candidates.length > 300) return { ok: false, message: 'Too many candidates.' };
  const candidates: DirectorCandidate[] = [];
  for (const c of raw.candidates) {
    if (!c || typeof c.id !== 'string' || typeof c.text !== 'string' || !(Number(c.durationSec) > 0)) {
      return { ok: false, message: 'Each candidate needs id, text and a positive durationSec.' };
    }
    candidates.push({
      id: c.id,
      quoteId: typeof c.quoteId === 'string' ? c.quoteId : undefined,
      speaker: String(c.speaker ?? ''),
      category: typeof c.category === 'string' ? c.category : undefined,
      sourceDate: typeof c.sourceDate === 'string' ? c.sourceDate : undefined,
      sourceTitle: String(c.sourceTitle ?? ''),
      status: c.status === 'READY_FOR_EXTRACTION' ? 'READY_FOR_EXTRACTION' : 'EXISTS',
      durationSec: Number(c.durationSec),
      text: c.text,
      textTruncated: !!c.textTruncated,
    });
  }
  const model = typeof raw.model === 'string' && isValidModelId(raw.model) ? raw.model : undefined;
  const base = { cutId: raw.cutId as CutId, userPrompt, targetWindowSec: target, candidates, model };
  if (mode === 'generate') return { ok: true, req: { mode, ...base } };

  const instruction = typeof raw.instruction === 'string' ? raw.instruction.trim().slice(0, 1000) : '';
  if (!instruction) return { ok: false, message: 'refine needs an instruction.' };
  if (!Array.isArray(raw.current) || raw.current.length === 0 || raw.current.length > 100) {
    return { ok: false, message: 'refine needs the current timeline.' };
  }
  const current: DirectorCurrentItem[] = raw.current.map((c: any, i: number) => ({
    index: Number.isFinite(c?.index) ? c.index : i,
    clipId: String(c?.clipId ?? ''),
    text: String(c?.text ?? ''),
    textTruncated: !!c?.textTruncated,
    startSec: Number(c?.startSec) || 0,
    endSec: Number(c?.endSec) || 0,
    durationSec: Number(c?.durationSec) || 0,
    gapAfterSec: Number(c?.gapAfterSec) || 0,
    tensionScore: Number.isFinite(c?.tensionScore) ? c.tensionScore : undefined,
    note: typeof c?.note === 'string' ? c.note : undefined,
    locked: !!c?.locked,
  }));
  return { ok: true, req: { mode, ...base, instruction, current } };
}

function buildMessages(req: DirectorRequest, target: number): ChatMessage[] {
  const system = buildSystemPrompt(req.cutId, req.mode);
  const payload: Record<string, unknown> =
    req.mode === 'generate'
      ? { candidates: req.candidates, task: 'generate', cutId: req.cutId, userPrompt: req.userPrompt, targetWindowSec: target }
      : {
          candidates: req.candidates,
          task: 'refine',
          cutId: req.cutId,
          userPrompt: req.userPrompt,
          instruction: req.instruction,
          targetWindowSec: target,
          current: req.current,
        };
  return [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify(payload) },
  ];
}

async function runDirector(
  req: DirectorRequest,
  gw: Omit<GatewayParams, 'messages' | 'schemaName' | 'schema' | 'temperature'>
): Promise<
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; code: DirectorErrorCode; message: string; retryAfterSec?: number }
> {
  const started = Date.now();
  const target = targetForCut(req.cutId, req.targetWindowSec);
  const candidatesById = Object.fromEntries(req.candidates.map(c => [c.id, c]));
  const messages = buildMessages(req, target);
  const isGen = req.mode === 'generate';
  const call = (msgs: ChatMessage[]) =>
    callGateway({
      ...gw,
      messages: msgs,
      schemaName: isGen ? 'director_cut' : 'director_refine',
      schema: isGen ? GENERATE_SCHEMA : REFINE_SCHEMA,
      temperature: isGen ? 0.4 : 0.2,
    });

  const evaluate = (text: string) => {
    const parsed = parseJsonLoose(text);
    if (req.mode === 'generate') {
      const v = validateGenerate(parsed, { cutId: req.cutId, candidatesById });
      const issues = [...v.errors];
      let rt: ReturnType<typeof runtimeCheck> | null = null;
      if (!issues.length && v.value) {
        const est = estimateRuntime(v.value.picks, candidatesById);
        rt = runtimeCheck(est, target);
        if (!rt.ok) {
          issues.push(
            `Estimated runtime is ${est.toFixed(0)} s but the target is ${target.toFixed(0)} s (allowed ${rt.lo.toFixed(0)} to ${rt.hi.toFixed(0)} s). ` +
              (rt.over ? 'Remove or shorten picks.' : 'Add picks or trim less.')
          );
        }
      }
      return { v, issues, rt, structuralErrors: v.errors.length };
    }
    const v = validateRefine(parsed, { current: req.current, candidatesById });
    return { v, issues: [...v.errors], rt: null, structuralErrors: v.errors.length };
  };

  const first = await call(messages);
  if (first.ok === false) return first;
  let usage = first.usage;
  let model = first.model;
  let ev = evaluate(first.text);
  let usable = ev.v.value && ev.structuralErrors === 0 ? ev : null;

  if (ev.issues.length) {
    const repairMsgs: ChatMessage[] = [
      ...messages,
      { role: 'assistant', content: first.text },
      {
        role: 'user',
        content:
          'Your output has problems:\n- ' +
          ev.issues.slice(0, 8).join('\n- ') +
          '\nReturn the corrected JSON object only, following every rule. Use only ids from "candidates".',
      },
    ];
    const second = await call(repairMsgs);
    if (second.ok === true) {
      usage = addUsage(usage, second.usage);
      model = second.model;
      const ev2 = evaluate(second.text);
      if (ev2.v.value && ev2.structuralErrors === 0) {
        ev = ev2;
        usable = ev2;
      }
    } else if (second.ok === false && (second.code === 'UNAUTHORIZED' || second.code === 'ABORTED')) {
      return second;
    }
  }

  if (!usable || !usable.v.value) {
    const why = ev.issues.slice(0, 3).join(' ');
    return { ok: false, code: 'BAD_OUTPUT', message: `The model's output could not be used. ${why}`.trim() };
  }

  const warnings = [...usable.v.warnings];
  if (req.mode === 'generate') {
    let cut = usable.v.value as import('../utils/directorTypes').DirectorCutResponse;
    const est = estimateRuntime(cut.picks, candidatesById);
    const rt = runtimeCheck(est, target);
    if (rt.over) {
      const fixed = enforceRuntimeDrop(cut.picks, candidatesById, target);
      if (fixed.dropped.length) {
        warnings.push(`Dropped ${fixed.dropped.length} lowest-tension clip(s) to fit the ${target.toFixed(0)} s target.`);
        cut = { ...cut, picks: fixed.picks };
      }
    } else if (rt.under) {
      warnings.push(`Cut runs about ${est.toFixed(0)} s, short of the ${target.toFixed(0)} s target (no clips were invented).`);
    }
    return { ok: true, body: { ok: true, mode: 'generate', cut, warnings, usage, model, ms: Date.now() - started } };
  }
  const refine = usable.v.value as import('../utils/directorTypes').DirectorRefineResponse;
  return { ok: true, body: { ok: true, mode: 'refine', refine, warnings, usage, model, ms: Date.now() - started } };
}

function parseSortRequest(raw: any): { ok: true; req: SortRequest } | { ok: false; message: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, message: 'Body must be a JSON object.' };
  if (!Array.isArray(raw.items)) return { ok: false, message: 'items must be an array.' };
  if (raw.items.length < SORT_MIN_CLIPS) return { ok: false, message: `Add at least ${SORT_MIN_CLIPS} clips to sort.` };
  if (raw.items.length > SORT_MAX_CLIPS) return { ok: false, message: `Too many clips to sort (limit ${SORT_MAX_CLIPS}).` };
  const items: SortItem[] = [];
  const seen = new Set<string>();
  for (const c of raw.items) {
    if (!c || typeof c.ref !== 'string' || !c.ref || seen.has(c.ref) || typeof c.text !== 'string') {
      return { ok: false, message: 'Each item needs a unique ref and text.' };
    }
    seen.add(c.ref);
    items.push({
      ref: c.ref,
      text: c.text.slice(0, 400),
      textTruncated: !!c.textTruncated || undefined,
      speaker: String(c.speaker ?? '').slice(0, 80),
      category: typeof c.category === 'string' ? c.category.slice(0, 40) : undefined,
      severity: Number.isFinite(c.severity) ? Number(c.severity) : undefined,
      sourceTitle: String(c.sourceTitle ?? '').slice(0, 160),
      sourceDate: typeof c.sourceDate === 'string' ? c.sourceDate.slice(0, 40) : undefined,
      durationSec: Number(c.durationSec) > 0 ? Number(c.durationSec) : null,
    });
  }
  const theme = typeof raw.theme === 'string' ? raw.theme.trim().slice(0, 500) : '';
  const model = typeof raw.model === 'string' && isValidModelId(raw.model) ? raw.model : undefined;
  return { ok: true, req: { items, theme: theme || undefined, model } };
}

async function runSort(
  req: SortRequest,
  gw: Omit<GatewayParams, 'messages' | 'schemaName' | 'schema' | 'temperature'>
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; code: DirectorErrorCode; message: string; retryAfterSec?: number }> {
  const started = Date.now();
  const refs = req.items.map(i => i.ref);
  const messages = buildSortMessages(req);
  const call = (msgs: ChatMessage[]) =>
    callGateway({ ...gw, messages: msgs, schemaName: 'montage_sort', schema: SORT_SCHEMA, temperature: 0.3 });

  const first = await call(messages);
  if (first.ok === false) return first;
  let usage = first.usage;
  let model = first.model;
  let v = validateSort(parseJsonLoose(first.text), refs);

  if (!v.ok) {
    const second = await call([
      ...messages,
      { role: 'assistant', content: first.text },
      {
        role: 'user',
        content: `Your output has a problem: ${v.error} Return the corrected JSON object only, using each ref from "clips" exactly once.`,
      },
    ]);
    if (second.ok === true) {
      usage = addUsage(usage, second.usage);
      model = second.model;
      v = validateSort(parseJsonLoose(second.text), refs);
    } else if (second.code === 'UNAUTHORIZED' || second.code === 'ABORTED') {
      return second;
    }
  }
  if (!v.ok) return { ok: false, code: 'BAD_OUTPUT', message: `The model's ordering could not be used. ${v.error || ''}`.trim() };
  return {
    ok: true,
    body: { ok: true, mode: 'sort', order: v.order, rationale: v.rationale, warnings: v.warnings, usage, model, ms: Date.now() - started },
  };
}

const COPILOT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_transcripts',
      description: 'Search spoken dialogue across all indexed Space transcripts or within the active episode.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Clean search string.' },
          scope: { type: 'string', enum: ['active_episode', 'all_transcripts'] },
          speaker_hint: { type: 'string' },
          timestamp_sec: { type: 'number' },
          mode: { type: 'string', enum: ['hybrid', 'lexical', 'vector', 'rerank'] },
        },
        required: ['query', 'scope'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_run_history',
      description: 'Fetch recent GitHub Actions workflow runs to inspect and diagnose pipeline failures or check execution status.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of recent runs to return (default: 10, max: 30)' },
          status: { type: 'string', enum: ['all', 'failed', 'completed', 'active'], description: 'Filter by run status' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_run_jobs',
      description: 'Inspect the detailed jobs, steps, and failure log excerpts of one or more GitHub Actions workflow runs concurrently.',
      parameters: {
        type: 'object',
        properties: {
          runId: { type: 'number', description: 'The numeric GitHub Actions workflow run ID to inspect' },
          runIds: {
            type: 'array',
            items: { type: 'number' },
            description: 'List of numeric workflow run IDs to inspect concurrently in batch'
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_queue',
      description: 'Inspect current items in batch_queue.txt or space_queue.txt awaiting automated ingest.',
      parameters: {
        type: 'object',
        properties: {
          queue: { type: 'string', enum: ['space_queue.txt', 'batch_queue.txt', 'all'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_voice_profiles',
      description: 'Fetch the live voice profile library, enrolled speakers, sample counts, and neural embeddings.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_transcript_gaps',
      description: 'Audit GitHub repository releases against local/published transcripts to identify untranscribed episodes.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Maximum number of missing episodes to return in sample (default 10)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'dispatch_transcript_backfill',
      description: 'Enqueue untranscribed episodes into batch_queue.txt for automated background transcription.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of missing episodes to enqueue (default 5, max 20)' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Specific release tags to enqueue' },
        },
      },
    },
  },
];

async function executeSearchTranscriptsTool(
  params: { query?: string; scope?: 'active_episode' | 'all_transcripts'; speaker_hint?: string; timestamp_sec?: number; mode?: 'hybrid' | 'lexical' | 'vector' | 'rerank' },
  enrichedContext: CopilotContextPayload,
  searchIntent: any,
  fetchImpl?: typeof fetch
): Promise<{ toolResult: Record<string, any>; action: CopilotAction; matches: TranscriptMatch[] }> {
  let query = (params.query || '').trim();
  const scope: 'active_episode' | 'all_transcripts' = params.scope === 'active_episode' ? 'active_episode' : 'all_transcripts';
  let speakerHint = params.speaker_hint;
  let timestampSec = params.timestamp_sec;
  let mode = params.mode;

  if (!query && searchIntent?.query) {
    query = searchIntent.query;
  }
  if (!speakerHint && searchIntent?.speaker) {
    speakerHint = searchIntent.speaker;
  }
  if (timestampSec === undefined && searchIntent?.timestampSec !== undefined) {
    timestampSec = searchIntent.timestampSec;
  }

  const activeEpTag = enrichedContext.currentEpisode?.releaseTag;
  const searchRes = await handleSearchTranscripts({
    query,
    scope,
    speaker_hint: speakerHint,
    episodeTag: scope === 'active_episode' ? activeEpTag : undefined,
    timestamp_sec: timestampSec,
    activeSegments: enrichedContext.currentEpisode?.allSegments,
    maxResults: 12,
    mode,
    fetchImpl,
  });

  const action: CopilotAction = {
    id: `act_search_${Date.now()}`,
    action: 'SEARCH_TRANSCRIPTS',
    params: { query: searchRes.queryUsed, scope: searchRes.scopeUsed, speaker_hint: searchRes.speakerFilterApplied, timestamp_sec: timestampSec },
    explanation: `Searched transcripts for "${searchRes.queryUsed || 'timestamp'}"`,
    status: searchRes.matches.length > 0 ? 'completed' : 'no_matches',
    matchCount: searchRes.matches.length,
    resultData: { total_matches: searchRes.totalMatches, matches: searchRes.matches },
  };

  return {
    toolResult: { total_matches: searchRes.totalMatches, matches: searchRes.matches },
    action,
    matches: searchRes.matches,
  };
}

async function executeGetRunHistoryTool(
  params: { limit?: number; status?: 'all' | 'failed' | 'completed' | 'active' },
  ghToken: string,
  owner: string,
  repo: string
): Promise<{ toolResult: Record<string, any>; action: CopilotAction }> {
  const limit = typeof params.limit === 'number' && params.limit > 0 ? Math.min(params.limit, 30) : 10;
  const status = params.status || 'all';
  try {
    const allRuns = await getWorkflowRuns(ghToken, owner, repo);
    let filtered = allRuns;
    if (status === 'active') {
      filtered = allRuns.filter(r => r.status === 'in_progress' || r.status === 'queued');
    } else if (status === 'failed') {
      filtered = allRuns.filter(r => r.conclusion === 'failure');
    } else if (status === 'completed') {
      filtered = allRuns.filter(r => r.status === 'completed');
    }
    const sample = filtered.slice(0, limit).map(r => ({
      id: r.id,
      name: r.name,
      status: r.status,
      conclusion: r.conclusion,
      createdAt: r.created_at,
      htmlUrl: r.html_url,
      headBranch: (r as any).head_branch || 'master',
      event: (r as any).event || 'push',
      runNumber: (r as any).run_number,
    }));
    const failedInWindow = sample.filter(r => r.conclusion === 'failure').length;
    const allFailedRuns = allRuns.filter(r => r.conclusion === 'failure');
    const totalFailedOverall = allFailedRuns.length;
    const allFailedRunIds = allFailedRuns.map(r => r.id).slice(0, 10);
    const resultData = {
      totalReturned: sample.length,
      windowLimit: limit,
      failedInWindow,
      totalFailedOverall,
      allFailedRunIds,
      filter: status,
      repo: `${owner}/${repo}`,
      runs: sample,
    };
    return {
      toolResult: resultData,
      action: {
        id: `act_runs_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        action: 'GET_RUN_HISTORY',
        params: { limit, status },
        explanation: `Fetched ${sample.length} recent workflow runs for ${owner}/${repo} (${failedInWindow} failed in window, ${totalFailedOverall} total failures)`,
        status: 'completed',
        resultData,
      },
    };
  } catch (err: any) {
    const resultData = {
      error: err?.message || 'Failed to fetch workflow runs',
      repo: `${owner}/${repo}`,
      runs: [],
    };
    return {
      toolResult: resultData,
      action: {
        id: `act_runs_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        action: 'GET_RUN_HISTORY',
        params: { limit, status },
        explanation: `Failed to fetch workflow runs: ${err?.message}`,
        status: 'failed',
        errorMessage: err?.message,
        resultData,
      },
    };
  }
}

async function executeGetRunJobsTool(
  params: { runId?: number | string; runIds?: Array<number | string> },
  ghToken: string,
  owner: string,
  repo: string,
  inspectedRuns: Record<number, InspectedRunEvidence>
): Promise<{ toolResult: Record<string, any>; action: CopilotAction }> {
  const ids: number[] = [];
  if (Array.isArray(params.runIds)) {
    for (const r of params.runIds) {
      const num = Number(r);
      if (num && !ids.includes(num)) ids.push(num);
    }
  }
  if (params.runId) {
    const single = Number(params.runId);
    if (single && !ids.includes(single)) ids.push(single);
  }

  if (ids.length === 0) {
    const resultData = { error: 'runId or runIds is required for GET_RUN_JOBS' };
    return {
      toolResult: resultData,
      action: {
        id: `act_jobs_${Date.now()}_invalid`,
        action: 'GET_RUN_JOBS',
        params,
        explanation: 'Missing runId or runIds for job inspection',
        status: 'failed',
        errorMessage: 'runId or runIds is required',
        resultData,
      },
    };
  }

  // Cap batch size to 6 to stay well within GitHub API and context limits
  const targetIds = ids.slice(0, 6);

  try {
    const inspectionPromises = targetIds.map(async id => {
      try {
        const failureInfo = await inspectRunFailure(ghToken, owner, repo, id);
        const evidence: InspectedRunEvidence = {
          runId: id,
          name: `Run #${id}`,
          conclusion: 'failure',
          failedJob: failureInfo.failedJobName,
          failedStep: failureInfo.failedStepName,
          errorExcerpt: failureInfo.errorExcerpt,
          inspectedAt: new Date().toISOString(),
          htmlUrl: `https://github.com/${owner}/${repo}/actions/runs/${id}`,
        };
        inspectedRuns[id] = evidence;
        return {
          runId: id,
          ok: true,
          failedJob: failureInfo.failedJobName || 'unknown',
          failedStep: failureInfo.failedStepName || 'unknown',
          errorExcerpt: failureInfo.errorExcerpt || 'No error log excerpt available.',
        };
      } catch (err: any) {
        return {
          runId: id,
          ok: false,
          error: err?.message || 'Failed to inspect job',
        };
      }
    });

    const settled = await Promise.all(inspectionPromises);
    const resultData = {
      inspectedCount: settled.length,
      repo: `${owner}/${repo}`,
      runs: settled,
    };

    return {
      toolResult: resultData,
      action: {
        id: `act_jobs_${Date.now()}_${targetIds.join('_')}`,
        action: 'GET_RUN_JOBS',
        params: { runId: targetIds[0], runIds: targetIds },
        explanation: `Inspected failure logs for ${targetIds.length} workflow run(s): ${targetIds.map(id => `#${id}`).join(', ')}`,
        status: 'completed',
        resultData,
      },
    };
  } catch (err: any) {
    const resultData = {
      runs: targetIds,
      repo: `${owner}/${repo}`,
      error: err?.message || `Failed to inspect runs: ${targetIds.join(', ')}`,
    };
    return {
      toolResult: resultData,
      action: {
        id: `act_jobs_${Date.now()}_err`,
        action: 'GET_RUN_JOBS',
        params,
        explanation: `Failed to inspect jobs: ${err?.message}`,
        status: 'failed',
        errorMessage: err?.message,
        resultData,
      },
    };
  }
}

function executeGetQueueTool(params: { queue?: string }): { toolResult: Record<string, any>; action: CopilotAction } {
  const queues: Record<string, string[]> = {};
  try {
    const sqPath = path.resolve(process.cwd(), 'space_queue.txt');
    const bqPath = path.resolve(process.cwd(), 'batch_queue.txt');
    queues['space_queue.txt'] = fs.existsSync(sqPath)
      ? fs.readFileSync(sqPath, 'utf8').split('\n').map(l => l.trim()).filter(l => Boolean(l) && !l.startsWith('#'))
      : [];
    queues['batch_queue.txt'] = fs.existsSync(bqPath)
      ? fs.readFileSync(bqPath, 'utf8').split('\n').map(l => l.trim()).filter(l => Boolean(l) && !l.startsWith('#'))
      : [];
  } catch (err: any) {
    queues['error'] = [err?.message || 'Could not read queue files'];
  }
  const resultData = { queues };
  return {
    toolResult: resultData,
    action: {
      id: `act_queue_${Date.now()}`,
      action: 'GET_QUEUE',
      params: { queue: params.queue || 'all' },
      explanation: 'Inspected local space queues',
      status: 'completed',
      resultData,
    },
  };
}

function executeGetVoiceProfilesTool(): { toolResult: Record<string, any>; action: CopilotAction } {
  let catalog: Record<string, any> = { total: 0, enrolled: 0, pending: 0, speakers: [] };
  try {
    const vpFile = path.resolve(process.cwd(), 'voice_profiles.json');
    if (fs.existsSync(vpFile)) {
      const parsed = JSON.parse(fs.readFileSync(vpFile, 'utf8'));
      const rawProfiles = parsed?.profiles;
      const list: any[] = Array.isArray(rawProfiles)
        ? rawProfiles
        : (rawProfiles && typeof rawProfiles === 'object')
          ? Object.values(rawProfiles)
          : Array.isArray(parsed)
            ? parsed
            : [];

      const speakers = list.map((p: any) => {
        const hasEmb = Array.isArray(p.embedding) && p.embedding.length > 0;
        const sampleCount = p.sample_count || p.samples?.length || 0;
        const isEnrolled = hasEmb || p.status === 'enrolled' || p.enrolled === true || sampleCount > 0;
        return {
          name: p.name || p.speaker_name,
          role: p.role,
          status: isEnrolled ? 'enrolled' : 'pending',
          hasEmbedding: hasEmb,
          sampleCount,
        };
      });

      catalog = {
        total: list.length,
        enrolled: speakers.filter(s => s.status === 'enrolled').length,
        pending: speakers.filter(s => s.status === 'pending').length,
        speakers,
      };
    }
  } catch (err: any) {
    catalog.error = err?.message || 'Failed to read voice_profiles.json';
  }

  const resultData = { voiceProfilesCatalog: catalog };
  return {
    toolResult: resultData,
    action: {
      id: `act_vp_${Date.now()}`,
      action: 'GET_VOICE_PROFILES',
      params: {},
      explanation: `Fetched voice profile registry: ${catalog.enrolled} enrolled / ${catalog.total} total profiles`,
      status: 'completed',
      resultData,
    },
  };
}

async function executeGetTranscriptGapsTool(
  params: { limit?: number },
  ghToken: string,
  owner: string,
  repo: string
): Promise<{ toolResult: Record<string, any>; action: CopilotAction }> {
  const limit = typeof params?.limit === 'number' && params.limit > 0 ? Math.min(params.limit, 50) : 10;
  try {
    const releases = await getReleases(ghToken, owner, repo);
    const gapReport = diffTranscriptGaps(releases as any);
    const sample = gapReport.missingEpisodes.slice(0, limit);

    const resultData = {
      totalReleases: gapReport.totalReleases,
      transcribedCount: gapReport.transcribedCount,
      missingCount: gapReport.missingCount,
      missingSample: sample,
    };

    return {
      toolResult: resultData,
      action: {
        id: `act_gaps_${Date.now()}`,
        action: 'GET_TRANSCRIPT_GAPS',
        params: { limit },
        explanation: `Audited transcript archive: ${gapReport.missingCount} untranscribed episodes identified`,
        status: 'completed',
        resultData,
      },
    };
  } catch (err: any) {
    const resultData = { error: err?.message || 'Failed to audit transcript gaps' };
    return {
      toolResult: resultData,
      action: {
        id: `act_gaps_${Date.now()}_err`,
        action: 'GET_TRANSCRIPT_GAPS',
        params,
        explanation: `Failed to audit transcript gaps: ${err?.message}`,
        status: 'failed',
        errorMessage: err?.message,
        resultData,
      },
    };
  }
}

async function executeDispatchTranscriptBackfillTool(
  params: { limit?: number; tags?: string[] },
  ghToken: string,
  owner: string,
  repo: string
): Promise<{ toolResult: Record<string, any>; action: CopilotAction }> {
  try {
    let tagsToEnqueue = params?.tags || [];
    if (!tagsToEnqueue.length) {
      const releases = await getReleases(ghToken, owner, repo);
      const gapReport = diffTranscriptGaps(releases as any);
      const limit = typeof params?.limit === 'number' && params.limit > 0 ? Math.min(params.limit, 20) : 5;
      tagsToEnqueue = gapReport.missingEpisodes.slice(0, limit).map(e => e.tag);
    }

    const res = enqueueMissingTranscripts(tagsToEnqueue);
    const resultData = {
      enqueuedCount: res.enqueued,
      totalInQueue: res.totalInQueue,
      enqueuedTags: tagsToEnqueue,
    };

    return {
      toolResult: resultData,
      action: {
        id: `act_backfill_${Date.now()}`,
        action: 'DISPATCH_TRANSCRIPT_BACKFILL',
        params: { count: tagsToEnqueue.length, tags: tagsToEnqueue },
        explanation: `Enqueued ${res.enqueued} untranscribed episodes into batch_queue.txt (${res.totalInQueue} total in queue)`,
        status: 'completed',
        resultData,
      },
    };
  } catch (err: any) {
    const resultData = { error: err?.message || 'Failed to enqueue backfill episodes' };
    return {
      toolResult: resultData,
      action: {
        id: `act_backfill_${Date.now()}_err`,
        action: 'DISPATCH_TRANSCRIPT_BACKFILL',
        params,
        explanation: `Failed to enqueue backfill episodes: ${err?.message}`,
        status: 'failed',
        errorMessage: err?.message,
        resultData,
      },
    };
  }
}

async function runCopilot(
  req: CopilotRequestBody,
  gw: Omit<GatewayParams, 'messages' | 'schemaName' | 'schema' | 'temperature'>,
  extra?: { env?: DirectorEnv; githubToken?: string }
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; code: DirectorErrorCode; message: string; retryAfterSec?: number }> {
  const started = Date.now();

  const userMessages = req.messages.filter(m => m.role === 'user');
  const latestUserMsg = userMessages[userMessages.length - 1]?.content || '';
  const searchIntent = detectSearchIntent(latestUserMsg);

  const rawContext = req.context || {};

  if (rawContext.currentEpisode?.releaseTag && rawContext.currentEpisode?.allSegments?.length) {
    registerEpisodeSegments(rawContext.currentEpisode.releaseTag, rawContext.currentEpisode.allSegments);
  }

  let vpCatalog: any = undefined;
  try {
    const vpFile = path.resolve(process.cwd(), 'voice_profiles.json');
    if (fs.existsSync(vpFile)) {
      const parsed = JSON.parse(fs.readFileSync(vpFile, 'utf8'));
      const rawProfiles = parsed?.profiles;
      const list: any[] = Array.isArray(rawProfiles)
        ? rawProfiles
        : (rawProfiles && typeof rawProfiles === 'object')
          ? Object.values(rawProfiles)
          : Array.isArray(parsed)
            ? parsed
            : [];

      const speakers = list.map((p: any) => {
        const hasEmb = Array.isArray(p.embedding) && p.embedding.length > 0;
        const sampleCount = p.sample_count || p.samples?.length || 0;
        const isEnrolled = hasEmb || p.status === 'enrolled' || p.enrolled === true || sampleCount > 0;
        return {
          name: p.name || p.speaker_name,
          role: p.role,
          status: isEnrolled ? 'enrolled' : 'pending',
          hasEmbedding: hasEmb,
          sampleCount,
        };
      });

      vpCatalog = {
        total: list.length,
        enrolled: speakers.filter(s => s.status === 'enrolled').length,
        pending: speakers.filter(s => s.status === 'pending').length,
        speakers,
      };
    }
  } catch {
    // ignore
  }

  const env = extra?.env || {};
  const ghToken = (extra?.githubToken || rawContext.githubToken || '').trim() ||
    (env.GITHUB_TOKEN || env.GH_TOKEN || process.env.GITHUB_TOKEN || '').trim();
  const owner = (rawContext.ownerName || (rawContext.configSummary as any)?.ownerName || (rawContext.configSummary as any)?.githubOwner || env.GITHUB_OWNER || 'aiandbotsgalore').trim();
  const repo = (rawContext.repoName || (rawContext.configSummary as any)?.repoName || (rawContext.configSummary as any)?.githubRepo || env.GITHUB_REPO || 'copy-spaces-to-youtube-pipeline').trim();

  const accumulatedInspectedRuns: Record<number, InspectedRunEvidence> = {
    ...(rawContext.inspectedRuns || {}),
  };

  const enrichedContext: CopilotContextPayload = {
    ...rawContext,
    githubToken: ghToken,
    ownerName: owner,
    repoName: repo,
    inspectedRuns: accumulatedInspectedRuns,
    archiveStats: {
      ...getArchiveStats(),
      ...(vpCatalog ? { voiceProfilesCatalog: vpCatalog } : {}),
    },
  };

  if (searchIntent.isSearchQuery) {
    try {
      const activeEpTag = rawContext.currentEpisode?.releaseTag;
      const searchRes = await handleSearchTranscripts({
        query: searchIntent.query || '',
        scope: searchIntent.episodeTag ? 'active_episode' : (rawContext.activeTab === 'transcripts' && activeEpTag ? 'active_episode' : 'all_transcripts'),
        speaker_hint: searchIntent.speaker,
        episodeTag: searchIntent.episodeTag || activeEpTag,
        timestamp_sec: searchIntent.timestampSec,
        activeSegments: rawContext.currentEpisode?.allSegments,
        maxResults: 12,
        fetchImpl: gw.fetchImpl,
      });
      if (searchRes.matches.length > 0) {
        enrichedContext.transcriptSearchResults = searchRes.matches.map(m => ({
          episodeTitle: m.episode_title,
          releaseTag: m.episode_id,
          audioUrl: m.audio_url,
          speaker: m.speaker,
          startSec: m.start_timestamp,
          endSec: m.end_timestamp,
          text: m.snippet,
          relevanceScore: m.relevance_score,
          matchType: (m.match_type as any) || 'hybrid',
          relevantSpans: m.relevant_spans,
          dialogueWindow: m.dialogue_window,
          chunkId: m.chunk_id,
          sourceType: m.source_type,
          sourceClassification: m.source_classification,
          contentNature: m.content_nature,
          documentLocation: m.document_location,
        }));
      }
    } catch (searchErr) {
      console.warn('[Copilot Director] Transcript auto-search failed:', searchErr);
    }
  }

  const cleanMessages: ChatMessage[] = req.messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => {
      let content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      content = sanitizeCopilotText(content);
      return {
        role: m.role as 'user' | 'assistant',
        content: content || '...',
      };
    })
    .filter(m => m.content.length > 0);

  const systemPrompt = buildCopilotSystemPrompt(enrichedContext);
  const turnMessages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...cleanMessages,
  ];

  let totalUsage: DirectorUsage = { promptTokens: 0, completionTokens: 0 };
  let executedMatches: TranscriptMatch[] = [];
  const executedActions: CopilotAction[] = [];
  let lastModel = req.model || gw.model;
  let lastOutcomeText = '';

  const isActionBlockModel = /claude|mercury/i.test(lastModel);

  if (enrichedContext.transcriptSearchResults?.length) {
    executedMatches = enrichedContext.transcriptSearchResults.map(r => ({
      episode_id: r.releaseTag,
      episode_title: r.episodeTitle,
      start_timestamp: r.startSec,
      end_timestamp: r.endSec,
      formatted_time: r.documentLocation?.displayText || `${Math.floor(r.startSec / 60)}:${Math.floor(r.startSec % 60).toString().padStart(2, '0')}`,
      speaker: r.speaker,
      snippet: r.text,
      audio_url: r.audioUrl,
      relevance_score: r.relevanceScore,
      match_type: r.matchType,
      relevant_spans: r.relevantSpans,
      dialogue_window: (r as any).dialogueWindow,
      chunk_id: r.chunkId,
      source_type: r.sourceType,
      source_classification: r.sourceClassification,
      content_nature: r.contentNature,
      document_location: r.documentLocation,
    }));
  }

  const MAX_TOOL_ROUNDS = 2;
  const MAX_MODEL_CALLS = 3;
  let toolRoundsExecuted = 0;

  for (let modelCall = 0; modelCall < MAX_MODEL_CALLS; modelCall++) {
    const isFinalSynthesisCall = toolRoundsExecuted >= MAX_TOOL_ROUNDS || modelCall === MAX_MODEL_CALLS - 1;
    const activeTools = isFinalSynthesisCall || isActionBlockModel ? undefined : COPILOT_TOOLS;

    const outcome = await callGateway({
      ...gw,
      messages: turnMessages,
      tools: activeTools,
      temperature: 0.4,
    });

    if (outcome.ok === false) return outcome;

    totalUsage = addUsage(totalUsage, outcome.usage);
    lastModel = outcome.model;
    lastOutcomeText = outcome.text || '';

    const hasNativeToolCalls = Array.isArray(outcome.tool_calls) && outcome.tool_calls.length > 0;
    const textExtracted = extractCopilotActions(outcome.text);
    const readOnlyTextActions = textExtracted.actions.filter(a =>
      a.action === 'SEARCH_TRANSCRIPTS' ||
      a.action === 'GET_RUN_HISTORY' ||
      a.action === 'GET_RUN_JOBS' ||
      a.action === 'GET_QUEUE' ||
      a.action === 'GET_VOICE_PROFILES' ||
      a.action === 'GET_TRANSCRIPT_GAPS'
    );

    const wantsToolExecution = (hasNativeToolCalls || readOnlyTextActions.length > 0) && (toolRoundsExecuted < MAX_TOOL_ROUNDS);

    if (wantsToolExecution) {
      if (hasNativeToolCalls && outcome.tool_calls) {
        turnMessages.push({
          role: 'assistant',
          content: outcome.text || null,
          tool_calls: outcome.tool_calls,
        });

        for (const tc of outcome.tool_calls) {
          const fnName = tc.function?.name;
          let parsedArgs: any = {};
          try {
            parsedArgs = JSON.parse(tc.function?.arguments || '{}');
          } catch {
            parsedArgs = {};
          }

          if (fnName === 'search_transcripts') {
            const res = await executeSearchTranscriptsTool(parsedArgs, enrichedContext, searchIntent, gw.fetchImpl);
            executedMatches = res.matches;
            executedActions.push(res.action);
            turnMessages.push({
              role: 'tool',
              tool_call_id: tc.id,
              name: fnName,
              content: JSON.stringify(res.toolResult),
            });
          } else if (fnName === 'get_run_history') {
            const res = await executeGetRunHistoryTool(parsedArgs, ghToken, owner, repo);
            executedActions.push(res.action);
            turnMessages.push({
              role: 'tool',
              tool_call_id: tc.id,
              name: fnName,
              content: JSON.stringify(res.toolResult),
            });
          } else if (fnName === 'get_run_jobs') {
            const res = await executeGetRunJobsTool(parsedArgs, ghToken, owner, repo, accumulatedInspectedRuns);
            executedActions.push(res.action);
            turnMessages.push({
              role: 'tool',
              tool_call_id: tc.id,
              name: fnName,
              content: JSON.stringify(res.toolResult),
            });
          } else if (fnName === 'get_queue') {
            const res = executeGetQueueTool(parsedArgs);
            executedActions.push(res.action);
            turnMessages.push({
              role: 'tool',
              tool_call_id: tc.id,
              name: fnName,
              content: JSON.stringify(res.toolResult),
            });
          } else if (fnName === 'get_voice_profiles') {
            const res = executeGetVoiceProfilesTool();
            executedActions.push(res.action);
            turnMessages.push({
              role: 'tool',
              tool_call_id: tc.id,
              name: fnName,
              content: JSON.stringify(res.toolResult),
            });
          } else if (fnName === 'get_transcript_gaps') {
            const res = await executeGetTranscriptGapsTool(parsedArgs, ghToken, owner, repo);
            executedActions.push(res.action);
            turnMessages.push({
              role: 'tool',
              tool_call_id: tc.id,
              name: fnName,
              content: JSON.stringify(res.toolResult),
            });
          } else if (fnName === 'dispatch_transcript_backfill') {
            const res = await executeDispatchTranscriptBackfillTool(parsedArgs, ghToken, owner, repo);
            executedActions.push(res.action);
            turnMessages.push({
              role: 'tool',
              tool_call_id: tc.id,
              name: fnName,
              content: JSON.stringify(res.toolResult),
            });
          } else {
            turnMessages.push({
              role: 'tool',
              tool_call_id: tc.id,
              name: fnName || 'tool',
              content: JSON.stringify({ ok: true, status: 'unsupported_read_only_tool' }),
            });
          }
        }
      } else if (readOnlyTextActions.length > 0) {
        turnMessages.push({
          role: 'assistant',
          content: outcome.text,
        });

        const observationBlocks: string[] = [];
        for (const act of readOnlyTextActions) {
          if (act.action === 'SEARCH_TRANSCRIPTS') {
            const res = await executeSearchTranscriptsTool(act.params || {}, enrichedContext, searchIntent, gw.fetchImpl);
            executedMatches = res.matches;
            executedActions.push(res.action);
            observationBlocks.push(`[TOOL RESULT: SEARCH_TRANSCRIPTS (${res.matches.length} matches)]:\n${JSON.stringify(res.matches.slice(0, 8), null, 2)}`);
          } else if (act.action === 'GET_RUN_HISTORY') {
            const res = await executeGetRunHistoryTool(act.params || {}, ghToken, owner, repo);
            executedActions.push(res.action);
            observationBlocks.push(`[TOOL RESULT: GET_RUN_HISTORY (${owner}/${repo})]:\n${JSON.stringify(res.toolResult, null, 2)}`);
          } else if (act.action === 'GET_RUN_JOBS') {
            const res = await executeGetRunJobsTool(act.params as any, ghToken, owner, repo, accumulatedInspectedRuns);
            executedActions.push(res.action);
            const inspectedLabel = Array.isArray(act.params?.runIds)
              ? act.params.runIds.map(id => `#${id}`).join(', ')
              : `#${act.params?.runId}`;
            observationBlocks.push(`[TOOL RESULT: GET_RUN_JOBS (${inspectedLabel})]:\n${JSON.stringify(res.toolResult, null, 2)}`);
          } else if (act.action === 'GET_QUEUE') {
            const res = executeGetQueueTool(act.params || {});
            executedActions.push(res.action);
            observationBlocks.push(`[TOOL RESULT: GET_QUEUE]:\n${JSON.stringify(res.toolResult, null, 2)}`);
          } else if (act.action === 'GET_VOICE_PROFILES') {
            const res = executeGetVoiceProfilesTool();
            executedActions.push(res.action);
            observationBlocks.push(`[TOOL RESULT: GET_VOICE_PROFILES (${res.toolResult.voiceProfilesCatalog?.enrolled || 0} enrolled / ${res.toolResult.voiceProfilesCatalog?.total || 0} total)]:\n${JSON.stringify(res.toolResult, null, 2)}`);
          } else if (act.action === 'GET_TRANSCRIPT_GAPS') {
            const res = await executeGetTranscriptGapsTool(act.params || {}, ghToken, owner, repo);
            executedActions.push(res.action);
            observationBlocks.push(`[TOOL RESULT: GET_TRANSCRIPT_GAPS (${res.toolResult.missingCount || 0} untranscribed episodes)]:\n${JSON.stringify(res.toolResult, null, 2)}`);
          }
        }

        turnMessages.push({
          role: 'user',
          content: `[SYSTEM OBSERVATION & LIVE TELEMETRY RESULTS]:\n${observationBlocks.join('\n\n')}\n\n[DIRECTIVE: Use the live telemetry and failure excerpts above to formulate your final comprehensive, evidence-backed diagnosis immediately. Detail the exact failure reasons, step names, and errors for all inspected runs. Do NOT output placeholder waiting messages.]`,
        });
      }

      toolRoundsExecuted++;
      continue;
    }

    // No more tools requested or limit reached: final synthesis
    const finalExtracted = extractCopilotActions(outcome.text);
    const mutationActions = finalExtracted.actions.filter(a =>
      a.action !== 'SEARCH_TRANSCRIPTS' &&
      a.action !== 'GET_RUN_HISTORY' &&
      a.action !== 'GET_RUN_JOBS' &&
      a.action !== 'GET_QUEUE' &&
      a.action !== 'GET_VOICE_PROFILES' &&
      a.action !== 'GET_TRANSCRIPT_GAPS'
    );
    const allActions = [...executedActions, ...mutationActions];

    return {
      ok: true,
      body: {
        ok: true,
        text: finalExtracted.cleanedText || outcome.text,
        actions: allActions,
        matches: executedMatches,
        inspectedRuns: accumulatedInspectedRuns,
        model: lastModel,
        usage: totalUsage,
        ms: Date.now() - started,
      },
    };
  }

  const finalExtracted = extractCopilotActions(lastOutcomeText);
  const mutationActions = finalExtracted.actions.filter(a =>
    a.action !== 'SEARCH_TRANSCRIPTS' &&
    a.action !== 'GET_RUN_HISTORY' &&
    a.action !== 'GET_RUN_JOBS' &&
    a.action !== 'GET_QUEUE' &&
    a.action !== 'GET_VOICE_PROFILES' &&
    a.action !== 'GET_TRANSCRIPT_GAPS'
  );
  return {
    ok: true,
    body: {
      ok: true,
      text: finalExtracted.cleanedText || lastOutcomeText || 'Analysis complete.',
      actions: [...executedActions, ...mutationActions],
      matches: executedMatches,
      inspectedRuns: accumulatedInspectedRuns,
      model: lastModel,
      usage: totalUsage,
      ms: Date.now() - started,
    },
  };
}

export function createDirectorMiddleware(opts: DirectorMiddlewareOptions) {
  const limiter = new Limiter(MAX_CONCURRENT);

  const resolveConfig = (req: IncomingMessage) => {
    const env = opts.getEnv();
    const envKey = (env.INCEPTION_API_KEY || env.DIRECTOR_API_KEY || env.CHEAPER_INFERENCE_API_KEY || '').trim();
    const rawHeader = req.headers['x-director-key'];
    const headerKey = (Array.isArray(rawHeader) ? rawHeader[0] : rawHeader || '').trim();
    const headerOk = headerKey.length >= 8 && !/\s/.test(headerKey);
    const key = envKey || (headerOk ? headerKey : '');
    const baseUrl = ((env.INCEPTION_BASE_URL || env.DIRECTOR_BASE_URL || env.CHEAPER_INFERENCE_BASE_URL || '').trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
    const defaultModel = (env.DIRECTOR_MODEL || '').trim() || DEFAULT_DIRECTOR_MODEL;
    const timeoutMs = Number(env.DIRECTOR_TIMEOUT_MS) > 0 ? Number(env.DIRECTOR_TIMEOUT_MS) : DIRECTOR_TIMEOUT_MS;
    return { env, key, envKey, baseUrl, defaultModel, timeoutMs };
  };

  return async function directorMiddleware(req: IncomingMessage, res: ServerResponse, next?: () => void) {
    const fetchImpl = opts.fetchImpl || globalThis.fetch;
    const path = (req.url || '').split('?')[0].replace(/\/+$/, '') || '/';
    try {
      const cfg = resolveConfig(req);

      if (cfg.env.DIRECTOR_ALLOW_REMOTE !== '1' && !isLoopback(req.socket?.remoteAddress)) {
        return fail(res, 'FORBIDDEN_ORIGIN', 'The Director endpoint only accepts requests from this computer.');
      }

      if (path === '/status' && req.method === 'GET') {
        return send(res, 200, {
          keyConfigured: !!cfg.envKey,
          keySource: cfg.envKey ? 'env' : 'none',
          model: cfg.defaultModel,
          baseUrl: cfg.baseUrl,
        });
      }

      if (path === '/models' && req.method === 'GET') {
        if (cfg.key) {
          const r = await fetchImpl(`${cfg.baseUrl}/models`, { headers: { Authorization: `Bearer ${cfg.key}` } }).catch(() => null);
          if (r && r.ok) {
            const j: any = await r.json().catch(() => ({}));
            const list: any[] = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : [];
            const models = list.map(m => m?.id).filter((id: unknown): id is string => typeof id === 'string' && isValidModelId(id)).sort();
            return send(res, 200, { ok: true, models, default: cfg.defaultModel });
          }
        }
        const models = [
          { id: cfg.defaultModel, family: 'default' },
          { id: FALLBACK_DIRECTOR_MODEL, family: 'fallback' },
        ];
        return send(res, 200, { ok: true, models });
      }

      if (path === '/test' && req.method === 'POST') {
        if (!cfg.key) return fail(res, 'NO_KEY', 'No API key configured.');
        const started = Date.now();
        const ctl = new AbortController();
        const out = await callGateway({
          fetchImpl,
          baseUrl: cfg.baseUrl,
          key: cfg.key,
          model: cfg.defaultModel,
          messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
          schemaName: 'ping',
          schema: { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } } },
          temperature: 0,
          maxTokens: 16,
          timeoutMs: Math.min(cfg.timeoutMs, 30_000),
          clientSignal: ctl.signal,
        });
        if (out.ok === false) return fail(res, out.code, out.message, { retryAfterSec: out.retryAfterSec });
        return send(res, 200, { ok: true, model: out.model, fellBack: out.fellBack, ms: Date.now() - started });
      }

      if (path === '/transcripts/search' && req.method === 'GET') {
        const urlObj = new URL(req.url || '', 'http://localhost:5000');
        const q = urlObj.searchParams.get('q') || '';
        const rawSpeaker = urlObj.searchParams.get('speaker');
        const speaker = (rawSpeaker && rawSpeaker !== 'ALL') ? rawSpeaker : undefined;
        const episodeTag = urlObj.searchParams.get('tag') || urlObj.searchParams.get('episodeTag') || undefined;
        const limit = Number(urlObj.searchParams.get('limit')) || 20;
        const rawMode = urlObj.searchParams.get('mode');
        const mode = (rawMode === 'lexical' || rawMode === 'vector' || rawMode === 'rerank' || rawMode === 'hybrid') ? rawMode : 'hybrid';
        const rawRerankModel = urlObj.searchParams.get('rerankModel') || urlObj.searchParams.get('model');
        const rerankModel = (rawRerankModel === 'rerank-v5.0-fast' || rawRerankModel === 'rerank-v5.0-pro') ? rawRerankModel : undefined;
        const sourceType = urlObj.searchParams.get('sourceType') || undefined;
        const sourceClassification = urlObj.searchParams.get('sourceClassification') || undefined;
        const results = await searchTranscriptArchive(q, {
          speaker,
          episodeTag,
          maxResults: limit,
          mode,
          rerankModel,
          apiKey: cfg.env.COHERE_API_KEY,
          fetchImpl: opts.fetchImpl,
          sourceType,
          sourceClassification,
        });
        return send(res, 200, { ok: true, mode, results, count: results.length });
      }

      if (path === '/transcripts/episodes' && req.method === 'GET') {
        const summaries = loadSummaries();
        return send(res, 200, { ok: true, episodes: summaries, count: summaries.length });
      }

      if (path.startsWith('/transcripts/episode/') && req.method === 'GET') {
        const tag = path.replace('/transcripts/episode/', '').trim();
        const ep = getEpisodeTranscript(tag);
        if (!ep) return fail(res, 'NOT_FOUND', `Episode transcript not found for tag ${tag}`);
        return send(res, 200, { ok: true, episode: ep });
      }

      if (path === '/sort' && req.method === 'POST') {
        const body = await readBody(req);
        if (body.ok === false) {
          return fail(res, 'BAD_REQUEST', body.tooLarge ? 'Request body is too large (limit 1 MB).' : 'Could not read the request body.');
        }
        let raw: unknown;
        try {
          raw = JSON.parse(body.text);
        } catch {
          return fail(res, 'BAD_REQUEST', 'Body is not valid JSON.');
        }
        const parsed = parseSortRequest(raw);
        if (parsed.ok === false) return fail(res, 'BAD_REQUEST', parsed.message);
        if (!cfg.key) return fail(res, 'NO_KEY', 'No API key configured. Add one to .env.local or in Director settings.');

        const clientCtl = new AbortController();
        res.on('close', () => {
          if (!res.writableEnded) clientCtl.abort();
        });
        const result = await limiter.run(() =>
          runSort(parsed.req, {
            fetchImpl,
            baseUrl: cfg.baseUrl,
            key: cfg.key,
            model: parsed.req.model || cfg.defaultModel,
            maxTokens: DIRECTOR_MAX_TOKENS,
            timeoutMs: cfg.timeoutMs,
            clientSignal: clientCtl.signal,
          })
        );
        if (result.ok === false) return fail(res, result.code, scrub(result.message, cfg.key), { retryAfterSec: result.retryAfterSec });
        return send(res, 200, result.body);
      }

      if (path === '/' && req.method === 'POST') {
        const body = await readBody(req);
        if (body.ok === false) {
          return fail(res, 'BAD_REQUEST', body.tooLarge ? 'Request body is too large (limit 1 MB).' : 'Could not read the request body.');
        }
        let raw: unknown;
        try {
          raw = JSON.parse(body.text);
        } catch {
          return fail(res, 'BAD_REQUEST', 'Body is not valid JSON.');
        }
        const parsed = parseRequest(raw);
        if (parsed.ok === false) return fail(res, 'BAD_REQUEST', parsed.message);
        const dreq = parsed.req;
        if (dreq.candidates.length === 0) return fail(res, 'NO_CANDIDATES', 'There are no usable clips to choose from.');
        if (!cfg.key) return fail(res, 'NO_KEY', 'No API key configured. Add one to .env.local or in Director settings.');

        const clientCtl = new AbortController();
        res.on('close', () => {
          if (!res.writableEnded) clientCtl.abort();
        });

        const result = await limiter.run(() =>
          runDirector(dreq, {
            fetchImpl,
            baseUrl: cfg.baseUrl,
            key: cfg.key,
            model: dreq.model || cfg.defaultModel,
            maxTokens: DIRECTOR_MAX_TOKENS,
            timeoutMs: cfg.timeoutMs,
            clientSignal: clientCtl.signal,
          })
        );
        if (result.ok === false) return fail(res, result.code, scrub(result.message, cfg.key), { retryAfterSec: result.retryAfterSec });
        return send(res, 200, result.body);
      }

      if (path === '/copilot' && req.method === 'POST') {
        const body = await readBody(req);
        if (body.ok === false) {
          return fail(res, 'BAD_REQUEST', body.tooLarge ? 'Request body is too large (limit 1 MB).' : 'Could not read the request body.');
        }
        let raw: unknown;
        try {
          raw = JSON.parse(body.text);
        } catch {
          return fail(res, 'BAD_REQUEST', 'Body is not valid JSON.');
        }
        if (!raw || typeof raw !== 'object' || !Array.isArray((raw as any).messages)) {
          return fail(res, 'BAD_REQUEST', 'messages array is required.');
        }
        if (!cfg.key) return fail(res, 'NO_KEY', 'No API key configured. Add one to .env.local or in Director settings.');

        const clientCtl = new AbortController();
        res.on('close', () => {
          if (!res.writableEnded) clientCtl.abort();
        });

        const rawGhHeader = req.headers['x-github-token'];
        const headerGhToken = (Array.isArray(rawGhHeader) ? rawGhHeader[0] : rawGhHeader || '').trim();

        const copilotReq = raw as CopilotRequestBody;
        const result = await limiter.run(() =>
          runCopilot(copilotReq, {
            fetchImpl,
            baseUrl: cfg.baseUrl,
            key: cfg.key,
            model: copilotReq.model || cfg.defaultModel,
            maxTokens: DIRECTOR_MAX_TOKENS,
            timeoutMs: cfg.timeoutMs,
            clientSignal: clientCtl.signal,
          }, { env: cfg.env, githubToken: headerGhToken })
        );
        if (result.ok === false) return fail(res, result.code, scrub(result.message, cfg.key), { retryAfterSec: result.retryAfterSec });
        return send(res, 200, result.body);
      }

      if (next) return next();
      return fail(res, 'BAD_REQUEST', 'Unknown Director route.');
    } catch (err: any) {
      return fail(res, 'UPSTREAM', scrub(`Unexpected server error: ${err?.message || 'unknown'}`, undefined));
    }
  };
}