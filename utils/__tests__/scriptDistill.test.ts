import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addExplicitRule, distillRules, dueForDistill, removeRule } from '../../server/scriptMemory';
import { createScriptStore } from '../../server/scriptStore';
import type { CompleteResult } from '../../server/scriptProviders';

const ok = (json: unknown): CompleteResult => ({ ok: true, json, provider: 'claude_cli', model: 'haiku', durationMs: 3 });

describe('learned rules', () => {
  it('distils from decisions, keeps Logan\'s explicit rules, needs two supporting decisions and never re-learns a removed rule', async () => {
    const store = createScriptStore(fs.mkdtempSync(path.join(os.tmpdir(), 'sp-distill-')));
    const mem = store.getMemory();
    mem.approvedPassages = [{ text: 'Oor says the cake is citrus.', projectId: 'p' }, { text: 'In his own words:', projectId: 'p' }];
    mem.rejectedRewrites = [{ before: 'Oor said it.', after: 'In a stunning revelation, Oor said it.', reason: 'Too breathless.' }];
    mem.styleRules = [{ rule: 'Never say "stunning".', source: 'explicit', weight: 100 }, { rule: 'Old learned rule.', source: 'approved', weight: 2 }];
    mem.decisionsSinceDistill = 10;
    store.saveMemory(mem);
    expect(dueForDistill(store.getMemory())).toBe(true);

    let prompt = '';
    const st = await distillRules(store, async p => {
      prompt = `${p.system}\n${p.user}`;
      return ok({ rules: [
        { rule: 'Name the speaker before the quote.', from: 'approved', evidence: 3 },
        { rule: 'Skip hype words.', from: 'rejected', evidence: 2 },
        { rule: 'One-off hunch.', from: 'approved', evidence: 1 },
        { rule: 'Never say "stunning".', from: 'rejected', evidence: 4 },
        { rule: 'Old learned rule.', from: 'approved', evidence: 2 },
      ] });
    }, () => 1000);
    expect(prompt).toContain('In a stunning revelation');
    expect(prompt).toContain('Reason: Too breathless.');
    expect(prompt).toContain('- Never say "stunning".');
    expect(st).toMatchObject({ ok: true, decisions: 10, added: 2, kept: 1, removed: 0, promptVersion: 'distill-rules.v1', model: 'haiku' });
    const after = store.getMemory();
    expect(after.styleRules.map(r => [r.rule, r.source, r.weight])).toEqual([
      ['Never say "stunning".', 'explicit', 100], ['Name the speaker before the quote.', 'approved', 3], ['Skip hype words.', 'rejected', 2], ['Old learned rule.', 'approved', 2],
    ]);
    expect(after.decisionsSinceDistill).toBe(0);
    expect(after.lastDistill?.message).toBe('3 learned rules from 10 decisions (2 new, 1 kept, 0 dropped).');

    removeRule(store, 'Skip hype words.');
    expect(store.getMemory().removedRules).toEqual(['Skip hype words.']);
    addExplicitRule(store, '  Keep   clips under a minute. ');
    expect(store.getMemory().styleRules[0]).toMatchObject({ rule: 'Keep clips under a minute.', source: 'explicit' });
    expect(() => addExplicitRule(store, '   ')).toThrow(/needs text/);

    await distillRules(store, async p => { prompt = p.user; return ok({ rules: [{ rule: 'Skip hype words.', from: 'rejected', evidence: 5 }] }); });
    expect(prompt).toContain('Never use this rule (Logan removed it): Skip hype words.');
    expect(store.getMemory().styleRules.map(r => r.rule)).toEqual(['Keep clips under a minute.', 'Never say "stunning".']);
  });

  it('a failed distill records why and keeps the counter', async () => {
    const store = createScriptStore(fs.mkdtempSync(path.join(os.tmpdir(), 'sp-distill-')));
    const mem = store.getMemory();
    mem.decisionsSinceDistill = 12;
    mem.styleRules = [{ rule: 'Learned.', source: 'approved', weight: 3 }];
    store.saveMemory(mem);
    const st = await distillRules(store, async () => ({ ok: false, code: 'USAGE_LIMIT', message: 'limit until 4 PM', rawOutput: '', durationMs: 1, provider: 'claude_cli', model: 'haiku' }));
    expect(st).toMatchObject({ ok: false, message: 'Rules not updated: claude_cli (haiku) USAGE_LIMIT: limit until 4 PM' });
    expect(store.getMemory()).toMatchObject({ decisionsSinceDistill: 12, styleRules: [{ rule: 'Learned.' }] });
  });
});
