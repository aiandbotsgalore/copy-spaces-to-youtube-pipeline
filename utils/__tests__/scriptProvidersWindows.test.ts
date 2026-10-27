/**
 * Fixes from the first real run on Logan's Windows PC:
 * - Claude Code 2.x ships a native bin/claude.exe; its npm shim runs that .exe, not a JS entry.
 * - Status checks spawned the CLIs in a sandbox directory that only complete() created, so on a fresh
 *   machine Node failed with "spawn node.exe ENOENT" and the status said "exited null: ".
 * - A user-level Claude hook that prints errors to stderr must not fail a successful `claude -p` result.
 * The spawn tests run real child processes (node scripts standing in for the CLIs' observable behaviour).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  claudeEnvelope, createClaudeCliAdapter, createCodexCliAdapter, describeExit, parseCmdShim, resolveCliBinary, spawnRunner, subscriptionEnv,
  type ProcessRunner, type RunOutcome,
} from '../../server/scriptProviders';

const out = (o: Partial<RunOutcome>): RunOutcome => ({ code: 0, stdout: '', stderr: '', timedOut: false, aborted: false, ...o });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sp-win-'));
const req = { role: 'critic' as const, system: 'S', user: 'U', schema: { type: 'object' }, schemaName: 'x', maxTokens: 10, timeoutMs: 20_000, signal: new AbortController().signal };

// The shim npm 11 writes for Claude Code 2.1.311 (as found at C:\npmglobal\claude.cmd).
const EXE_SHIM = '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n';

describe('npm shim that runs a native .exe', () => {
  it('parses the .exe target', () => {
    expect(parseCmdShim(EXE_SHIM, 'C:\\npmglobal\\claude.cmd')).toBe('C:\\npmglobal\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe');
  });
  const where: ProcessRunner = async () => out({ stdout: 'C:\\npmglobal\\claude\r\nC:\\npmglobal\\claude.cmd\r\n' });
  it('spawns the .exe directly, without node and without a shell', async () => {
    const r = await resolveCliBinary('claude', { platform: 'win32', runner: where, readFile: () => EXE_SHIM, exists: p => p.endsWith('claude.exe'), nodePath: 'C:\\node\\node.exe', env: {} });
    expect(r).toEqual({ ok: true, file: 'C:\\npmglobal\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe', prefixArgs: [], via: 'npm-shim-exe', found: 'C:\\npmglobal\\claude.cmd' });
  });
  it('refuses a shim whose .exe is missing', async () => {
    const r = await resolveCliBinary('claude', { platform: 'win32', runner: where, readFile: () => EXE_SHIM, exists: () => false, nodePath: 'node', env: {} });
    expect(r.ok).toBe(false);
  });
});

describe('status checks on a fresh machine', () => {
  it('the runner names a missing working directory instead of blaming the binary', async () => {
    const r = await spawnRunner(process.execPath, ['-e', '1'], { cwd: path.join(tmp(), 'nope'), env: process.env, timeoutMs: 5000 });
    expect(r.spawnError).toMatch(/working directory .*nope does not exist/);
    expect(describeExit(r, 'codex login status')).toMatch(/^codex login status could not be started: working directory/);
  });
  it('codex login status creates the sandbox and passes the user profile env through (real process)', async () => {
    const d = tmp();
    const fakeHome = path.join(d, 'home');
    const script = path.join(d, 'codex.js');
    // Like codex.js: needs the user's profile dirs to find its login, prints the status, exits 0.
    fs.writeFileSync(script, `const h = process.env.USERPROFILE || process.env.HOME; if (!h || process.cwd() !== ${JSON.stringify(path.join(d, 'sandbox'))}) process.exit(3); console.log('Logged in using ChatGPT');`);
    const env = { PATH: process.env.PATH, USERPROFILE: fakeHome, APPDATA: path.join(fakeHome, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(fakeHome, 'AppData', 'Local'), SystemRoot: 'C:\\Windows', OPENAI_API_KEY: 'k' };
    const dirs = { sandbox: path.join(d, 'sandbox'), io: path.join(d, 'io') };
    expect(fs.existsSync(dirs.sandbox)).toBe(false);
    const ad = createCodexCliAdapter({ runner: spawnRunner, dirs, env: () => env, resolve: async () => ({ ok: true, file: process.execPath, prefixArgs: [script], via: 'npm-shim', found: 'codex.cmd' }) });
    expect(await ad.available()).toEqual({ ok: true, detail: 'Logged in using ChatGPT', binPath: 'codex.cmd' });
    expect(fs.existsSync(dirs.sandbox)).toBe(true);
  });
  it('the subscription env keeps the Windows profile and system variables', () => {
    const win = { Path: 'C:\\npmglobal;C:\\Windows', USERPROFILE: 'C:\\Users\\Logan', HOMEDRIVE: 'C:', HOMEPATH: '\\Users\\Logan', APPDATA: 'a', LOCALAPPDATA: 'l', SystemRoot: 'C:\\Windows', ComSpec: 'cmd', TEMP: 't', TMP: 't', PATHEXT: '.EXE', CODEX_HOME: 'c', OPENAI_API_KEY: 'k', ANTHROPIC_API_KEY: 'k' };
    const env = subscriptionEnv(win);
    for (const k of Object.keys(win).filter(k => !k.endsWith('API_KEY'))) expect(env[k]).toBe((win as any)[k]);
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });
  it('a null exit code with no output gets a useful message', () => {
    expect(describeExit(out({ code: null }), 'codex login status')).toBe('codex login status was ended by the system without an exit code and printed nothing.');
    expect(describeExit(out({ code: null, signal: 'SIGKILL' }), 'x')).toBe('x was ended by signal SIGKILL without an exit code and printed nothing.');
    expect(describeExit(out({ code: null, timedOut: true }), 'x')).toBe('x did not finish in time.');
    expect(describeExit(out({ code: 1, stderr: 'Not logged in' }), 'x')).toBe('x exited 1: Not logged in');
  });
  it('a status check that cannot start is NOT_INSTALLED with the reason, not NOT_SIGNED_IN', async () => {
    const ad = createCodexCliAdapter({ runner: async () => out({ code: null, spawnError: 'spawn C:\\x\\node.exe ENOENT' }), dirs: { sandbox: path.join(tmp(), 's'), io: path.join(tmp(), 'i') }, env: () => ({}), resolve: async () => ({ ok: true, file: 'node', prefixArgs: ['codex.js'], via: 'npm-shim', found: 'codex.cmd' }) });
    expect(await ad.available()).toMatchObject({ ok: false, code: 'NOT_INSTALLED', detail: 'codex login status could not be started: spawn C:\\x\\node.exe ENOENT.' });
  });
});

describe('Claude hooks printing to stderr', () => {
  const envelope = (o: object = {}) => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '', structured_output: { ok: 1 }, usage: { input_tokens: 5, output_tokens: 2 }, model: 'claude-haiku', ...o });
  const HOOK_ERR = 'SessionEnd hook [bun run ~/.claude/hooks/end.ts] failed: /usr/bin/bash: bun: command not found\n';
  const resolve = async () => ({ ok: true as const, file: 'claude', prefixArgs: [], via: 'path' as const, found: 'claude' });
  const dirs = () => ({ sandbox: path.join(tmp(), 's'), io: path.join(tmp(), 'i') });
  it('a successful envelope wins over hook errors on stderr, whatever the exit code', async () => {
    for (const code of [0, 1]) {
      const ad = createClaudeCliAdapter('haiku', { dirs: dirs(), env: () => ({}), resolve, runner: async () => out({ code, stdout: envelope(), stderr: HOOK_ERR }) });
      expect(await ad.complete(req)).toMatchObject({ ok: true, json: { ok: 1 }, usage: { inTok: 5, outTok: 2 } });
    }
  });
  it('hook output on stdout before the envelope is skipped', () => {
    expect(claudeEnvelope(`{"hook":"noise"}\n${envelope()}\n`)).toMatchObject({ type: 'result', structured_output: { ok: 1 } });
  });
  it('an error envelope still fails, with stderr kept in the raw output', async () => {
    const ad = createClaudeCliAdapter('haiku', { dirs: dirs(), env: () => ({}), resolve, runner: async () => out({ code: 1, stdout: envelope({ is_error: true, subtype: 'error_during_execution', structured_output: null, result: 'Not logged in' }), stderr: HOOK_ERR }) });
    const r = await ad.complete(req);
    expect(r).toMatchObject({ ok: false, code: 'NOT_SIGNED_IN' });
    if (!r.ok) expect(r.rawOutput).toContain('bun: command not found');
  });
  it('works through a real process that writes the envelope and then hook noise to stderr and exits 1', async () => {
    const d = tmp();
    const script = path.join(d, 'claude.js');
    fs.writeFileSync(script, `let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{process.stdout.write(${JSON.stringify(envelope())});process.stderr.write(${JSON.stringify(HOOK_ERR)});process.exitCode=1;});`);
    const ad = createClaudeCliAdapter('haiku', { runner: spawnRunner, dirs: { sandbox: path.join(d, 's'), io: path.join(d, 'i') }, env: () => ({ PATH: process.env.PATH }), resolve: async () => ({ ok: true, file: process.execPath, prefixArgs: [script], via: 'npm-shim', found: 'claude.cmd' }) });
    expect(await ad.complete(req)).toMatchObject({ ok: true, json: { ok: 1 } });
  });
});
