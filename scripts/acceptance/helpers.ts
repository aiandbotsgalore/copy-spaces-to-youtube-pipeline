/**
 * Shared helpers for the acceptance scripts. Real data is only ever read; anything that writes runs
 * against a temporary copy of .spacepipe-studio whose public/ folders are junctions to the real ones.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createScriptStudioMiddleware } from '../../server/scriptStudioMiddleware';

export const REPO = path.resolve(__dirname, '..', '..');
export const STUDIO = path.join(REPO, '.spacepipe-studio');

export const md5File = (f: string) => createHash('md5').update(fs.readFileSync(f)).digest('hex');

/** sha256 of every file under dir, keyed by forward slash relative path. */
export function treeHashes(dir: string, rel = '', out: Record<string, string> = {}): Record<string, string> {
  if (!fs.existsSync(path.join(dir, rel))) return out;
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) treeHashes(dir, r, out);
    else if (e.isFile()) out[r] = createHash('sha256').update(fs.readFileSync(path.join(dir, r))).digest('hex');
  }
  return out;
}

export function changedPaths(before: Record<string, string>, after: Record<string, string>) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter(k => before[k] !== after[k]).sort();
}

/** A temp root holding a copy of .spacepipe-studio, with public/transcripts and public/clips linked read only. */
export function tempStudioRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-accept-'));
  fs.cpSync(STUDIO, path.join(root, '.spacepipe-studio'), { recursive: true });
  fs.mkdirSync(path.join(root, 'public'), { recursive: true });
  for (const d of ['transcripts', 'clips']) fs.symlinkSync(path.join(REPO, 'public', d), path.join(root, 'public', d), 'junction');
  fs.mkdirSync(path.join(root, 'docs', 'documentary'), { recursive: true });
  fs.symlinkSync(path.join(REPO, 'docs', 'documentary', 'data'), path.join(root, 'docs', 'documentary', 'data'), 'junction');
  return root;
}

/** Removes the junctions first so cleanup can never follow them into the real folders. */
export function removeTempRoot(root: string) {
  for (const j of [path.join(root, 'public', 'transcripts'), path.join(root, 'public', 'clips'), path.join(root, 'docs', 'documentary', 'data')]) {
    try { fs.unlinkSync(j); } catch { /* not there */ }
  }
  fs.rmSync(root, { recursive: true, force: true });
}

export async function startStudio(root: string) {
  const mw = createScriptStudioMiddleware({
    root, getEnv: () => ({ PATH: process.env.PATH }),
    runner: async () => { throw new Error('acceptance scripts make no model calls'); },
    resolveOverride: async name => ({ ok: true, file: `/none/${name}`, prefixArgs: [], via: 'path', found: `/none/${name}` }),
  });
  const server = http.createServer((req, res) => { void mw(req, res); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const api = async (method: string, route: string, body?: unknown) => {
    const r = await fetch(`${base}${route}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: await r.json() as any };
  };
  return { mw, api, close: () => server.close() };
}
