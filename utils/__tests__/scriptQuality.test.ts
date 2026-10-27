import { describe, it, expect } from 'vitest';
import { agreement, callStats, collectPairs, judgePreference, orderConsistency, promptOutcomes, qualityReport, samplePairs, summarizeLog, type JudgedPair } from '../scriptQuality';
import type { ScriptVersion } from '../scriptTypes';

const gates = { factual: 'pass', faithful: 'pass', locksIntact: true, clipBoundsOk: true, runtimeOk: true, failures: [] } as const;
let n = 0;
function v(ab: 'A' | 'B' | 'tie', ba: 'A' | 'B' | 'tie', logan?: 'accept' | 'reject', extra: Partial<ScriptVersion['decision']> = {}): ScriptVersion {
  n++;
  return {
    id: `v${n}`, parentId: 'v0', projectId: 'p', createdAt: n, author: 'loop', segments: [],
    decision: {
      candidateId: `v${n}`, baselineId: 'v0', round: 0, promptVersion: 'revise.v3', gates: { ...gates, failures: [] }, loopAccepted: judgePreference(ab, ba) === 'candidate',
      judge: { provider: 'codex_cli', model: 'gpt-6.1-sol', winnerAB: ab, winnerBA: ba, consensus: judgePreference(ab, ba) === 'candidate' ? 'two_wins' : 'rejected', reasons: [], promptVersion: 'judge.v2' },
      loganDecision: logan, ...extra,
    },
  };
}

describe('judge preference from both orders', () => {
  it('AB: A is the baseline; BA: A is the candidate', () => {
    expect(judgePreference('B', 'A')).toBe('candidate');
    expect(judgePreference('A', 'B')).toBe('baseline');
    expect(judgePreference('B', 'tie')).toBe('candidate');
    expect(judgePreference('B', 'B')).toBe('none'); // one vote each: position bias, not a preference
    expect(judgePreference('tie', 'tie')).toBe('none');
  });
});

describe('judge vs Logan', () => {
  const pairs = collectPairs([
    v('B', 'A', 'accept'), v('B', 'A', 'accept'), v('A', 'B', 'reject'), v('B', 'A', 'reject'), v('tie', 'tie', 'accept'), v('B', 'A'),
    { id: 'manual', parentId: null, projectId: 'p', createdAt: 0, author: 'logan', segments: [] },
  ]);
  it('collects only judged candidates', () => {
    expect(pairs).toHaveLength(6);
    expect(pairs[0]).toMatchObject({ judgeModel: 'codex_cli:gpt-6.1-sol', judgePromptVersion: 'judge.v2', revisePromptVersion: 'revise.v3', level: 'scene' });
  });
  it('counts agreement and Cohen kappa on conclusive decided pairs', () => {
    const a = agreement(pairs);
    expect(a).toMatchObject({ pairs: 5, conclusive: 4, agree: 3, disagree: 1, inconclusive: 1, agreementRate: 0.75 });
    // judge: 3 cand / 1 base; Logan: 2 accept / 2 reject. po = .75, pe = .75*.5 + .25*.5 = .5 -> kappa .5
    expect(a.kappa).toBeCloseTo(0.5, 10);
  });
  it('kappa is undefined when there is no variation', () => {
    expect(agreement(collectPairs([v('B', 'A', 'accept'), v('B', 'A', 'accept')])).kappa).toBeNull();
  });
  it('reports order consistency (position bias)', () => {
    expect(orderConsistency(collectPairs([v('B', 'A'), v('A', 'A'), v('B', 'tie'), v('tie', 'tie')]))).toEqual({ judged: 4, consistent: 2, sameLetter: 1, tieOrSplit: 1 });
  });
  it('lists disagreements and warns while the sample is small', () => {
    const r = qualityReport(pairs);
    expect(r.disagreements.map(d => d.candidateId)).toHaveLength(1);
    expect(r.note).toMatch(/Only 4 decided pairs/);
    expect(qualityReport([]).note).toMatch(/No judged change/);
    expect(Object.keys(r.byJudgeModel)).toEqual(['codex_cli:gpt-6.1-sol']);
  });
  it('samples deterministically', () => {
    const many = collectPairs(Array.from({ length: 30 }, () => v('B', 'A', 'accept')));
    const s1 = samplePairs(many, 10).map(p => p.candidateId);
    expect(s1).toHaveLength(10);
    expect(samplePairs([...many].reverse(), 10).map(p => p.candidateId)).toEqual(s1);
  });
});

describe('prompt versions and logs', () => {
  it('groups candidate outcomes by prompt version', () => {
    const rows = promptOutcomes([v('B', 'A', 'accept'), v('A', 'B', 'reject'), v('B', 'A', undefined, { promptVersion: 'revise.v1' }), v('B', 'A', 'accept', { promptVersion: 'manual' })]);
    expect(rows).toEqual([
      { promptVersion: 'revise.v1', candidates: 1, gatesPassed: 1, judged: 1, loopAccepted: 1, loganAccepted: 0, loganRejected: 0, pending: 1 },
      { promptVersion: 'revise.v3', candidates: 2, gatesPassed: 2, judged: 2, loopAccepted: 1, loganAccepted: 1, loganRejected: 1, pending: 0 },
    ]);
  });
  it('summarises call logs by prompt version, role and model', () => {
    const entries = [
      { at: 1, role: 'judge', provider: 'codex_cli', model: 'gpt-6.1-sol', promptVersion: 'judge.v2', ok: true, durationMs: 1000, inTok: 100, outTok: 10 },
      { at: 2, role: 'judge', provider: 'codex_cli', model: 'gpt-6.1-sol', promptVersion: 'judge.v2', ok: false, code: 'USAGE_LIMIT', durationMs: 50 },
      { at: 3, role: 'critic', provider: 'cheaperinference', model: 'claude-haiku-5.5', promptVersion: 'critique.v2', ok: true, durationMs: 300, costUsd: 0.001 },
    ];
    const rows = callStats(entries);
    expect(rows.map(r => `${r.promptVersion}:${r.role}`)).toEqual(['critique.v2:critic', 'judge.v2:judge']);
    expect(rows[1]).toMatchObject({ calls: 2, failures: 1, failureCodes: { USAGE_LIMIT: 1 }, avgMs: 525, inTok: 100 });
    expect(summarizeLog('run_1', 'p', entries)).toEqual({ runId: 'run_1', projectId: 'p', calls: 3, failures: 1, totalMs: 1350, costUsd: 0.001, firstAt: 1, lastAt: 3 });
  });
});
