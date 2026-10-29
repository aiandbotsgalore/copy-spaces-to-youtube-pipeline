/**
 * Phase 0: approved passages are few-shot voice examples, so only narration Logan explicitly saves
 * becomes one. Accepting a candidate no longer copies every changed narration block into memory.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordDecision, saveApprovedPassage } from '../../server/scriptMemory';
import { createScriptStore } from '../../server/scriptStore';
import type { ScriptProject, ScriptVersion, Segment } from '../scriptTypes';

const project = { id: 'prj_a' } as ScriptProject;
const segs = (text: string): Segment[] => [{ id: 'seg', title: 's', scenes: [{ id: 'sc', title: 't', purpose: 'p', blocks: [{ id: 'b1', kind: 'narration', text, mode: 'polished', claims: [] }] }] }];
const version = (id: string, parentId: string | null, text: string): ScriptVersion => ({ id, parentId, projectId: 'prj_a', createdAt: 1, author: 'loop', segments: segs(text) });
const newStore = () => createScriptStore(fs.mkdtempSync(path.join(os.tmpdir(), 'sp-passages-')));

describe('approved passages', () => {
  it('accepting a candidate records the decision without adding approved passages', () => {
    const store = newStore();
    const mem = recordDecision(store, project, version('v1', null, 'Before.'), version('v2', 'v1', 'After, rewritten by the loop.'), 'accept', '');
    expect(mem.approvedPassages).toEqual([]);
    expect(mem.decisionsSinceDistill).toBe(1);
    expect(store.getMemory().approvedPassages).toEqual([]);
  });

  it('rejecting still keeps the rejected rewrite', () => {
    const store = newStore();
    const mem = recordDecision(store, project, version('v1', null, 'Before.'), version('v2', 'v1', 'Worse.'), 'reject', 'Too breathless.');
    expect(mem.rejectedRewrites).toEqual([{ before: 'Before.', after: 'Worse.', reason: 'Too breathless.' }]);
  });

  it('saves a passage only when asked, trimmed and once', () => {
    const store = newStore();
    saveApprovedPassage(store, 'prj_a', '  Oor names the cake  before the tape.  ');
    saveApprovedPassage(store, 'prj_b', 'Oor names the cake before the tape.');
    expect(store.getMemory().approvedPassages).toEqual([{ text: 'Oor names the cake before the tape.', projectId: 'prj_a' }]);
  });

  it('refuses an empty passage and keeps at most 50', () => {
    const store = newStore();
    expect(() => saveApprovedPassage(store, 'prj_a', '   ')).toThrow(/needs text/);
    for (let i = 0; i < 55; i++) saveApprovedPassage(store, 'prj_a', `Passage number ${i}.`);
    const kept = store.getMemory().approvedPassages;
    expect(kept).toHaveLength(50);
    expect(kept[0].text).toBe('Passage number 5.');
  });
});
