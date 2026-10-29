/**
 * Phase 0 acceptance: the latest backup matches the live studio folder byte for byte, and every
 * existing project opens and saves unchanged (run on a temporary copy; the live folder is untouched).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { verifyBackup } from '../../server/studioBackup';
import { changedPaths, REPO, removeTempRoot, startStudio, STUDIO, tempStudioRoot, treeHashes } from './helpers';

const liveBefore = treeHashes(STUDIO);
let root = '';
let studio: Awaited<ReturnType<typeof startStudio>>;

beforeAll(async () => { root = tempStudioRoot(); studio = await startStudio(root); });
afterAll(() => { studio?.close(); if (root) removeTempRoot(root); });

describe('Phase 0 acceptance', () => {
  it('the latest backup matches the live studio folder byte for byte', () => {
    const dir = path.join(REPO, '.spacepipe-studio-backups');
    const latest = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort().at(-1);
    expect(latest, 'run node scripts/backup_studio.ts first').toBeTruthy();
    const v = verifyBackup(STUDIO, path.join(dir, latest!));
    console.log(`backup ${latest}: ${v.checked} files checked`, v.ok ? 'all match' : v);
    expect(v.ok).toBe(true);
  });

  it('every existing project opens and saves its head unchanged', async () => {
    const projects = (await studio.api('GET', '/projects')).json.projects as any[];
    expect(projects.length).toBeGreaterThan(0);
    for (const p of projects) {
      const before = treeHashes(path.join(root, '.spacepipe-studio'));
      const open = await studio.api('GET', `/project?id=${p.id}`);
      expect(open.status, `${p.title} opens`).toBe(200);
      if (!open.json.head) { console.log(`${p.title}: opens (no head version to save)`); continue; }
      const head = open.json.head;
      const save = await studio.api('POST', '/version', { projectId: p.id, parentId: p.headVersionId, segments: head.segments, label: 'Phase 0 acceptance' });
      expect(save.status, `${p.title} saves: ${JSON.stringify(save.json.message || '')}`).toBe(200);
      expect(save.json.headMoved, `${p.title} head moves: ${save.json.gates?.failures?.join(' ')}`).toBe(true);
      // The saved version carries the same segments (take fields come from the take index on both sides).
      const reread = await studio.api('GET', `/project?id=${p.id}`);
      expect(reread.json.head.segments).toEqual(head.segments);
      const { headVersionId: _h1, updatedAt: _u1, ...restBefore } = p;
      const { headVersionId: _h2, updatedAt: _u2, ...restAfter } = reread.json.project;
      expect(restAfter).toEqual(restBefore);
      // Only this project's project.json and the new version file were written.
      const changed = changedPaths(before, treeHashes(path.join(root, '.spacepipe-studio')));
      expect(changed).toEqual([`projects/${p.id}/project.json`, `projects/${p.id}/versions/${save.json.version.id}.json`].sort());
      console.log(`${p.title}: opens and saves unchanged`);
    }
  });

  it('left the live studio folder untouched', () => {
    expect(changedPaths(liveBefore, treeHashes(STUDIO))).toEqual([]);
  });
});
