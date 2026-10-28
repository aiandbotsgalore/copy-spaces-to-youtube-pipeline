/**
 * Script Studio provider adapters (server side only).
 *
 * DEFAULT  claude_cli  Logan's Claude subscription through the official Claude Code CLI (`claude -p`).
 * DEFAULT  codex_cli   Logan's ChatGPT subscription through the Codex CLI (`codex exec -m gpt-6.1-sol`).
 * FALLBACK cheaperinference  Opt-in, behind a per-run dollar cap; only claude-haiku-5.5 and gpt-6-luna,
 *          plus claude-sonnet-5.5 for the single optional polish role.
 *
 * Safety: CLIs run with shell:false in an always-empty sandbox directory, with tools, MCP and slash
 * commands off (Claude) or the default read-only sandbox (Codex). The prompt goes over stdin as a UTF-8
 * buffer. The child environment drops every API key and base-URL override, so each CLI uses its own
 * signed-in subscription and never sees the app's secrets. The app never opens CLI credential files.
 *
 * Windows: Node cannot spawn .cmd/.bat without a shell, so binaries are resolved with where.exe to a
 * native .exe, or an npm .cmd shim is read for its JS entry and run as `node <entry>`. Never shell:true.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseJsonLoose } from '../utils/directorValidate';
import type { Role, RoleMap } from '../utils/scriptTypes';

export type ProviderId = 'cheaperinference' | 'claude_cli' | 'codex_cli' | 'ollama' | 'groq' | 'openai_compatible';
export type Family = 'anthropic' | 'openai' | 'meta' | 'google' | 'mistral' | 'open_source';
export type FailCode = 'NO_KEY' | 'NOT_INSTALLED' | 'NOT_SIGNED_IN' | 'RATE_LIMIT' | 'USAGE_LIMIT'
  | 'BUDGET_EXCEEDED' | 'TIMEOUT' | 'BAD_OUTPUT' | 'UPSTREAM' | 'ABORTED' | 'NOT_ALLOWED';

export interface CompleteRequest {
  role: Role; system: string; user: string;
  schema: Record<string, unknown>; schemaName: string;
  maxTokens: number; timeoutMs: number; signal: AbortSignal;
}
export type CompleteResult =
  | { ok: true; json: unknown; provider: ProviderId; model: string; usage?: { inTok: number; outTok: number; costUsd: number }; durationMs: number }
  | { ok: false; code: FailCode; message: string; rawOutput: string; durationMs: number; provider: ProviderId; model: string; resetHint?: string };

export interface Availability { ok: boolean; detail: string; binPath?: string; code?: FailCode }

export interface ProviderAdapter {
  id: ProviderId;
  family: Family;
  model: string;
  available(): Promise<Availability>;
  complete(req: CompleteRequest): Promise<CompleteResult>;
}

/* ------------------------------------------------------------------------------------------------ */
/* Process runner (injectable for tests)                                                             */
/* ------------------------------------------------------------------------------------------------ */

export interface RunOptions { cwd: string; env: Record<string, string | undefined>; stdin?: Buffer; timeoutMs: number; signal?: AbortSignal }
export interface RunOutcome { code: number | null; stdout: string; stderr: string; timedOut: boolean; aborted: boolean; spawnError?: string; signal?: string }
export type ProcessRunner = (file: string, args: string[], opts: RunOptions) => Promise<RunOutcome>;

export const spawnRunner: ProcessRunner = (file, args, opts) =>
  new Promise(resolve => {
    if (!fs.existsSync(opts.cwd)) {
      resolve({ code: null, stdout: '', stderr: '', timedOut: false, aborted: false, spawnError: `working directory ${opts.cwd} does not exist` });
      return;
    }
    let child;
    try {
      child = spawn(file, args, { cwd: opts.cwd, env: opts.env as NodeJS.ProcessEnv, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e: any) {
      resolve({ code: null, stdout: '', stderr: '', timedOut: false, aborted: false, spawnError: e?.message || String(e) });
      return;
    }
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let timedOut = false;
    let aborted = false;
    let settled = false;
    const finish = (r: RunOutcome) => { if (!settled) { settled = true; clearTimeout(timer); opts.signal?.removeEventListener('abort', onAbort); resolve(r); } };
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, opts.timeoutMs);
    const onAbort = () => { aborted = true; child.kill(); };
    if (opts.signal) { if (opts.signal.aborted) onAbort(); else opts.signal.addEventListener('abort', onAbort, { once: true }); }
    child.stdout.on('data', (c: Buffer) => out.push(c));
    child.stderr.on('data', (c: Buffer) => err.push(c));
    child.on('error', (e: Error) => finish({ code: null, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8'), timedOut, aborted, spawnError: e.message }));
    child.on('close', (code: number | null, sig: NodeJS.Signals | null) => finish({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8'), timedOut, aborted, ...(sig ? { signal: sig } : {}) }));
    child.stdin.on('error', () => {});
    child.stdin.end(opts.stdin ?? Buffer.alloc(0));
  });

/** One line on how a process ended, for status details: never just "exited null". */
export function describeExit(r: RunOutcome, what: string): string {
  const text = (r.stdout + r.stderr).trim().slice(0, 300);
  if (r.spawnError) return `${what} could not be started: ${r.spawnError}.`;
  if (r.timedOut) return `${what} did not finish in time${text ? `: ${text}` : '.'}`;
  if (r.aborted) return `${what} was cancelled.`;
  if (r.code === null) return `${what} was ended by ${r.signal ? `signal ${r.signal}` : 'the system'} without an exit code${text ? `: ${text}` : ' and printed nothing.'}`;
  return `${what} exited ${r.code}${text ? `: ${text}` : ' and printed nothing.'}`;
}

/* ------------------------------------------------------------------------------------------------ */
/* Environment and directories                                                                       */
/* ------------------------------------------------------------------------------------------------ */

export const STRIPPED_ENV_KEYS = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL',
  'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'CODEX_API_KEY',
  'CHEAPER_INFERENCE_API_KEY', 'CHEAPER_INFERENCE_BASE_URL', 'DIRECTOR_API_KEY', 'DIRECTOR_BASE_URL',
  'GEMINI_API_KEY', 'HF_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN',
];

export function subscriptionEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  const strip = new Set(STRIPPED_ENV_KEYS.map(k => k.toUpperCase()));
  for (const [k, v] of Object.entries(env)) if (!strip.has(k.toUpperCase())) out[k] = v;
  out.DISABLE_AUTOUPDATER = '1';
  out.NO_COLOR = '1';
  return out;
}

export function cliDirs(tmp = os.tmpdir()) {
  const sandbox = path.join(tmp, 'spacepipe-cli-sandbox');
  const io = path.join(tmp, 'spacepipe-cli-io');
  return { sandbox, io };
}

/** Status checks run in the sandbox too, so it must exist before any CLI is spawned there. */
export function ensureSandboxDir(dir: string) { fs.mkdirSync(dir, { recursive: true }); }

/** The sandbox must stay empty: it is only the CLI's working directory. */
export function ensureEmptySandbox(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
}

/* ------------------------------------------------------------------------------------------------ */
/* Binary resolution                                                                                 */
/* ------------------------------------------------------------------------------------------------ */

export type ResolvedBinary =
  | { ok: true; file: string; prefixArgs: string[]; via: 'exe' | 'npm-shim' | 'npm-shim-exe' | 'path'; found: string }
  | { ok: false; detail: string };

export interface ResolveDeps {
  platform: NodeJS.Platform;
  runner: ProcessRunner;
  readFile: (p: string) => string;
  exists: (p: string) => boolean;
  nodePath: string;
  env: Record<string, string | undefined>;
}

/**
 * Reads an npm cmd-shim and returns the absolute path of what it runs, or null: a JS entry (run with
 * node), or a native .exe (Claude Code 2.x ships bin/claude.exe and its shim runs it directly).
 */
export function parseCmdShim(shimText: string, shimPath: string): string | null {
  const targets = [...shimText.matchAll(/"%~?dp0%?\\([^"]+?\.(?:js|cjs|mjs|exe))"/gi)].map(m => m[1]);
  // A node-script shim also names "%dp0%\node.exe" (the bundled-node check); that is the interpreter, not the target.
  const pick = targets.find(t => /\.(?:js|cjs|mjs)$/i.test(t)) ?? targets.find(t => !/(^|\\)node\.exe$/i.test(t));
  return pick ? path.win32.join(path.win32.dirname(shimPath), pick) : null;
}

export async function resolveCliBinary(name: 'claude' | 'codex', deps: ResolveDeps): Promise<ResolvedBinary> {
  const lookup = deps.platform === 'win32'
    ? await deps.runner('where.exe', [name], { cwd: os.tmpdir(), env: deps.env, timeoutMs: 10_000 })
    : await deps.runner('which', ['-a', name], { cwd: os.tmpdir(), env: deps.env, timeoutMs: 10_000 });
  const found = lookup.code === 0 ? lookup.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean) : [];
  if (!found.length && deps.platform === 'win32') {
    const appData = deps.env.APPDATA || process.env.APPDATA;
    if (appData) {
      const p = path.win32.join(appData, 'npm', `${name}.cmd`);
      if (deps.exists(p)) found.push(p);
    }
  }
  if (!found.length) return { ok: false, detail: `${name} was not found on PATH.` };
  if (deps.platform !== 'win32') return { ok: true, file: found[0], prefixArgs: [], via: 'path', found: found[0] };
  const exe = found.find(f => /\.exe$/i.test(f));
  if (exe) return { ok: true, file: exe, prefixArgs: [], via: 'exe', found: exe };
  for (const f of found.filter(f => /\.cmd$/i.test(f))) {
    let text = '';
    try { text = deps.readFile(f); } catch { continue; }
    const entry = parseCmdShim(text, f);
    if (!entry || !deps.exists(entry)) continue;
    if (/\.exe$/i.test(entry)) return { ok: true, file: entry, prefixArgs: [], via: 'npm-shim-exe', found: f };
    return { ok: true, file: deps.nodePath, prefixArgs: [entry], via: 'npm-shim', found: f };
  }
  return { ok: false, detail: `${name} found at ${found.join(', ')}, but it is neither a .exe nor an npm .cmd shim that runs an existing JS entry or .exe. It is not run through a shell.` };
}

/* ------------------------------------------------------------------------------------------------ */
/* Failure classification                                                                            */
/* ------------------------------------------------------------------------------------------------ */

function jsonObjects(text: string): any[] {
  const out: any[] = [];
  const whole = text.trim();
  if (whole.startsWith('{')) { try { out.push(JSON.parse(whole)); return out; } catch { /* JSONL */ } }
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try { out.push(JSON.parse(t)); } catch { /* not JSON */ }
  }
  return out;
}

export function resetHint(text: string): string | undefined {
  const m = /(resets?|try again|available again)\s+(at|in|after)\s+([^\n."]{2,60})/i.exec(text);
  return m ? m[0].trim() : undefined;
}

/**
 * Structured signals first (Claude's result envelope / api error status and error category, Codex JSONL
 * error events), then a text match on limit wording as a last resort. The raw output is always kept.
 */
export function classifyCliFailure(o: RunOutcome): { code: FailCode; message: string } {
  if (o.aborted) return { code: 'ABORTED', message: 'Cancelled.' };
  if (o.timedOut) return { code: 'TIMEOUT', message: 'The CLI did not finish in time.' };
  if (o.spawnError) return { code: 'NOT_INSTALLED', message: `Could not start the CLI: ${o.spawnError}` };
  const objs = jsonObjects(o.stdout);
  for (const j of objs) {
    const status = Number(j?.api_error_status ?? j?.error?.status ?? j?.status);
    const cat = String(j?.error?.type ?? j?.error_type ?? j?.error ?? j?.category ?? j?.subtype ?? '').toLowerCase();
    const msg = String(j?.result ?? j?.message ?? j?.error?.message ?? j?.msg?.message ?? '');
    if (status === 429 || /rate_limit/.test(cat)) return { code: 'RATE_LIMIT', message: msg || 'Rate limited.' };
    if (/usage_limit|quota/.test(cat)) return { code: 'USAGE_LIMIT', message: msg || 'Usage limit reached.' };
    if (status === 401 || /auth|login/.test(cat)) return { code: 'NOT_SIGNED_IN', message: msg || 'Not signed in.' };
    if (j?.type === 'error' || j?.type === 'turn.failed' || j?.is_error === true) {
      const termReason = typeof j?.terminal_reason === 'string' && j.terminal_reason !== 'completed' ? `Turn ended: ${j.terminal_reason}` : '';
      const m = msg || termReason || JSON.stringify(j).slice(0, 300);
      return textClassify(m) ?? { code: 'UPSTREAM', message: m };
    }
  }
  const all = `${o.stdout}\n${o.stderr}`;
  return textClassify(all) ?? { code: 'UPSTREAM', message: (o.stderr || o.stdout).trim().slice(-400) || `Exited with code ${o.code}.` };
}

function textClassify(t: string): { code: FailCode; message: string } | null {
  const s = t.toLowerCase();
  const line = t.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]?.slice(0, 300) || t.slice(0, 300);
  if (/usage limit|limit reached|out of (credits|usage)|weekly limit|5-hour limit|quota/.test(s)) return { code: 'USAGE_LIMIT', message: line };
  if (/rate limit|too many requests|429/.test(s)) return { code: 'RATE_LIMIT', message: line };
  if (/not logged in|please (log|sign) in|run .*login|unauthorized|invalid api key|authentication/.test(s)) return { code: 'NOT_SIGNED_IN', message: line };
  return null;
}

/* ------------------------------------------------------------------------------------------------ */
/* Claude Code CLI                                                                                   */
/* ------------------------------------------------------------------------------------------------ */

export interface CliAdapterDeps {
  runner: ProcessRunner;
  resolve: () => Promise<ResolvedBinary>;
  env: () => Record<string, string | undefined>;
  dirs?: { sandbox: string; io: string };
  now?: () => number;
}

function writeIo(io: string, name: string, content: string): string {
  fs.mkdirSync(io, { recursive: true });
  const p = path.join(io, `${randomUUID()}-${name}`);
  fs.writeFileSync(p, content, 'utf8');
  return p;
}
const rmQuiet = (p: string) => { try { fs.rmSync(p, { force: true }); } catch { /* ignore */ } };

/** Claude's --output-format json envelope: the last JSON object on stdout with type "result" (hooks may print before it). */
export function claudeEnvelope(stdout: string): any {
  const objs = jsonObjects(stdout).filter(o => o && typeof o === 'object');
  const res = [...objs].reverse().find(o => o.type === 'result');
  if (res) return res;
  const loose = parseJsonLoose(stdout) as any;
  return loose && typeof loose === 'object' ? loose : null;
}

export function claudeArgs(model: 'sonnet' | 'haiku', schema: object, sysPromptPath: string): string[] {
  return [
    '-p', '--output-format', 'json',
    '--json-schema', JSON.stringify(schema),
    '--model', model,
    '--system-prompt-file', sysPromptPath,
    '--tools', '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--max-turns', '3', '--no-session-persistence',
    '--permission-prompts', 'none',
  ];
}

export function createClaudeCliAdapter(model: 'sonnet' | 'haiku', deps: CliAdapterDeps): ProviderAdapter {
  const dirs = deps.dirs ?? cliDirs();
  const now = deps.now ?? Date.now;
  const fail = (code: FailCode, message: string, rawOutput: string, started: number, extra: Partial<CompleteResult> = {}): CompleteResult =>
    ({ ok: false, code, message, rawOutput, durationMs: now() - started, provider: 'claude_cli', model, ...extra } as CompleteResult);
  return {
    id: 'claude_cli', family: 'anthropic', model,
    async available() {
      const bin = await deps.resolve();
      if (bin.ok === false) return { ok: false, detail: bin.detail, code: 'NOT_INSTALLED' };
      ensureSandboxDir(dirs.sandbox);
      const r = await deps.runner(bin.file, [...bin.prefixArgs, 'auth', 'status'], { cwd: dirs.sandbox, env: subscriptionEnv(deps.env()), timeoutMs: 20_000 });
      if (r.spawnError) return { ok: false, detail: describeExit(r, 'claude auth status'), binPath: bin.found, code: 'NOT_INSTALLED' };
      if (r.code !== 0) return { ok: false, detail: describeExit(r, 'claude auth status'), binPath: bin.found, code: r.timedOut ? 'TIMEOUT' : 'NOT_SIGNED_IN' };
      const parsed = parseJsonLoose(r.stdout) as any;
      const method = parsed?.authMethod ?? /authMethod"?\s*[:=]\s*"?([\w.-]+)/i.exec(r.stdout)?.[1];
      if (method && method !== 'claude.ai') return { ok: false, detail: `Signed in with ${method}, not the claude.ai subscription.`, binPath: bin.found, code: 'NOT_SIGNED_IN' };
      return { ok: true, detail: method ? 'Signed in (claude.ai subscription).' : 'claude auth status exited 0 (auth method not reported).', binPath: bin.found };
    },
    async complete(req) {
      const started = now();
      const bin = await deps.resolve();
      if (bin.ok === false) return fail('NOT_INSTALLED', bin.detail, '', started);
      ensureEmptySandbox(dirs.sandbox);
      const sysPath = writeIo(dirs.io, 'system.txt', req.system);
      try {
        const r = await deps.runner(bin.file, [...bin.prefixArgs, ...claudeArgs(model, req.schema, sysPath)], {
          cwd: dirs.sandbox, env: subscriptionEnv(deps.env()), stdin: Buffer.from(req.user, 'utf8'), timeoutMs: req.timeoutMs, signal: req.signal,
        });
        const raw = `${r.stdout}${r.stderr ? `\n[stderr]\n${r.stderr}` : ''}`;
        const env = claudeEnvelope(r.stdout);
        const structured = env?.structured_output ?? (typeof env?.result === 'string' ? parseJsonLoose(env.result) : null);
        const hasStructured = structured !== undefined && structured !== null && typeof structured === 'object';
        // The result envelope decides, not stderr: a user-level hook (e.g. a SessionEnd hook that needs
        // a missing runtime) can print errors, or even change the exit code, after a successful result.
        const success = !!env && (env.type === undefined || env.type === 'result') && env.is_error !== true && (env.subtype === undefined || env.subtype === 'success');
        if (!r.aborted && (success || hasStructured) && hasStructured) {
          const u = env?.usage || {};
          return {
            ok: true, json: structured, provider: 'claude_cli', model: String(env?.model || model), durationMs: now() - started,
            usage: { inTok: Number(u.input_tokens) || 0, outTok: Number(u.output_tokens) || 0, costUsd: 0 },
          };
        }
        if (r.code === 0 && !r.timedOut && !r.aborted && env && !env.is_error && !hasStructured) return fail('BAD_OUTPUT', 'Claude returned no structured_output (the run may have been declined).', raw, started);
        const c = classifyCliFailure(r);
        return fail(c.code, c.message, raw, started, { resetHint: resetHint(raw) });
      } finally {
        rmQuiet(sysPath);
      }
    },
  };
}

/* ------------------------------------------------------------------------------------------------ */
/* Codex CLI                                                                                         */
/* ------------------------------------------------------------------------------------------------ */

export const CODEX_MODEL = 'gpt-6.1-sol';

export function codexArgs(schemaPath: string, outPath: string, model = CODEX_MODEL): string[] {
  return ['exec', '-', '-m', model, '--output-schema', schemaPath, '-o', outPath, '--json', '--ephemeral', '--skip-git-repo-check', '--ignore-user-config'];
}

export function createCodexCliAdapter(deps: CliAdapterDeps & { readFile?: (p: string) => string }): ProviderAdapter {
  const dirs = deps.dirs ?? cliDirs();
  const now = deps.now ?? Date.now;
  const readFile = deps.readFile ?? ((p: string) => fs.readFileSync(p, 'utf8'));
  const model = CODEX_MODEL;
  const fail = (code: FailCode, message: string, rawOutput: string, started: number, extra: Partial<CompleteResult> = {}): CompleteResult =>
    ({ ok: false, code, message, rawOutput, durationMs: now() - started, provider: 'codex_cli', model, ...extra } as CompleteResult);
  return {
    id: 'codex_cli', family: 'openai', model,
    async available() {
      const bin = await deps.resolve();
      if (bin.ok === false) return { ok: false, detail: bin.detail, code: 'NOT_INSTALLED' };
      ensureSandboxDir(dirs.sandbox);
      const r = await deps.runner(bin.file, [...bin.prefixArgs, 'login', 'status'], { cwd: dirs.sandbox, env: subscriptionEnv(deps.env()), timeoutMs: 20_000 });
      const text = (r.stdout + r.stderr).trim();
      if (r.spawnError) return { ok: false, detail: describeExit(r, 'codex login status'), binPath: bin.found, code: 'NOT_INSTALLED' };
      if (r.code !== 0) return { ok: false, detail: describeExit(r, 'codex login status'), binPath: bin.found, code: r.timedOut ? 'TIMEOUT' : 'NOT_SIGNED_IN' };
      return { ok: true, detail: text.split(/\r?\n/)[0]?.slice(0, 200) || 'Logged in.', binPath: bin.found };
    },
    async complete(req) {
      const started = now();
      const bin = await deps.resolve();
      if (bin.ok === false) return fail('NOT_INSTALLED', bin.detail, '', started);
      ensureEmptySandbox(dirs.sandbox);
      const schemaPath = writeIo(dirs.io, 'schema.json', JSON.stringify(req.schema));
      const outPath = path.join(dirs.io, `${randomUUID()}-out.json`);
      try {
        const prompt = `${req.system}\n\n${req.user}`;
        const r = await deps.runner(bin.file, [...bin.prefixArgs, ...codexArgs(schemaPath, outPath, model)], {
          cwd: dirs.sandbox, env: subscriptionEnv(deps.env()), stdin: Buffer.from(prompt, 'utf8'), timeoutMs: req.timeoutMs, signal: req.signal,
        });
        const raw = `${r.stdout}${r.stderr ? `\n[stderr]\n${r.stderr}` : ''}`;
        let usage: { inTok: number; outTok: number; costUsd: number } | undefined;
        for (const ev of jsonObjects(r.stdout)) {
          const u = ev?.usage ?? ev?.msg?.usage;
          if (u && (ev.type === 'turn.completed' || u.input_tokens != null)) usage = { inTok: Number(u.input_tokens) || 0, outTok: Number(u.output_tokens) || 0, costUsd: 0 };
        }
        if (r.code === 0) {
          let last = '';
          try { last = readFile(outPath); } catch { /* no output file */ }
          const json = parseJsonLoose(last);
          if (json && typeof json === 'object') return { ok: true, json, provider: 'codex_cli', model, usage, durationMs: now() - started };
          return fail('BAD_OUTPUT', 'Codex finished without a JSON final message.', raw + (last ? `\n[last message]\n${last}` : ''), started);
        }
        const c = classifyCliFailure(r);
        return fail(c.code, c.message, raw, started, { resetHint: resetHint(raw) });
      } finally {
        rmQuiet(schemaPath);
        rmQuiet(outPath);
      }
    },
  };
}

/* ------------------------------------------------------------------------------------------------ */
/* CheaperInference fallback                                                                         */
/* ------------------------------------------------------------------------------------------------ */

/** USD per 1M tokens, CheaperInference public catalog, 26 Oct 2026. Used only for the run's dollar cap. */
export const CI_PRICES: Record<string, { in: number; out: number; family: Family }> = {
  'claude-haiku-5.5': { in: 0.065, out: 0.325, family: 'anthropic' },
  'gpt-6-luna': { in: 0.0719, out: 0.3598, family: 'openai' },
  'claude-sonnet-5.5': { in: 1.602, out: 8.011, family: 'anthropic' },
};

export function ciModelAllowed(model: string, role: Role): boolean {
  if (model === 'claude-sonnet-5.5') return role === 'polish';
  return model === 'claude-haiku-5.5' || model === 'gpt-6-luna';
}

export interface Budget { maxUsd: number; spentUsd: number }

export function costUsd(model: string, inTok: number, outTok: number): number {
  const p = CI_PRICES[model];
  if (!p) return 0;
  return (inTok * p.in + outTok * p.out) / 1_000_000;
}

export function createCheaperInferenceAdapter(model: string, deps: { fetchImpl?: typeof fetch; env: () => Record<string, string | undefined>; budget: Budget; now?: () => number }): ProviderAdapter {
  const now = deps.now ?? Date.now;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const family: Family = CI_PRICES[model]?.family ?? (/^gpt|^o\d/i.test(model) ? 'openai' : 'anthropic');
  const cfg = () => {
    const env = deps.env();
    const key = (env.CHEAPER_INFERENCE_API_KEY || env.DIRECTOR_API_KEY || '').trim();
    const baseUrl = ((env.CHEAPER_INFERENCE_BASE_URL || '').trim() || 'https://api.cheaperinference.com/v1').replace(/\/+$/, '');
    return { key, baseUrl };
  };
  const fail = (code: FailCode, message: string, rawOutput: string, started: number): CompleteResult =>
    ({ ok: false, code, message, rawOutput, durationMs: now() - started, provider: 'cheaperinference', model });
  return {
    id: 'cheaperinference', family, model,
    async available() {
      if (!cfg().key) return { ok: false, detail: 'No CHEAPER_INFERENCE_API_KEY in .env.local.', code: 'NO_KEY' };
      if (!CI_PRICES[model]) return { ok: false, detail: `${model} is not an allowed fallback model.`, code: 'NOT_ALLOWED' };
      return { ok: true, detail: `Key configured; ${model}.` };
    },
    async complete(req) {
      const started = now();
      if (!ciModelAllowed(model, req.role)) return fail('NOT_ALLOWED', `${model} is not allowed for the ${req.role} role.`, '', started);
      const { key, baseUrl } = cfg();
      if (!key) return fail('NO_KEY', 'No CHEAPER_INFERENCE_API_KEY configured.', '', started);
      const inEst = Math.ceil((req.system.length + req.user.length) / 4);
      const worst = costUsd(model, inEst, req.maxTokens);
      if (deps.budget.spentUsd + worst > deps.budget.maxUsd + 1e-12) {
        return fail('BUDGET_EXCEEDED', `This call could cost up to $${worst.toFixed(4)}; the run has $${Math.max(0, deps.budget.maxUsd - deps.budget.spentUsd).toFixed(4)} left of its $${deps.budget.maxUsd.toFixed(2)} cap.`, '', started);
      }
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), req.timeoutMs);
      const onAbort = () => ctl.abort();
      req.signal.addEventListener('abort', onAbort, { once: true });
      try {
        const res = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model, temperature: 0.4, max_tokens: req.maxTokens,
            messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }],
            response_format: { type: 'json_schema', json_schema: { name: req.schemaName, strict: true, schema: req.schema } },
          }),
          signal: ctl.signal,
        });
        const text = await res.text();
        const raw = text.split(key).join('[key]').slice(0, 4000);
        if (res.status === 401 || res.status === 403) return fail('NOT_SIGNED_IN', 'The gateway rejected the API key.', raw, started);
        if (res.status === 429) return fail('RATE_LIMIT', 'Rate limited by the gateway.', raw, started);
        if (!res.ok) return fail('UPSTREAM', `Gateway error ${res.status}.`, raw, started);
        const j: any = parseJsonLoose(text);
        const content = j?.choices?.[0]?.message?.content;
        const inTok = Number(j?.usage?.prompt_tokens) || 0;
        const outTok = Number(j?.usage?.completion_tokens) || 0;
        const cost = costUsd(model, inTok, outTok);
        deps.budget.spentUsd += cost;
        const json = typeof content === 'string' ? parseJsonLoose(content) : null;
        if (!json || typeof json !== 'object') return fail('BAD_OUTPUT', 'The model did not return JSON.', raw, started);
        return { ok: true, json, provider: 'cheaperinference', model: String(j?.model || model), usage: { inTok, outTok, costUsd: cost }, durationMs: now() - started };
      } catch (e: any) {
        if (req.signal.aborted) return fail('ABORTED', 'Cancelled.', '', started);
        if (e?.name === 'AbortError') return fail('TIMEOUT', `No answer within ${Math.round(req.timeoutMs / 1000)} s.`, '', started);
        return fail('UPSTREAM', `Could not reach the gateway: ${e?.message || e}`, '', started);
      } finally {
        clearTimeout(timer);
        req.signal.removeEventListener('abort', onAbort);
      }
    },
  };
}

/* ------------------------------------------------------------------------------------------------ */
/* Role maps                                                                                         */
/* ------------------------------------------------------------------------------------------------ */

export const DEFAULT_ROLE_MAP: RoleMap = {
  analyst: 'claude_cli:sonnet', reviser: 'claude_cli:sonnet', critic: 'claude_cli:haiku',
  judge: 'codex_cli', factcheck: 'codex_cli',
};
export const FALLBACK_ROLE_MAP: RoleMap = {
  analyst: 'ci:claude-haiku-5.5', reviser: 'ci:claude-haiku-5.5', critic: 'ci:claude-haiku-5.5',
  judge: 'ci:gpt-6-luna', factcheck: 'ci:gpt-6-luna', polish: 'ci:claude-sonnet-5.5',
};

export type RoleSpec =
  | { provider: 'claude_cli'; model: 'sonnet' | 'haiku' }
  | { provider: 'codex_cli'; model: string }
  | { provider: 'cheaperinference'; model: string }
  | { provider: 'ollama'; model: string }
  | { provider: 'groq'; model: string }
  | { provider: 'openai_compatible'; model: string };

export function parseRoleSpec(spec: string): RoleSpec | null {
  if (spec === 'claude_cli:sonnet' || spec === 'claude_cli:haiku') return { provider: 'claude_cli', model: spec.split(':')[1] as 'sonnet' | 'haiku' };
  if (spec === 'codex_cli') return { provider: 'codex_cli', model: CODEX_MODEL };
  const ciMatch = /^ci:(.+)$/.exec(spec);
  if (ciMatch && CI_PRICES[ciMatch[1]]) return { provider: 'cheaperinference', model: ciMatch[1] };
  const ollamaMatch = /^ollama:(.+)$/.exec(spec);
  if (ollamaMatch) return { provider: 'ollama', model: ollamaMatch[1] };
  const groqMatch = /^groq:(.+)$/.exec(spec);
  if (groqMatch) return { provider: 'groq', model: groqMatch[1] };
  const compatMatch = /^openai_compatible:(.+)$/.exec(spec);
  if (compatMatch) return { provider: 'openai_compatible', model: compatMatch[1] };
  return null;
}

export function familyOf(spec: string): Family | null {
  const p = parseRoleSpec(spec);
  if (!p) return null;
  if (p.provider === 'claude_cli') return 'anthropic';
  if (p.provider === 'codex_cli') return 'openai';
  if (p.provider === 'ollama' || p.provider === 'groq' || p.provider === 'openai_compatible') return 'open_source';
  return CI_PRICES[p.model]?.family ?? 'open_source';
}

/** Refuses a role map whose judge or fact check is in the reviser's model family. */
export function verifyCrossFamily(roleMap: RoleMap): { ok: true } | { ok: false; reason: string } {
  for (const r of ['analyst', 'critic', 'reviser', 'judge', 'factcheck'] as const) {
    if (!parseRoleSpec(roleMap[r])) return { ok: false, reason: `Role ${r} has an unknown provider "${roleMap[r]}".` };
  }
  if (roleMap.polish && !parseRoleSpec(roleMap.polish)) return { ok: false, reason: `Role polish has an unknown provider "${roleMap.polish}".` };
  const writer = familyOf(roleMap.reviser);
  for (const r of ['judge', 'factcheck'] as const) {
    if (familyOf(roleMap[r]) === writer) return { ok: false, reason: `The ${r} (${roleMap[r]}) is in the same model family as the reviser (${roleMap.reviser}).` };
  }
  return { ok: true };
}

export function roleMapNeedsBudget(roleMap: RoleMap): boolean {
  return Object.values(roleMap).some(v => typeof v === 'string' && v.startsWith('ci:'));
}

/* ------------------------------------------------------------------------------------------------ */
/* Registry                                                                                          */
/* ------------------------------------------------------------------------------------------------ */

export interface RegistryDeps {
  runner?: ProcessRunner;
  env: () => Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  fetchImpl?: typeof fetch;
  dirs?: { sandbox: string; io: string };
  resolveOverride?: (name: 'claude' | 'codex') => Promise<ResolvedBinary>;
}

export function createProviderRegistry(deps: RegistryDeps) {
  const runner = deps.runner ?? spawnRunner;
  const cache = new Map<string, Promise<ResolvedBinary>>();
  const resolve = (name: 'claude' | 'codex') => {
    if (deps.resolveOverride) return deps.resolveOverride(name);
    if (!cache.has(name)) {
      const p = resolveCliBinary(name, {
        platform: deps.platform ?? process.platform, runner, env: deps.env(),
        readFile: f => fs.readFileSync(f, 'utf8'), exists: f => fs.existsSync(f), nodePath: process.execPath,
      });
      cache.set(name, p);
      p.then(r => { if (!r.ok) cache.delete(name); });
    }
    return cache.get(name)!;
  };
  const cli = { runner, env: deps.env, dirs: deps.dirs };
  return {
    adapterFor(spec: string, budget: Budget): ProviderAdapter | null {
      const p = parseRoleSpec(spec);
      if (!p) return null;
      if (p.provider === 'claude_cli') return createClaudeCliAdapter(p.model, { ...cli, resolve: () => resolve('claude') });
      if (p.provider === 'codex_cli') return createCodexCliAdapter({ ...cli, resolve: () => resolve('codex') });
      return createCheaperInferenceAdapter(p.model, { env: deps.env, budget, fetchImpl: deps.fetchImpl });
    },
    async health() {
      const noBudget = { maxUsd: 0, spentUsd: 0 };
      const specs = ['claude_cli:sonnet', 'claude_cli:haiku', 'codex_cli', 'ci:claude-haiku-5.5', 'ci:gpt-6-luna'];
      const out: Record<string, Availability & { provider: ProviderId; model: string }> = {};
      for (const s of specs) {
        const a = this.adapterFor(s, noBudget)!;
        try { out[s] = { ...(await a.available()), provider: a.id, model: a.model }; }
        catch (e: any) { out[s] = { ok: false, detail: e?.message || String(e), provider: a.id, model: a.model }; }
      }
      return out;
    },
    clearCache() { cache.clear(); },
  };
}
export type ProviderRegistry = ReturnType<typeof createProviderRegistry>;
