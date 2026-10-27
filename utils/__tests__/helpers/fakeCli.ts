/**
 * An injected ProcessRunner that stands in for the Claude Code and Codex CLIs in tests. It checks the
 * exact argv contract (no shell, schema flags, model pins) and answers from a responder keyed by the
 * output schema name. Nothing here is used by the app.
 */
import fs from 'node:fs';
import type { ProcessRunner, RunOutcome } from '../../../server/scriptProviders';

export interface CliCall { cli: 'claude' | 'codex' | 'other'; file: string; args: string[]; stdin: string; cwd: string; env: Record<string, string | undefined> }
export type Responder = (schemaKind: string, prompt: string, cli: 'claude' | 'codex') => unknown | { __fail: RunOutcome };

export function schemaKind(schema: any): string {
  const p = Object.keys(schema?.properties || {}).sort().join(',');
  const map: Record<string, string> = {
    'dynamics,ledger,moments,openQuestions,themes': 'analysis',
    'dynamics,keepMomentIds,openQuestions,themes': 'reduce',
    tags: 'clipTags',
    structuralCritiques: 'structuralCritiques',
    segments: 'outline',
    scenes: 'draft',
    'blocks,summary': 'revise',
    critiques: 'critique',
    'reasons,winner': 'judge',
    claims: 'factcheck',
  };
  return map[p] || p;
}

export function makeFakeCli(responder: Responder, calls: CliCall[] = []): ProcessRunner {
  return async (file, args, opts): Promise<RunOutcome> => {
    const stdin = opts.stdin ? opts.stdin.toString('utf8') : '';
    const cli = /claude/.test(file) ? 'claude' : /codex/.test(file) ? 'codex' : 'other';
    calls.push({ cli, file, args, stdin, cwd: opts.cwd, env: opts.env });
    const ok = (stdout: string): RunOutcome => ({ code: 0, stdout, stderr: '', timedOut: false, aborted: false });
    if (file === 'which' || file === 'where.exe') return ok(`/usr/local/bin/${args[args.length - 1]}\n`);
    if (cli === 'claude' && args[0] === 'auth') return ok(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }));
    if (cli === 'codex' && args[0] === 'login') return ok('Logged in using ChatGPT');
    if (cli === 'claude' && args[0] === '-p') {
      const schema = JSON.parse(args[args.indexOf('--json-schema') + 1]);
      const sys = fs.readFileSync(args[args.indexOf('--system-prompt-file') + 1], 'utf8');
      const out = responder(schemaKind(schema), `${sys}\n${stdin}`, 'claude') as any;
      if (out && out.__fail) return out.__fail;
      return ok(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '', structured_output: out, usage: { input_tokens: 100, output_tokens: 50 }, model: 'claude-sonnet-test' }));
    }
    if (cli === 'codex' && args[0] === 'exec') {
      const schema = JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema') + 1], 'utf8'));
      const out = responder(schemaKind(schema), stdin, 'codex') as any;
      if (out && out.__fail) return out.__fail;
      fs.writeFileSync(args[args.indexOf('-o') + 1], JSON.stringify(out));
      return ok(`${JSON.stringify({ type: 'thread.started' })}\n${JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 80, output_tokens: 20 } })}\n`);
    }
    return { code: 127, stdout: '', stderr: `unexpected ${file}`, timedOut: false, aborted: false };
  };
}

/** The GitHub release listing of the test episode (the real asset names of release 20260826_1AxRnZYBVdrxl). */
export const RELEASE_ASSETS = {
  assets: [
    '01h33m45s_I_Don.t_Like_It_In_The_Butt.mp3', '01h43m22s_Pimping_Out_for_Boob_Prints.mp3',
    '20260826_1AxRnZYBVdrxl_GOTHIC_MILKSHAKE_A.I._GOD_SEX_WAR_-_PANTS_DOWN_MICS_OPEN.mp3',
    '37m35s_Indecisive_Women_and_the_Zombie_Apocalypse.mp3', 'GOTHIC_MILKSHAKE_A_I__GOD_SEX_WAR_-_PANTS_DOWN_MICS_OPEN.json',
  ].map(name => ({ name, browser_download_url: `https://github.com/aiandbotsgalore/copy-spaces-to-youtube-pipeline/releases/download/20260826_1AxRnZYBVdrxl/${name}` })),
};
export const FULL_EPISODE_URL = RELEASE_ASSETS.assets[2].browser_download_url;
export const releaseResponse = () => new Response(JSON.stringify(RELEASE_ASSETS), { status: 200 });
