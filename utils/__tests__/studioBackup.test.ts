/**
 * Phase 0: .spacepipe-studio/ is gitignored, so git cannot restore it. A backup copies every file and
 * proves the copy byte for byte before any phase touches the folder.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backupStudio, verifyBackup } from '../../server/studioBackup';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-backup-'));
  const s = path.join(root, '.spacepipe-studio');
  fs.mkdirSync(path.join(s, 'projects', 'prj_a', 'versions'), { recursive: true });
  fs.mkdirSync(path.join(s, 'clip-cache'), { recursive: true });
  fs.writeFileSync(path.join(s, 'memory.json'), '{"styleRules":[]}');
  fs.writeFileSync(path.join(s, 'projects', 'prj_a', 'project.json'), '{"id":"prj_a"}');
  fs.writeFileSync(path.join(s, 'projects', 'prj_a', 'versions', 'v_1.json'), '{"id":"v_1"}');
  fs.writeFileSync(path.join(s, 'clip-cache', 'a.wav'), Buffer.from([0, 255, 1, 254, 2, 253]));
  return { root, studio: s };
}

describe('studio backup', () => {
  it('copies every file into a timestamped folder outside the studio folder and verifies it', () => {
    const { root, studio } = fixture();
    const b = backupStudio(root, { now: () => Date.UTC(2026, 9, 28, 23, 5, 9) });
    expect(b.dir).toBe(path.join(root, '.spacepipe-studio-backups', '2026-10-28T23-05-09Z'));
    expect(b.files).toBe(4);
    expect(b.bytes).toBe(17 + 14 + 12 + 6);
    expect(fs.readFileSync(path.join(b.dir, 'clip-cache', 'a.wav'))).toEqual(fs.readFileSync(path.join(studio, 'clip-cache', 'a.wav')));
    const manifest = JSON.parse(fs.readFileSync(b.manifestPath, 'utf8'));
    expect(manifest.files.map((f: any) => f.path)).toEqual(['clip-cache/a.wav', 'memory.json', 'projects/prj_a/project.json', 'projects/prj_a/versions/v_1.json']);
    expect(manifest.files[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyBackup(studio, b.dir)).toEqual({ ok: true, checked: 4, missing: [], mismatched: [], extra: [] });
  });

  it('reports a changed, missing or extra file', () => {
    const { root, studio } = fixture();
    const b = backupStudio(root);
    fs.writeFileSync(path.join(b.dir, 'memory.json'), '{"styleRules":[1]}');
    fs.rmSync(path.join(b.dir, 'projects', 'prj_a', 'project.json'));
    fs.writeFileSync(path.join(studio, 'new.json'), '{}');
    const v = verifyBackup(studio, b.dir);
    expect(v.ok).toBe(false);
    expect(v.mismatched).toEqual(['memory.json']);
    expect(v.missing).toEqual(['new.json', 'projects/prj_a/project.json']);
    expect(v.extra).toEqual([]);
  });

  it('refuses when there is no studio folder', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-backup-empty-'));
    expect(() => backupStudio(root)).toThrow(/No \.spacepipe-studio folder/);
  });
});
