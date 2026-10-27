/**
 * Server side of the AI Prompt Director (runs inside the Vite dev/preview server, never in the browser).
 *
 *   GET  /api/montage/direct/status   key/model status (never returns the key)
 *   GET  /api/montage/direct/models   every model id the gateway lists (any family)
 *   POST /api/montage/direct/test     tiny completion to test the connection
 *   POST /api/montage/direct          generate one cut / refine the current timeline
 *   POST /api/montage/direct/sort     AI Sort: order the reel's clips (permutation only)
 *
 * Secrets: the key comes from .env.local (CHEAPER_INFERENCE_API_KEY) or, as a backup, the
 * x-director-key header sent by the in-app Settings. It is never logged, echoed or placed in errors.
 * The gateway base URL is read from the environment ONLY (never from a request) so a request cannot
 * redirect the key to another host.
 */
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
import type { CopilotRequestBody } from '../utils/copilotTypes';
import { buildCopilotSystemPrompt, extractCopilotActions } from './copilotPrompt';
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
  /** Called per request so edits to .env.local apply without restarting the dev server. */
  getEnv: () => DirectorEnv;
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URL = 'https://api.cheaperinference.com/v1';
const BODY_LIMIT = 1_000_000;
const MAX_CONCURRENT = 3;

/**
 * A gateway model id from any family (claude-*, gpt-*, gemini-*, ...). Only the character set is checked,
 * so a request cannot smuggle whitespace or control characters into the upstream body; whether the id
 * exists is the gateway's answer (a missing model returns MODEL_NOT_FOUND after the documented fallback).
 */
export function isValidModelId(id: string): boolean {
  return /^[a-z0-9][a-z0-9._:\/-]{0,99}$/i.test(id);
}

/* ---------------------------------------------------------------------------------------------- */
/* Small utilities                                                                                 */
/* ---------------------------------------------------------------------------------------------- */

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

/** Remove anything that looks like a key (and the exact key) from text that may reach a client or a log. */
export function scrub(text: string, key?: string): string {
  let t = String(text ?? '');
  if (key) t = t.split(key).join('[redacted]');
  return t.replace(/ci_live_[A-Za-z0-9]+/g, '[redacted]').replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]');
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

/* ---------------------------------------------------------------------------------------------- */
/* Gateway                                                                                         */
/* ---------------------------------------------------------------------------------------------- */

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

// Remembered for the lifetime of the process once the gateway rejects structured output.
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

/* ---------------------------------------------------------------------------------------------- */
/* Request validation                                                                              */
/* ---------------------------------------------------------------------------------------------- */

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

/* ---------------------------------------------------------------------------------------------- */
/* Orchestration: generate / refine with one repair pass                                           */
/* ---------------------------------------------------------------------------------------------- */

function buildMessages(req: DirectorRequest, target: number): ChatMessage[] {
  const system = buildSystemPrompt(req.cutId, req.mode);
  // "candidates" first and identical across the three parallel calls (prefix-cache friendly).
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

/* ---------------------------------------------------------------------------------------------- */
/* AI Sort                                                                                         */
/* ---------------------------------------------------------------------------------------------- */

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
          query: {
            type: 'string',
            description: 'Clean search string. Strip stutters, em dashes, and false starts.',
          },
          scope: {
            type: 'string',
            enum: ['active_episode', 'all_transcripts'],
            description: "Use 'all_transcripts' if looking across past spaces/archive.",
          },
          speaker_hint: {
            type: 'string',
            description: 'Optional speaker name if specified.',
          },
          timestamp_sec: {
            type: 'number',
            description: 'Optional timestamp in seconds (e.g. 2862 for 47:42) to find dialogue around that moment.',
          },
        },
        required: ['query', 'scope'],
      },
    },
  },
];

async function runCopilot(
  req: CopilotRequestBody,
  gw: Omit<GatewayParams, 'messages' | 'schemaName' | 'schema' | 'temperature'>
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; code: DirectorErrorCode; message: string; retryAfterSec?: number }> {
  const started = Date.now();

  const userMessages = req.messages.filter(m => m.role === 'user');
  const latestUserMsg = userMessages[userMessages.length - 1]?.content || '';
  const searchIntent = detectSearchIntent(latestUserMsg);

  const rawContext = req.context || {};

  // Register active episode segments if provided
  if (rawContext.currentEpisode?.releaseTag && rawContext.currentEpisode?.allSegments?.length) {
    registerEpisodeSegments(rawContext.currentEpisode.releaseTag, rawContext.currentEpisode.allSegments);
  }

  const enrichedContext = {
    ...rawContext,
    archiveStats: getArchiveStats(),
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
        }));
      }
    } catch (searchErr) {
      console.warn('[Copilot Director] Transcript auto-search failed:', searchErr);
    }
  }

  // Sanitize historical messages to pure user/assistant text to prevent poisoned turns
  const cleanMessages: ChatMessage[] = req.messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => {
      let content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      content = content.replace(/```(?:action|json:action)[\s\S]*?```/gi, '').trim();
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
  let searchActionExecuted: any = null;
  let lastModel = req.model || gw.model;

  // CheaperInference's OpenAI-to-Anthropic proxy fails when translating OpenAI tool_calls
  // back to Anthropic tool_result, causing 400 "tool_use ids were found without tool_result blocks immediately after".
  // For CheaperInference or Claude models on OpenAI proxies, we omit body.tools so Claude outputs
  // the clean structured action block format that our server-side loop intercepts and executes safely.
  const isCheaperInference = gw.baseUrl.includes('cheaperinference.com') || /claude/i.test(lastModel);
  const toolsToPass = isCheaperInference ? undefined : COPILOT_TOOLS;

  if (enrichedContext.transcriptSearchResults?.length) {
    executedMatches = enrichedContext.transcriptSearchResults.map(r => ({
      episode_id: r.releaseTag,
      episode_title: r.episodeTitle,
      start_timestamp: r.startSec,
      end_timestamp: r.endSec,
      formatted_time: `${Math.floor(r.startSec / 60)}:${Math.floor(r.startSec % 60).toString().padStart(2, '0')}`,
      speaker: r.speaker,
      snippet: r.text,
      audio_url: r.audioUrl,
    }));
  }

  const MAX_TOOL_TURNS = 3;
  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const outcome = await callGateway({
      ...gw,
      messages: turnMessages,
      tools: toolsToPass,
      temperature: 0.4,
    });

    if (outcome.ok === false) return outcome;

    totalUsage = addUsage(totalUsage, outcome.usage);
    lastModel = outcome.model;

    // Check for tool calls: either native tool_calls OR text-based action block
    const nativeToolCall = outcome.tool_calls?.find(t => t.function?.name === 'search_transcripts');
    const textActions = extractCopilotActions(outcome.text);
    const textSearchAction = textActions.actions.find(a => a.action === 'SEARCH_TRANSCRIPTS');

    if (nativeToolCall || textSearchAction) {
      let query = '';
      let scope: 'active_episode' | 'all_transcripts' = 'all_transcripts';
      let speakerHint: string | undefined;
      let timestampSec: number | undefined;

      if (nativeToolCall) {
        try {
          const parsed = JSON.parse(nativeToolCall.function.arguments || '{}');
          query = parsed.query || '';
          scope = parsed.scope === 'active_episode' ? 'active_episode' : 'all_transcripts';
          speakerHint = parsed.speaker_hint || parsed.speaker;
          timestampSec = parsed.timestamp_sec ?? parsed.timestampSec ?? searchIntent.timestampSec;
        } catch {
          query = '';
        }
      } else if (textSearchAction) {
        query = textSearchAction.params?.query || '';
        scope = textSearchAction.params?.scope === 'active_episode' ? 'active_episode' : 'all_transcripts';
        speakerHint = textSearchAction.params?.speaker_hint || textSearchAction.params?.speaker;
        timestampSec = textSearchAction.params?.timestamp_sec ?? textSearchAction.params?.timestampSec ?? searchIntent.timestampSec;
      }

      if (!query && searchIntent.query) {
        query = searchIntent.query;
      }
      if (timestampSec === undefined && searchIntent.timestampSec !== undefined) {
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
      });

      executedMatches = searchRes.matches;
      searchActionExecuted = {
        id: `act_search_${Date.now()}`,
        action: 'SEARCH_TRANSCRIPTS',
        params: { query: searchRes.queryUsed, scope: searchRes.scopeUsed, speaker_hint: searchRes.speakerFilterApplied, timestamp_sec: timestampSec },
        explanation: `Searched transcripts for "${searchRes.queryUsed || 'timestamp ' + (timestampSec ? formatTimestamp(timestampSec) : '')}" across ${searchRes.scopeUsed === 'active_episode' ? 'active episode' : 'all transcripts'}`,
        status: searchRes.matches.length > 0 ? 'completed' : 'no_matches',
        matchCount: searchRes.matches.length,
      };

      if (nativeToolCall) {
        turnMessages.push({
          role: 'assistant',
          content: outcome.text || null,
          tool_calls: outcome.tool_calls,
        });
        turnMessages.push({
          role: 'tool',
          tool_call_id: nativeToolCall.id,
          name: 'search_transcripts',
          content: JSON.stringify({
            total_matches: searchRes.totalMatches,
            query_used: searchRes.queryUsed,
            scope_used: searchRes.scopeUsed,
            matches: searchRes.matches,
          }),
        });
      } else {
        turnMessages.push({
          role: 'assistant',
          content: outcome.text,
        });
        turnMessages.push({
          role: 'user',
          content: searchRes.matches.length > 0
            ? `[Tool Result: search_transcripts]\nThe search returned ${searchRes.matches.length} matching dialogue turns (Tier ${searchRes.tier}):\n${JSON.stringify(searchRes.matches, null, 2)}\n\nAnswer the user from these turns only, quoting the speaker, episode title, and timestamp (e.g. [${searchRes.matches[0]?.formatted_time}]). Do NOT repeat the search_transcripts tool call.`
            : `[Tool Result: search_transcripts]\nThe search for "${searchRes.queryUsed}" returned no matching turns. Tell the user plainly that nothing matched; do not guess or invent quotes. Do NOT repeat the search_transcripts tool call.`,
        });
      }

      // Re-invoke model so it synthesizes response with real results!
      continue;
    }

    // Final response (no tool calls):
    const finalExtracted = extractCopilotActions(outcome.text);
    // Filter out SEARCH_TRANSCRIPTS from actions to prevent frontend auto-applying
    const mutationActions = finalExtracted.actions.filter(a => a.action !== 'SEARCH_TRANSCRIPTS');
    const allActions = searchActionExecuted
      ? [searchActionExecuted, ...mutationActions]
      : mutationActions;

    return {
      ok: true,
      body: {
        ok: true,
        text: finalExtracted.cleanedText,
        actions: allActions,
        matches: executedMatches,
        model: lastModel,
        usage: totalUsage,
        ms: Date.now() - started,
      },
    };
  }

  // Fallback if max tool turns exceeded
  return {
    ok: true,
    body: {
      ok: true,
      text: 'Transcript search complete. Matches are displayed below.',
      actions: searchActionExecuted ? [searchActionExecuted] : [],
      matches: executedMatches,
      model: lastModel,
      usage: totalUsage,
      ms: Date.now() - started,
    },
  };
}

/* ---------------------------------------------------------------------------------------------- */
/* The middleware                                                                                  */
/* ---------------------------------------------------------------------------------------------- */

export function createDirectorMiddleware(opts: DirectorMiddlewareOptions) {
  const limiter = new Limiter(MAX_CONCURRENT);

  const resolveConfig = (req: IncomingMessage) => {
    const env = opts.getEnv();
    const envKey = (env.DIRECTOR_API_KEY || env.CHEAPER_INFERENCE_API_KEY || '').trim();
    const rawHeader = req.headers['x-director-key'];
    const headerKey = (Array.isArray(rawHeader) ? rawHeader[0] : rawHeader || '').trim();
    const headerOk = headerKey.length >= 8 && !/\s/.test(headerKey);
    const key = envKey || (headerOk ? headerKey : '');
    const baseUrl = ((env.DIRECTOR_BASE_URL || env.CHEAPER_INFERENCE_BASE_URL || '').trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
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
        if (!cfg.key) return fail(res, 'NO_KEY', 'No API key configured.');
        const r = await fetchImpl(`${cfg.baseUrl}/models`, { headers: { Authorization: `Bearer ${cfg.key}` } }).catch(() => null);
        if (!r) return fail(res, 'UPSTREAM', 'Could not reach the gateway.');
        if (r.status === 401 || r.status === 403) return fail(res, 'UNAUTHORIZED', 'The gateway rejected the API key.');
        if (!r.ok) return fail(res, 'UPSTREAM', `Gateway error ${r.status}.`);
        const j: any = await r.json().catch(() => ({}));
        const list: any[] = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : [];
        const models = list.map(m => m?.id).filter((id: unknown): id is string => typeof id === 'string' && isValidModelId(id)).sort();
        return send(res, 200, { models, default: cfg.defaultModel });
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

      if (path === '/transcripts/search' && req.method === 'GET') {
        const urlObj = new URL(req.url || '', 'http://localhost:5000');
        const q = urlObj.searchParams.get('q') || '';
        const speaker = urlObj.searchParams.get('speaker') || undefined;
        const episodeTag = urlObj.searchParams.get('tag') || urlObj.searchParams.get('episodeTag') || undefined;
        const limit = Number(urlObj.searchParams.get('limit')) || 20;
        const rawMode = urlObj.searchParams.get('mode');
        const mode = (rawMode === 'lexical' || rawMode === 'vector' || rawMode === 'hybrid') ? rawMode : 'hybrid';
        const results = await searchTranscriptArchive(q, { speaker, episodeTag, maxResults: limit, mode });
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

      if (next) return next();
      return fail(res, 'BAD_REQUEST', 'Unknown Director route.');
    } catch (err: any) {
      return fail(res, 'UPSTREAM', scrub(`Unexpected server error: ${err?.message || 'unknown'}`, undefined));
    }
  };
}
