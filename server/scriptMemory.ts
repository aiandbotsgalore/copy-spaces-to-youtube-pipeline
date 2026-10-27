/**
 * Editorial memory: Logan's accept and reject decisions on proposed changes, stored in
 * .spacepipe-studio/memory.json. Approved narration becomes approved passages (few-shot examples);
 * rejected rewrites are kept with their before and after text.
 */
import type { ScriptProject, ScriptVersion } from '../utils/scriptTypes';
import { diffVersions } from '../utils/scriptGates';
import type { ScriptStore } from './scriptStore';

const MAX_PASSAGES = 50;
const MAX_REJECTED = 100;

export function recordDecision(store: ScriptStore, project: ScriptProject, parent: ScriptVersion | null, cand: ScriptVersion, decision: 'accept' | 'reject', reason: string) {
  const mem = store.getMemory();
  const diff = parent ? diffVersions(parent.segments, cand.segments) : [];
  const text = (b: any) => (b?.kind === 'narration' ? b.text : b?.kind === 'clip' ? `[clip ${b.clipId}] ${b.keptText}` : '');
  if (decision === 'accept') {
    for (const d of diff) if (d.after?.kind === 'narration') mem.approvedPassages.push({ text: d.after.text, projectId: project.id });
    mem.approvedPassages = mem.approvedPassages.slice(-MAX_PASSAGES);
  } else {
    const before = diff.map(d => text(d.before)).filter(Boolean).join('\n');
    const after = diff.map(d => text(d.after)).filter(Boolean).join('\n');
    if (before || after) mem.rejectedRewrites.push({ before, after, reason: reason || 'Rejected by Logan.' });
    mem.rejectedRewrites = mem.rejectedRewrites.slice(-MAX_REJECTED);
  }
  mem.decisionsSinceDistill = (mem.decisionsSinceDistill || 0) + 1;
  store.saveMemory(mem);
  return mem;
}
