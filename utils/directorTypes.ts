/**
 * Shared types for the AI Prompt Director.
 * Pure type module: no runtime imports, safe for the Vite server config, the browser and tests.
 */

export type CutId = 'cut_a' | 'cut_b' | 'cut_c';

export interface DirectorProvenance {
  cutId: CutId;
  model: string;
  promptHash: string;
}

/** Structural clip shape used by all pure Director utilities (MontageClipItem is assignable to this). */
export interface ClipLike {
  id: string;
  title?: string;
  quote: string;
  speaker: string;
  sourceTitle?: string;
  sourceTag?: string;
  sourceDate?: string;
  audioUrl?: string;
  startSec: number;
  endSec: number;
  category?: string;
  severity?: number;
  quoteId?: string;
  status?: string;
  isExcluded?: boolean;
  // Director / trim bookkeeping (all optional so old saved timelines still load)
  origStartSec?: number;
  origEndSec?: number;
  sourceDurationSec?: number;
  episodeStartSec?: number;
  episodeEndSec?: number;
  windowVerified?: boolean;
  windowPlaceholder?: boolean;
  gapAfterSec?: number;
  directorNote?: string;
  tensionScore?: number;
  locked?: boolean;
  trimBasis?: 'segment' | 'silence' | 'estimated' | 'manual';
  keptText?: string;
  director?: DirectorProvenance;
}

/** What the LLM sees. Durations are REAL (probed), never placeholders. */
export interface DirectorCandidate {
  id: string;
  quoteId?: string;
  speaker: string;
  category?: string;
  sourceDate?: string;
  sourceTitle: string;
  status: 'EXISTS' | 'READY_FOR_EXTRACTION';
  durationSec: number;
  text: string;
  textTruncated: boolean;
}

/** LLM output per clip. No durations, no timestamps. */
export interface DirectorPick {
  clipId: string;
  keptText?: string;
  gapAfterSec: number;
  tensionScore: number;
  note: string;
}

export interface DirectorCutResponse {
  cutId: CutId;
  title: string;
  tagline: string;
  picks: DirectorPick[];
}

export type DirectorOp =
  | { op: 'drop'; clipId: string }
  | { op: 'move'; clipId: string; toIndex: number }
  | { op: 'trim'; clipId: string; keptText: string }
  | { op: 'setGap'; clipId: string; gapAfterSec: number }
  | { op: 'insert'; clipId: string; atIndex: number; gapAfterSec?: number; note?: string }
  | { op: 'replace'; clipId: string; withClipId: string }
  | { op: 'setNote'; clipId: string; note: string };

export interface DirectorRefineResponse {
  ops: DirectorOp[];
  summary: string;
}

export type DirectorErrorCode =
  | 'NO_KEY'
  | 'UNAUTHORIZED'
  | 'RATE_LIMIT'
  | 'TIMEOUT'
  | 'UPSTREAM'
  | 'MODEL_NOT_FOUND'
  | 'BAD_OUTPUT'
  | 'BAD_REQUEST'
  | 'NO_CANDIDATES'
  | 'FORBIDDEN_ORIGIN'
  | 'SERVER_UNAVAILABLE'
  | 'ABORTED';

/** One clip of the timeline as shown to the LLM during refinement. */
export interface DirectorCurrentItem {
  index: number;
  clipId: string;
  text: string;
  textTruncated?: boolean;
  startSec: number;
  endSec: number;
  durationSec: number;
  gapAfterSec: number;
  tensionScore?: number;
  note?: string;
  locked: boolean;
}

export interface DirectorRequestBase {
  cutId: CutId;
  userPrompt: string;
  targetWindowSec: number;
  candidates: DirectorCandidate[];
  model?: string;
}
export interface DirectorGenerateRequest extends DirectorRequestBase {
  mode: 'generate';
}
export interface DirectorRefineRequest extends DirectorRequestBase {
  mode: 'refine';
  instruction: string;
  current: DirectorCurrentItem[];
}
export type DirectorRequest = DirectorGenerateRequest | DirectorRefineRequest;

export interface DirectorUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface DirectorGenerateOk {
  ok: true;
  mode: 'generate';
  cut: DirectorCutResponse;
  warnings: string[];
  usage: DirectorUsage;
  model: string;
  ms: number;
}
export interface DirectorRefineOk {
  ok: true;
  mode: 'refine';
  refine: DirectorRefineResponse;
  warnings: string[];
  usage: DirectorUsage;
  model: string;
  ms: number;
}
export interface DirectorFail {
  ok: false;
  code: DirectorErrorCode;
  message: string;
  retryAfterSec?: number;
}
export type DirectorResult = DirectorGenerateOk | DirectorRefineOk | DirectorFail;

export interface DirectorStatus {
  keyConfigured: boolean;
  keySource: 'env' | 'none';
  model: string;
  baseUrl: string;
}
