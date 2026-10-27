import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  classifyCliFailure, claudeArgs, codexArgs, CODEX_MODEL, createCheaperInferenceAdapter, createClaudeCliAdapter, createCodexCliAdapter,
  ensureEmptySandbox, parseCmdShim, resolveCliBinary, subscriptionEnv, verifyCrossFamily, parseRoleSpec, DEFAULT_ROLE_MAP, FALLBACK_ROLE_MAP,
  type ProcessRunner, type RunOutcome,
} from '../../server/scriptProviders';
import { makeFakeCli, type CliCall } from './helpers/fakeCli';

const out = (o: Partial<RunOutcome>): RunOutcome => ({ code: 0, stdout: '', stderr: '', timedOut: false, aborted: false, ...o });
const tmpDirs = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-prov-')); return { sandbox: path.join(d, 'sandbox'), io: path.join(d, 'io') }; };
const req = (o: Partial<Parameters<ReturnType<typeof createClaudeCliAdapter>['complete']>[0]> = {}) => ({
  role: 'judge' as const, system: 'System rules', user: 'Bewertung: “café” — naïve 漢字', schema: { type: 'object', properties: { winner: { type: 'string' }, reasons: { type: 'array' } } },
  schemaName: 'x', maxTokens: 100, timeoutMs: 1000, signal: new AbortController().signal, ...o,
});

describe('Windows binary resolution (never through a shell)', () => {
  const shim = `@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n`;
  it('parses the JS entry from an npm cmd-shim', () => {
    expect(parseCmdShim(shim, 'C:\\Users\\L\\AppData\\Roaming\\npm\\claude.cmd')).toBe('C:\\Users\\L\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js');
    expect(parseCmdShim('@echo hello', 'C:\\x.cmd')).toBeNull();
  });
  const runnerFor = (stdout: string): ProcessRunner => async (file, args) => {
    expect(file).toBe('where.exe');
    expect(args).toEqual(['claude']);
    return out({ stdout });
  };
  it('prefers a native .exe', async () => {
    const r = await resolveCliBinary('claude', { platform: 'win32', runner: runnerFor('C:\\npm\\claude.cmd\r\nC:\\Users\\L\\.local\\bin\\claude.exe\r\n'), readFile: () => shim, exists: () => true, nodePath: 'C:\\node\\node.exe', env: {} });
    expect(r).toMatchObject({ ok: true, file: 'C:\\Users\\L\\.local\\bin\\claude.exe', prefixArgs: [], via: 'exe' });
  });
  it('runs an npm shim as node + JS entry', async () => {
    const r = await resolveCliBinary('claude', { platform: 'win32', runner: runnerFor('C:\\npm\\claude\r\nC:\\npm\\claude.cmd\r\n'), readFile: () => shim, exists: () => true, nodePath: 'C:\\node\\node.exe', env: {} });
    expect(r).toMatchObject({ ok: true, file: 'C:\\node\\node.exe', prefixArgs: ['C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js'], via: 'npm-shim' });
  });
  it('refuses a .cmd it cannot map to a JS entry, and reports a missing binary', async () => {
    const bad = await resolveCliBinary('claude', { platform: 'win32', runner: runnerFor('C:\\x\\claude.cmd'), readFile: () => '@echo off', exists: () => true, nodePath: 'node', env: {} });
    expect(bad.ok).toBe(false);
    const none = await resolveCliBinary('codex', { platform: 'linux', runner: async () => out({ code: 1 }), readFile: () => '', exists: () => false, nodePath: 'node', env: {} });
    expect(none).toEqual({ ok: false, detail: 'codex was not found on PATH.' });
  });
});

describe('subscription env', () => {
  it('strips API keys and base URLs so the CLIs use the signed-in subscription', () => {
    const env = subscriptionEnv({ PATH: '/bin', ANTHROPIC_API_KEY: 'a', openai_api_key: 'b', CHEAPER_INFERENCE_API_KEY: 'c', GH_TOKEN: 'd', ANTHROPIC_BASE_URL: 'e', HOME: '/h' });
    expect(env).toEqual({ PATH: '/bin', HOME: '/h', DISABLE_AUTOUPDATER: '1', NO_COLOR: '1' });
  });
  it('empties the sandbox', () => {
    const d = tmpDirs();
    fs.mkdirSync(d.sandbox, { recursive: true });
    fs.writeFileSync(path.join(d.sandbox, 'leftover.txt'), 'x');
    ensureEmptySandbox(d.sandbox);
    expect(fs.readdirSync(d.sandbox)).toEqual([]);
  });
});

describe('Claude Code adapter', () => {
  it('builds the pinned argv', () => {
    const a = claudeArgs('sonnet', { type: 'object' }, '/tmp/s.txt');
    expect(a.slice(0, 3)).toEqual(['-p', '--output-format', 'json']);
    expect(a).toContain('--strict-mcp-config');
    expect(a[a.indexOf('--tools') + 1]).toBe('');
    expect(a[a.indexOf('--max-turns') + 1]).toBe('1');
    expect(a).not.toContain('--bare');
  });
  it('sends UTF-8 stdin from an empty sandbox with a stripped env, and returns structured_output', async () => {
    const calls: CliCall[] = [];
    const runner = makeFakeCli(() => ({ winner: 'A', reasons: ['tighter'] }), calls);
    const ad = createClaudeCliAdapter('haiku', { runner, dirs: tmpDirs(), env: () => ({ ANTHROPIC_API_KEY: 'secret', PATH: '/bin' }), resolve: async () => ({ ok: true, file: '/usr/bin/claude', prefixArgs: [], via: 'path', found: '/usr/bin/claude' }) });
    const r = await ad.complete(req());
    expect(r).toMatchObject({ ok: true, json: { winner: 'A' }, provider: 'claude_cli' });
    const c = calls[0];
    expect(c.stdin).toBe('Bewertung: “café” — naïve 漢字');
    expect(c.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(fs.readdirSync(c.cwd)).toEqual([]);
    expect(c.args[c.args.indexOf('--model') + 1]).toBe('haiku');
  });
  it('treats exit 0 without structured_output as BAD_OUTPUT, and classifies limits from the envelope', async () => {
    const dirs = tmpDirs();
    const resolve = async () => ({ ok: true as const, file: 'claude', prefixArgs: [], via: 'path' as const, found: 'claude' });
    const noOut = createClaudeCliAdapter('sonnet', { dirs, env: () => ({}), resolve, runner: async () => out({ stdout: JSON.stringify({ type: 'result', is_error: false, result: 'I cannot.' }) }) });
    expect(await noOut.complete(req())).toMatchObject({ ok: false, code: 'BAD_OUTPUT' });
    const limited = createClaudeCliAdapter('sonnet', { dirs, env: () => ({}), resolve, runner: async () => out({ code: 1, stdout: JSON.stringify({ type: 'result', is_error: true, result: 'Claude usage limit reached. Your limit resets at 3pm.' }) }) });
    const r = await limited.complete(req());
    expect(r).toMatchObject({ ok: false, code: 'USAGE_LIMIT' });
    if (!r.ok) { expect(r.resetHint).toMatch(/resets at 3pm/); expect(r.rawOutput).toContain('usage limit'); }
  });
  it('health check requires the claude.ai subscription', async () => {
    const resolve = async () => ({ ok: true as const, file: 'claude', prefixArgs: [], via: 'path' as const, found: '/b/claude' });
    const api = createClaudeCliAdapter('sonnet', { dirs: tmpDirs(), env: () => ({}), resolve, runner: async () => out({ stdout: JSON.stringify({ loggedIn: true, authMethod: 'api_key' }) }) });
    expect(await api.available()).toMatchObject({ ok: false, code: 'NOT_SIGNED_IN' });
    const sub = createClaudeCliAdapter('sonnet', { dirs: tmpDirs(), env: () => ({}), resolve, runner: async () => out({ stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }) }) });
    expect(await sub.available()).toMatchObject({ ok: true });
  });
});

describe('Codex adapter', () => {
  it('pins the model and reads the final message file', async () => {
    expect(codexArgs('/s', '/o')).toEqual(['exec', '-', '-m', CODEX_MODEL, '--output-schema', '/s', '-o', '/o', '--json', '--ephemeral', '--skip-git-repo-check', '--ignore-user-config']);
    const calls: CliCall[] = [];
    const ad = createCodexCliAdapter({ runner: makeFakeCli(() => ({ winner: 'tie', reasons: [] }), calls), dirs: tmpDirs(), env: () => ({ OPENAI_API_KEY: 'k' }), resolve: async () => ({ ok: true, file: '/usr/bin/codex', prefixArgs: [], via: 'path', found: '/usr/bin/codex' }) });
    const r = await ad.complete(req());
    expect(r).toMatchObject({ ok: true, json: { winner: 'tie' }, model: 'gpt-6.1-sol', usage: { inTok: 80, outTok: 20 } });
    expect(calls[0].env.OPENAI_API_KEY).toBeUndefined();
    expect(calls[0].stdin).toContain('System rules');
  });
  it('classifies JSONL error events', () => {
    const s = [JSON.stringify({ type: 'thread.started' }), JSON.stringify({ type: 'error', message: "You've hit your usage limit. Try again at 4:12 PM." })].join('\n');
    expect(classifyCliFailure(out({ code: 1, stdout: s }))).toMatchObject({ code: 'USAGE_LIMIT' });
    expect(classifyCliFailure(out({ code: 1, stderr: 'Error: Not logged in. Run codex login' }))).toMatchObject({ code: 'NOT_SIGNED_IN' });
    expect(classifyCliFailure(out({ code: null, timedOut: true }))).toMatchObject({ code: 'TIMEOUT' });
  });
});

describe('CheaperInference fallback', () => {
  it('refuses calls over the dollar cap without sending anything', async () => {
    let sent = 0;
    const fetchImpl = (async () => { sent++; return new Response('{}'); }) as typeof fetch;
    const ad = createCheaperInferenceAdapter('claude-haiku-5.5', { fetchImpl, env: () => ({ CHEAPER_INFERENCE_API_KEY: 'k' }), budget: { maxUsd: 0, spentUsd: 0 } });
    expect(await ad.complete(req({ role: 'critic' }))).toMatchObject({ ok: false, code: 'BUDGET_EXCEEDED' });
    expect(sent).toBe(0);
  });
  it('sends a strict json_schema request, charges the budget, and refuses sonnet outside polish', async () => {
    const bodies: any[] = [];
    const fetchImpl = (async (_u: any, init: any) => { bodies.push(JSON.parse(init.body)); return new Response(JSON.stringify({ model: 'claude-haiku-5.5', choices: [{ message: { content: '{"winner":"B","reasons":[]}' } }], usage: { prompt_tokens: 1000, completion_tokens: 100 } }), { status: 200 }); }) as typeof fetch;
    const budget = { maxUsd: 1, spentUsd: 0 };
    const ad = createCheaperInferenceAdapter('claude-haiku-5.5', { fetchImpl, env: () => ({ CHEAPER_INFERENCE_API_KEY: 'k' }), budget });
    const r = await ad.complete(req({ role: 'critic' }));
    expect(r).toMatchObject({ ok: true, json: { winner: 'B' } });
    expect(bodies[0].response_format.json_schema.strict).toBe(true);
    expect(bodies[0].model).toBe('claude-haiku-5.5');
    expect(budget.spentUsd).toBeCloseTo((1000 * 0.065 + 100 * 0.325) / 1e6, 10);
    const sonnet = createCheaperInferenceAdapter('claude-sonnet-5.5', { fetchImpl, env: () => ({ CHEAPER_INFERENCE_API_KEY: 'k' }), budget });
    expect(await sonnet.complete(req({ role: 'reviser' }))).toMatchObject({ ok: false, code: 'NOT_ALLOWED' });
  });
});

describe('cross-family rule', () => {
  it('accepts the default maps and refuses a same-family judge', () => {
    expect(verifyCrossFamily(DEFAULT_ROLE_MAP)).toEqual({ ok: true });
    expect(verifyCrossFamily(FALLBACK_ROLE_MAP)).toEqual({ ok: true });
    expect(verifyCrossFamily({ ...DEFAULT_ROLE_MAP, judge: 'claude_cli:haiku' }).ok).toBe(false);
    expect(verifyCrossFamily({ ...DEFAULT_ROLE_MAP, factcheck: 'ci:claude-haiku-5.5' }).ok).toBe(false);
  });
  it("accepts open-source providers like ollama and groq across roles", () => {
    expect(parseRoleSpec("ollama:llama3")).toEqual({ provider: "ollama", model: "llama3" });
    expect(parseRoleSpec("groq:llama-3.3-70b")).toEqual({ provider: "groq", model: "llama-3.3-70b" });
    expect(verifyCrossFamily({ ...DEFAULT_ROLE_MAP, judge: "ollama:llama3" })).toEqual({ ok: true });
  });
});
