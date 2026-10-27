/**
 * Phase 3 quality checks, computed from what is already on disk (no model calls, nothing to set up):
 *  - the judge compared with Logan's own accept and reject decisions, on a sample of judged pairs;
 *  - the judge's order consistency (does it pick the same version when A and B are swapped);
 *  - prompt version comparisons from decisions and from the call logs.
 * Pure functions over version, decision and log records.
 */
import type { JudgeWinner, ScriptVersion } from './scriptTypes';

export interface JudgedPair {
  projectId: string; candidateId: string; baselineId: string; createdAt: number;
  level: 'scene' | 'segment' | 'episode';
  judgeModel: string; judgePromptVersion: string; revisePromptVersion: string;
  winnerAB: JudgeWinner; winnerBA: JudgeWinner; consensus: string;
  judgePrefers: 'candidate' | 'baseline' | 'none';
  loopAccepted: boolean; reviewOnly: boolean; logan?: 'accept' | 'reject';
}

export function judgePreference(ab: JudgeWinner, ba: JudgeWinner): 'candidate' | 'baseline' | 'none' {
  // Order AB: A = baseline, B = candidate. Order BA: A = candidate, B = baseline.
  const cand = (ab === 'B' ? 1 : 0) + (ba === 'A' ? 1 : 0);
  const base = (ab === 'A' ? 1 : 0) + (ba === 'B' ? 1 : 0);
  if (cand > base) return 'candidate';
  if (base > cand) return 'baseline';
  return 'none';
}

/** Every judged candidate in a project's versions. */
export function collectPairs(versions: ScriptVersion[]): JudgedPair[] {
  const out: JudgedPair[] = [];
  for (const v of versions) {
    const d = v.decision;
    if (!d?.judge) continue;
    out.push({
      projectId: v.projectId, candidateId: v.id, baselineId: d.baselineId, createdAt: v.createdAt,
      level: v.changedScope?.level ?? 'scene', judgeModel: `${d.judge.provider}:${d.judge.model}`,
      judgePromptVersion: d.judge.promptVersion || 'unknown', revisePromptVersion: d.promptVersion,
      winnerAB: d.judge.winnerAB, winnerBA: d.judge.winnerBA, consensus: d.judge.consensus,
      judgePrefers: judgePreference(d.judge.winnerAB, d.judge.winnerBA),
      loopAccepted: d.loopAccepted, reviewOnly: !!d.reviewOnly, logan: d.loganDecision,
    });
  }
  return out;
}

/** Deterministic sample (FNV-1a hash of the candidate id), so the same pairs are compared each time. */
export function samplePairs<T extends { candidateId: string }>(pairs: T[], max: number): T[] {
  if (pairs.length <= max) return pairs;
  const h = (s: string) => { let x = 0x811c9dc5; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; } return x; };
  return [...pairs].sort((a, b) => h(a.candidateId) - h(b.candidateId)).slice(0, max);
}

export interface AgreementStats {
  pairs: number;            // judged pairs Logan decided, in the sample
  conclusive: number;       // the judge preferred one side
  agree: number; disagree: number; inconclusive: number;
  agreementRate: number | null;
  kappa: number | null;     // Cohen's kappa on conclusive pairs; null when undefined
}

export function agreement(pairs: JudgedPair[]): AgreementStats {
  const decided = pairs.filter(p => p.logan);
  const conclusive = decided.filter(p => p.judgePrefers !== 'none');
  let agree = 0;
  let jc = 0; let lc = 0;
  for (const p of conclusive) {
    const judgeCand = p.judgePrefers === 'candidate';
    const loganCand = p.logan === 'accept';
    if (judgeCand === loganCand) agree++;
    if (judgeCand) jc++;
    if (loganCand) lc++;
  }
  const n = conclusive.length;
  let kappa: number | null = null;
  if (n >= 2) {
    const po = agree / n;
    const pe = (jc / n) * (lc / n) + ((n - jc) / n) * ((n - lc) / n);
    kappa = pe < 1 ? (po - pe) / (1 - pe) : null;
  }
  return {
    pairs: decided.length, conclusive: n, agree, disagree: n - agree, inconclusive: decided.length - n,
    agreementRate: n ? agree / n : null, kappa,
  };
}

export interface OrderConsistency { judged: number; consistent: number; sameLetter: number; tieOrSplit: number }

/** Position bias: picking the same letter in both orders means the judge preferred a position, not a version. */
export function orderConsistency(pairs: JudgedPair[]): OrderConsistency {
  let consistent = 0; let sameLetter = 0; let tieOrSplit = 0;
  for (const p of pairs) {
    if ((p.winnerAB === 'B' && p.winnerBA === 'A') || (p.winnerAB === 'A' && p.winnerBA === 'B') || (p.winnerAB === 'tie' && p.winnerBA === 'tie')) consistent++;
    else if (p.winnerAB === p.winnerBA) sameLetter++;
    else tieOrSplit++;
  }
  return { judged: pairs.length, consistent, sameLetter, tieOrSplit };
}

export interface QualityReport {
  totalJudged: number; sampled: number; sampleMax: number;
  overall: AgreementStats;
  byJudgeModel: Record<string, AgreementStats>;
  byConsensus: Record<string, AgreementStats>;
  byLevel: Record<string, AgreementStats>;
  order: OrderConsistency;
  disagreements: JudgedPair[];
  note: string;
}

function groupBy<T>(xs: T[], key: (x: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const x of xs) (out[key(x)] ??= []).push(x);
  return out;
}
const mapValues = <T, U>(o: Record<string, T>, f: (v: T) => U) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)]));

export const MIN_DECISIONS_FOR_READING = 10;

export function qualityReport(allPairs: JudgedPair[], sampleMax = 200): QualityReport {
  const sample = samplePairs(allPairs, sampleMax);
  const overall = agreement(sample);
  const disagreements = sample
    .filter(p => p.logan && p.judgePrefers !== 'none' && (p.judgePrefers === 'candidate') !== (p.logan === 'accept'))
    .sort((a, b) => b.createdAt - a.createdAt).slice(0, 10);
  const note = overall.pairs === 0
    ? 'No judged change has an accept or reject decision from you yet.'
    : overall.conclusive < MIN_DECISIONS_FOR_READING
      ? `Only ${overall.conclusive} decided pair${overall.conclusive === 1 ? '' : 's'} where the judge picked a side; read the numbers as anecdotes until there are at least ${MIN_DECISIONS_FOR_READING}.`
      : '';
  return {
    totalJudged: allPairs.length, sampled: sample.length, sampleMax, overall,
    byJudgeModel: mapValues(groupBy(sample, p => p.judgeModel), agreement),
    byConsensus: mapValues(groupBy(sample, p => p.consensus), agreement),
    byLevel: mapValues(groupBy(sample, p => p.level), agreement),
    order: orderConsistency(sample), disagreements, note,
  };
}

/* ------------------------------------------------------------------------------------------------ */
/* Prompt versions                                                                                   */
/* ------------------------------------------------------------------------------------------------ */

export interface PromptOutcomeRow {
  promptVersion: string; candidates: number; gatesPassed: number; judged: number; loopAccepted: number;
  loganAccepted: number; loganRejected: number; pending: number;
}

/** Candidates grouped by the prompt version that produced them (revise, episode critique, polish). */
export function promptOutcomes(versions: ScriptVersion[]): PromptOutcomeRow[] {
  const rows = new Map<string, PromptOutcomeRow>();
  for (const v of versions) {
    const d = v.decision;
    if (!d || d.promptVersion === 'manual') continue;
    const r = rows.get(d.promptVersion) ?? { promptVersion: d.promptVersion, candidates: 0, gatesPassed: 0, judged: 0, loopAccepted: 0, loganAccepted: 0, loganRejected: 0, pending: 0 };
    r.candidates++;
    if (d.gates.failures.length === 0) r.gatesPassed++;
    if (d.judge) r.judged++;
    if (d.loopAccepted) r.loopAccepted++;
    if (d.loganDecision === 'accept') r.loganAccepted++;
    else if (d.loganDecision === 'reject') r.loganRejected++;
    else r.pending++;
    rows.set(d.promptVersion, r);
  }
  return [...rows.values()].sort((a, b) => a.promptVersion.localeCompare(b.promptVersion));
}

export interface LogEntry {
  at?: number; role?: string; label?: string; provider?: string; model?: string; promptVersion?: string;
  ok?: boolean; code?: string; durationMs?: number; inTok?: number; outTok?: number; costUsd?: number; message?: string;
}

export interface CallStatsRow {
  promptVersion: string; role: string; provider: string; model: string;
  calls: number; failures: number; failureCodes: Record<string, number>;
  avgMs: number; p90Ms: number; inTok: number; outTok: number; costUsd: number;
}

/** Call log entries grouped by prompt version, role and provider/model. */
export function callStats(entries: LogEntry[]): CallStatsRow[] {
  const groups = groupBy(entries, e => [e.promptVersion || 'unknown', e.role || '?', e.provider || '?', e.model || '?'].join('|'));
  return Object.entries(groups).map(([k, es]) => {
    const [promptVersion, role, provider, model] = k.split('|');
    const ms = es.map(e => Number(e.durationMs) || 0).sort((a, b) => a - b);
    const failureCodes: Record<string, number> = {};
    for (const e of es) if (e.ok === false) failureCodes[e.code || 'UNKNOWN'] = (failureCodes[e.code || 'UNKNOWN'] || 0) + 1;
    return {
      promptVersion, role, provider, model, calls: es.length, failures: es.filter(e => e.ok === false).length, failureCodes,
      avgMs: ms.length ? Math.round(ms.reduce((s, x) => s + x, 0) / ms.length) : 0,
      p90Ms: ms.length ? ms[Math.min(ms.length - 1, Math.floor(ms.length * 0.9))] : 0,
      inTok: es.reduce((s, e) => s + (Number(e.inTok) || 0), 0), outTok: es.reduce((s, e) => s + (Number(e.outTok) || 0), 0),
      costUsd: es.reduce((s, e) => s + (Number(e.costUsd) || 0), 0),
    };
  }).sort((a, b) => a.promptVersion.localeCompare(b.promptVersion) || a.role.localeCompare(b.role));
}

export interface LogSummary { runId: string; projectId: string | null; calls: number; failures: number; totalMs: number; costUsd: number; firstAt: number | null; lastAt: number | null }

export function summarizeLog(runId: string, projectId: string | null, entries: LogEntry[]): LogSummary {
  const ats = entries.map(e => Number(e.at)).filter(Number.isFinite);
  return {
    runId, projectId, calls: entries.length, failures: entries.filter(e => e.ok === false).length,
    totalMs: entries.reduce((s, e) => s + (Number(e.durationMs) || 0), 0), costUsd: entries.reduce((s, e) => s + (Number(e.costUsd) || 0), 0),
    firstAt: ats.length ? Math.min(...ats) : null, lastAt: ats.length ? Math.max(...ats) : null,
  };
}
