/**
 * Backup of .spacepipe-studio/ (gitignored, so git cannot restore it) into
 * .spacepipe-studio-backups/<UTC stamp>/, with a manifest of sha256 hashes and a byte for byte check.
 * Uses only Node built ins so `node scripts/backup_studio.ts` can run it directly.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const MANIFEST_NAME = 'backup-manifest.json';

export interface BackupResult { dir: string; files: number; bytes: number; manifestPath: string }
export interface VerifyResult { ok: boolean; checked: number; missing: string[]; mismatched: string[]; extra: string[] }

/** Every file under dir, as sorted forward slash paths relative to dir. */
function listFiles(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listFiles(dir, r));
    else if (e.isFile()) out.push(r);
  }
  return out.sort();
}

const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');
const stampOf = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');

export function backupStudio(root: string, opts: { now?: () => number } = {}): BackupResult {
  const src = path.join(root, '.spacepipe-studio');
  if (!fs.existsSync(src)) throw new Error(`No .spacepipe-studio folder in ${root}.`);
  const dir = path.join(root, '.spacepipe-studio-backups', stampOf((opts.now ?? Date.now)()));
  if (fs.existsSync(dir)) throw new Error(`Backup folder ${dir} already exists.`);
  const files: { path: string; bytes: number; sha256: string }[] = [];
  for (const rel of listFiles(src)) {
    const buf = fs.readFileSync(path.join(src, rel));
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, buf);
    files.push({ path: rel, bytes: buf.length, sha256: sha256(buf) });
  }
  const manifestPath = path.join(path.dirname(dir), `${path.basename(dir)}.${MANIFEST_NAME}`);
  fs.writeFileSync(manifestPath, JSON.stringify({ source: src, createdAt: new Date().toISOString(), files }, null, 2));
  return { dir, files: files.length, bytes: files.reduce((n, f) => n + f.bytes, 0), manifestPath };
}

/** Compares the backup with the live folder byte for byte. */
export function verifyBackup(studioDir: string, backupDir: string): VerifyResult {
  const live = listFiles(studioDir);
  const copy = new Set(listFiles(backupDir));
  const missing: string[] = [];
  const mismatched: string[] = [];
  for (const rel of live) {
    if (!copy.has(rel)) { missing.push(rel); continue; }
    if (!fs.readFileSync(path.join(studioDir, rel)).equals(fs.readFileSync(path.join(backupDir, rel)))) mismatched.push(rel);
  }
  const liveSet = new Set(live);
  const extra = [...copy].filter(r => !liveSet.has(r)).sort();
  return { ok: !missing.length && !mismatched.length && !extra.length, checked: live.length, missing, mismatched, extra };
}
