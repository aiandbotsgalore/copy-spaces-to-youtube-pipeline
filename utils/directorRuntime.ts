/**
 * Orchestration for the Director: candidate preparation, three parallel cuts, refinement.
 * Network, probing and audio decoding are injected so this is unit-testable without a browser.
 */
import type {
  ClipLike,
  CutId,
  DirectorCandidate,
  DirectorErrorCode,
  DirectorRequest,
  DirectorResult,
  DirectorUsage,
} from './directorTypes';
import { CUT_IDS, ARCHETYPES, targetForCut } from './directorProfile';
import { describeNoCandidates, prepareCandidates } from './directorCandidates';
import type { CandidateStats } from './directorCandidates';
import { applyOps } from './directorValidate';
import { cutToClips, hashPrompt, resolvePendingTrims, toCurrentItems } from './directorApply';
import { buildSequencePlan } from './sequencePlan';
import type { TrimDeps } from './trimResolver';

export interface RuntimeDeps {
  call: (req: DirectorRequest, signal?: AbortSignal) => Promise<DirectorResult>;
  probe: (url: string) => Promise<number | null>;
  trim: TrimDeps;
}

export interface PoolOptions {
  isBlacklisted: (key: string) => boolean;
  hardExcludePhrase: string;
  escalationWeight?: (category?: string) => number;
  cap?: number;
}

export type CutOutcome<T extends ClipLike> =
  | {
      ok: true;
      cutId: CutId;
      title: string;
      tagline: string;
      clips: T[];
      runtimeSec: number;
      targetSec: number;
      warnings: string[];
      model: string;
      usage: DirectorUsage;
    }
  | { ok: false; cutId: CutId; code: DirectorErrorCode; message: string };

export interface GenerateAllResult<T extends ClipLike> {
  ok: true;
  outcomes: Record<CutId, CutOutcome<T>>;
  byId: Record<string, T>;
  candidates: DirectorCandidate[];
  stats: CandidateStats;
  promptHash: string;
}
export interface RuntimeFail {
  ok: false;
  code: DirectorErrorCode | 'NO_CANDIDATES';
  message: string;
  stats?: CandidateStats;
}

export async function generateCuts<T extends ClipLike>(
  args: {
    pool: T[];
    userPrompt: string;
    targetSec: number;
    defaultGapSec: number;
    model?: string;
    signal?: AbortSignal;
  } & PoolOptions,
  deps: RuntimeDeps
): Promise<GenerateAllResult<T> | RuntimeFail> {
  const prep = await prepareCandidates(args.pool, {
    isBlacklisted: args.isBlacklisted,
    hardExcludePhrase: args.hardExcludePhrase,
    userPrompt: args.userPrompt,
    cap: args.cap,
    probe: deps.probe,
    escalationWeight: args.escalationWeight,
  });
  if (prep.candidates.length === 0) {
    return { ok: false, code: 'NO_CANDIDATES', message: describeNoCandidates(prep.stats), stats: prep.stats };
  }
  const promptHash = hashPrompt(args.userPrompt);

  const results = await Promise.all(
    CUT_IDS.map(async (cutId): Promise<CutOutcome<T>> => {
      const targetSec = targetForCut(cutId, args.targetSec);
      const res = await deps.call(
        {
          mode: 'generate',
          cutId,
          userPrompt: args.userPrompt,
          targetWindowSec: targetSec,
          candidates: prep.candidates,
          model: args.model,
        },
        args.signal
      );
      if (res.ok === false) return { ok: false, cutId, code: res.code, message: res.message };
      if (res.mode !== 'generate') return { ok: false, cutId, code: 'BAD_OUTPUT', message: 'Unexpected response type.' };
      const { clips, notes } = await cutToClips(res.cut, prep.byId, { cutId, model: res.model, promptHash }, deps.trim);
      if (clips.length === 0) return { ok: false, cutId, code: 'BAD_OUTPUT', message: 'The cut contained no usable clips.' };
      const runtimeSec = buildSequencePlan(clips, args.defaultGapSec).totalSec;
      return {
        ok: true,
        cutId,
        title: res.cut.title || ARCHETYPES[cutId].title,
        tagline: res.cut.tagline,
        clips,
        runtimeSec,
        targetSec,
        warnings: [...res.warnings, ...notes],
        model: res.model,
        usage: res.usage,
      };
    })
  );

  const outcomes = {} as Record<CutId, CutOutcome<T>>;
  results.forEach(r => {
    outcomes[r.cutId] = r;
  });
  return { ok: true, outcomes, byId: prep.byId, candidates: prep.candidates, stats: prep.stats, promptHash };
}

export interface RefineOk<T extends ClipLike> {
  ok: true;
  clips: T[];
  summary: string;
  changelog: string[];
  rejected: string[];
  warnings: string[];
  model: string;
  usage: DirectorUsage;
}

export async function refineTimeline<T extends ClipLike>(
  args: {
    cutId: CutId;
    clips: T[];
    pool: T[];
    userPrompt: string;
    instruction: string;
    targetSec: number;
    defaultGapSec: number;
    model?: string;
    signal?: AbortSignal;
  } & PoolOptions,
  deps: RuntimeDeps
): Promise<RefineOk<T> | RuntimeFail> {
  const prep = await prepareCandidates(args.pool, {
    isBlacklisted: args.isBlacklisted,
    hardExcludePhrase: args.hardExcludePhrase,
    userPrompt: `${args.userPrompt} ${args.instruction}`.trim(),
    cap: args.cap,
    probe: deps.probe,
    escalationWeight: args.escalationWeight,
  });

  const current = toCurrentItems(args.clips, args.defaultGapSec);
  const res = await deps.call(
    {
      mode: 'refine',
      cutId: args.cutId,
      userPrompt: args.userPrompt,
      instruction: args.instruction,
      targetWindowSec: args.targetSec,
      candidates: prep.candidates,
      current,
      model: args.model,
    },
    args.signal
  );
  if (res.ok === false) return { ok: false, code: res.code, message: res.message };
  if (res.mode !== 'refine') return { ok: false, code: 'BAD_OUTPUT', message: 'Unexpected response type.' };

  const byId: Record<string, T> = { ...prep.byId };
  args.clips.forEach(c => {
    byId[c.id] = c;
  });
  const applied = applyOps(args.clips, res.refine.ops, {
    byId,
    provenance: { cutId: args.cutId, model: res.model, promptHash: hashPrompt(args.userPrompt) },
  });
  const trimmed = await resolvePendingTrims(applied.clips, applied.pendingTrims, deps.trim);
  return {
    ok: true,
    clips: trimmed.clips,
    summary: res.refine.summary,
    changelog: applied.changelog,
    rejected: [...applied.rejected, ...trimmed.notes],
    warnings: res.warnings,
    model: res.model,
    usage: res.usage,
  };
}
