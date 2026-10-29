/**
 * Editorial memory: Logan's accept and reject decisions on proposed changes, stored in
 * .spacepipe-studio/memory.json. Approved passages (few-shot examples) are only the narration Logan
 * saves explicitly; rejected rewrites are kept with their before and after text.
 */
import type { DistillStatus, EditorialMemory, ScriptProject, ScriptVersion, StyleRule } from '../utils/scriptTypes';
import { distillPrompt, PROMPT_VERSIONS, type Prompt } from './scriptPrompts';
import type { CompleteResult } from './scriptProviders';
import { diffVersions } from '../utils/scriptGates';
import type { ScriptStore } from './scriptStore';

const MAX_PASSAGES = 50;
const MAX_REJECTED = 100;

export function recordDecision(store: ScriptStore, project: ScriptProject, parent: ScriptVersion | null, cand: ScriptVersion, decision: 'accept' | 'reject', reason: string) {
  const mem = store.getMemory();
  const diff = parent ? diffVersions(parent.segments, cand.segments) : [];
  const text = (b: any) => (b?.kind === 'narration' ? b.text : b?.kind === 'clip' ? `[clip ${b.clipId}] ${b.keptText}` : '');
  // Accepting a candidate no longer adds approved passages; Logan saves those explicitly (saveApprovedPassage).
  if (decision === 'reject') {
    const before = diff.map(d => text(d.before)).filter(Boolean).join('\n');
    const after = diff.map(d => text(d.after)).filter(Boolean).join('\n');
    if (before || after) mem.rejectedRewrites.push({ before, after, reason: reason || 'Rejected by Logan.' });
    mem.rejectedRewrites = mem.rejectedRewrites.slice(-MAX_REJECTED);
  }
  mem.decisionsSinceDistill = (mem.decisionsSinceDistill || 0) + 1;
  store.saveMemory(mem);
  return mem;
}

/** Saves one narration passage as a voice example, only when Logan asks. Trimmed, stored once, newest 50 kept. */
export function saveApprovedPassage(store: ScriptStore, projectId: string, text: string): EditorialMemory {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error('An approved passage needs text.');
  const mem = store.getMemory();
  if (!mem.approvedPassages.some(p => p.text === clean)) mem.approvedPassages = [...mem.approvedPassages, { text: clean, projectId }].slice(-MAX_PASSAGES);
  store.saveMemory(mem);
  return mem;
}

/* ------------------------------------------------------------------------------------------------ */
/* Learned rules                                                                                    */
/* ------------------------------------------------------------------------------------------------ */

export const DISTILL_EVERY = 10;
const MAX_LEARNED = 12;
const MAX_EXPLICIT = 30;

export type DistillCall = (prompt: Prompt, label: string) => Promise<CompleteResult>;

export function dueForDistill(mem: EditorialMemory): boolean {
  return (mem.decisionsSinceDistill || 0) >= DISTILL_EVERY;
}

/**
 * Distils Logan's decisions into at most 12 learned rules (critic role). Logan's explicit rules are
 * never removed or changed. A rule needs at least two supporting decisions. The result and any failure
 * are recorded in memory.lastDistill; the counter resets only on success.
 */
export async function distillRules(store: ScriptStore, call: DistillCall, now: () => number = Date.now): Promise<DistillStatus> {
  const mem = store.getMemory();
  const decisions = mem.decisionsSinceDistill || 0;
  const explicit = mem.styleRules.filter(r => r.source === 'explicit');
  const learned = mem.styleRules.filter(r => r.source !== 'explicit');
  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
  const r = await call(distillPrompt({
    approved: mem.approvedPassages.slice(-30).map(p => `- ${clip(p.text, 600)}`).join('\n'),
    rejected: mem.rejectedRewrites.slice(-30).map(x => `- Before: ${clip(x.before, 400)}\n  After (rejected): ${clip(x.after, 400)}\n  Reason: ${x.reason}`).join('\n'),
    existing: learned.map(x => `- ${x.rule} (${x.source}, ${x.weight})`).join('\n'),
    explicit: [...explicit.map(x => `- ${x.rule}`), ...(mem.removedRules || []).map(x => `- Never use this rule (Logan removed it): ${x}`)].join('\n'),
  }), 'distill rules');
  const fresh = store.getMemory();
  let status: DistillStatus;
  if (!r.ok) {
    status = { at: now(), ok: false, message: `Rules not updated: ${r.provider} (${r.model}) ${r.code}: ${r.message}`, decisions, promptVersion: PROMPT_VERSIONS.distill, provider: r.provider, model: r.model };
  } else {
    const explicitNorm = new Set([...explicit.map(x => x.rule), ...(mem.removedRules || [])].map(x => x.trim().toLowerCase()));
    const seen = new Set<string>();
    const rules: StyleRule[] = [];
    for (const x of (r.json as any)?.rules || []) {
      const rule = String(x?.rule || '').trim();
      const key = rule.toLowerCase();
      const evidence = Math.max(0, Math.floor(Number(x?.evidence) || 0));
      if (!rule || evidence < 2 || explicitNorm.has(key) || seen.has(key)) continue;
      seen.add(key);
      rules.push({ rule, source: x?.from === 'rejected' ? 'rejected' : 'approved', weight: evidence, addedAt: now() });
      if (rules.length >= MAX_LEARNED) break;
    }
    const before = new Set(learned.map(x => x.rule.toLowerCase()));
    const kept = rules.filter(x => before.has(x.rule.toLowerCase())).length;
    status = {
      at: now(), ok: true, decisions, promptVersion: PROMPT_VERSIONS.distill, provider: r.provider, model: r.model,
      added: rules.length - kept, kept, removed: learned.length - kept,
      message: `${rules.length} learned rule${rules.length === 1 ? '' : 's'} from ${decisions} decision${decisions === 1 ? '' : 's'} (${rules.length - kept} new, ${kept} kept, ${learned.length - kept} dropped).`,
    };
    fresh.styleRules = [...fresh.styleRules.filter(x => x.source === 'explicit'), ...rules.sort((a, b) => b.weight - a.weight)];
    fresh.decisionsSinceDistill = Math.max(0, (fresh.decisionsSinceDistill || 0) - decisions);
  }
  fresh.lastDistill = status;
  store.saveMemory(fresh);
  return status;
}

export function addExplicitRule(store: ScriptStore, rule: string, now: () => number = Date.now): EditorialMemory {
  const text = rule.replace(/\s+/g, ' ').trim().slice(0, 300);
  const mem = store.getMemory();
  if (!text) throw new Error('A rule needs text.');
  if (mem.styleRules.filter(r => r.source === 'explicit').length >= MAX_EXPLICIT) throw new Error(`At most ${MAX_EXPLICIT} explicit rules.`);
  if (!mem.styleRules.some(r => r.rule.toLowerCase() === text.toLowerCase())) mem.styleRules = [{ rule: text, source: 'explicit', weight: 100, addedAt: now() }, ...mem.styleRules];
  store.saveMemory(mem);
  return mem;
}

export function removeRule(store: ScriptStore, rule: string): EditorialMemory {
  const mem = store.getMemory();
  const hit = mem.styleRules.find(r => r.rule === rule);
  mem.styleRules = mem.styleRules.filter(r => r.rule !== rule);
  if (hit && hit.source !== 'explicit') mem.removedRules = [...(mem.removedRules || []), rule].slice(-50);
  store.saveMemory(mem);
  return mem;
}
