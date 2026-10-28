// Script Studio data model (pure type module, like utils/directorTypes.ts).
// TIME CONVENTION: clip times are CLIP-RELATIVE. 0 = where the clip is meant to start.
// Models never write seconds for clips: they quote keptText and code computes inSec/outSec.

export type EpisodeFormat = 'narrative_doc' | 'investigative' | 'best_of' | 'interview'
  | 'thematic_multi' | 'commentary' | 'short_highlight';

export const EPISODE_FORMATS: EpisodeFormat[] = ['narrative_doc', 'investigative', 'best_of', 'interview', 'thematic_multi', 'commentary', 'short_highlight'];

export interface EvidenceRef {
  releaseTag: string; segStart: number; segEnd: number;   // episode-time provenance of the quote
  speaker: string; verbatim: string;                        // exact text from contiguous same-speaker segments
  quoteId?: string;                                         // investigative_knowledge_graph.json
}

export interface StudioClip {
  clipId: string; title: string; speaker: string; releaseTag: string;
  audioUrl: string; durationSec: number;      // probed (file duration or catalog window), clip-relative 0..durationSec
  text: string;
  episodeStartSec?: number;                   // provenance only; never sent to the reviser
  audioOffsetSec?: number;                    // where clip time 0 lies inside audioUrl (0 for a cut clip file)
  fn?: NarrativeFunction; fnRationale?: string;
}

export type NarrativeFunction = 'establish_question' | 'stakes' | 'complication' | 'evidence'
  | 'counterpoint' | 'reversal' | 'payoff' | 'button' | 'breather';

export const NARRATIVE_FUNCTIONS: NarrativeFunction[] = ['establish_question', 'stakes', 'complication', 'evidence', 'counterpoint', 'reversal', 'payoff', 'button', 'breather'];

export type MusicCue = 'sting' | 'bed_in' | 'bed_out' | 'transition';

export type BlockType = 'HEADING' | 'ARCHIVAL_CLIP' | 'CUE' | 'QUOTE_READ' | 'NARRATION';

export type Block =
  | {
      id: string; kind: 'narration'; text: string; mode: 'live' | 'polished'; claims: EvidenceRef[];
      locked?: boolean; takeUrl?: string; takeSec?: number; takeTextHash?: string;
      type?: 'NARRATION' | 'QUOTE_READ' | 'HEADING';
      readEvidence?: boolean;
      quoteSpeaker?: string;
      quoteMeta?: string;
    }
  | {
      id: string; kind: 'clip'; clipId: string;
      keptText: string;                         // model output: a contiguous excerpt of clip.text
      inSec: number; outSec: number;            // code output via trimResolver.resolveTrim, clip-relative
      trimBasis: 'segment' | 'silence' | 'estimated' | 'full';
      fn: NarrativeFunction; rationale: string; locked?: boolean; flag?: string;
      type?: 'ARCHIVAL_CLIP';
      clipNumber?: string;
      spaceTitle?: string;
      date?: string;
      time?: string;
      speaker?: string;
    }
  | {
      id: string; kind: 'pause'; sec: number; locked?: boolean;
      type?: 'CUE';
      cueType?: 'silence' | 'beat';
      label?: string;
    }
  | {
      id: string; kind: 'music'; cue: MusicCue; note: string; locked?: boolean;
      type?: 'CUE';
      cueType?: 'music' | 'theme';
    }
  | {
      id: string; kind: 'cue'; text?: string; note?: string; sec?: number; locked?: boolean;
      type?: 'CUE';
      cueType?: 'sfx' | 'theme' | 'production_note' | 'silence' | 'beat';
    }
  | {
      id: string; kind: 'heading'; text: string; sec?: number; locked?: boolean; level?: number;
      type?: 'HEADING';
    };
  // music = a labeled marker only; the app does no music mixing or sourcing, Logan handles music outside the app

export type BlockKind = Block['kind'];

export interface Scene { id: string; title: string; purpose: string; blocks: Block[]; suggestedClipIds?: string[]; momentIds?: string[] }
export interface Segment { id: string; title: string; scenes: Scene[]; notDrafted?: string }

export interface MomentInsight {
  id: string; releaseTag: string; start: number; end: number;
  kind: 'revelation' | 'disagreement' | 'turn' | 'humor' | 'emotional' | 'claim' | 'callback';
  why: string; themes: string[]; speakers: string[]; evidence: EvidenceRef[];
  utteranceIds: string[];
}
export interface EpisodeAnalysis {
  releaseTag: string; transcriptHash: string; promptVersion: string; provider: string; model: string;
  themes: { id: string; label: string; summary: string; momentIds: string[] }[];
  dynamics: { speaker: string; role: string; stance: string }[];
  moments: MomentInsight[]; openQuestions: string[];
  chunks: { index: number; ok: boolean; error?: string }[];
  createdAt: number;
}

export interface ScriptVersion {
  id: string; parentId: string | null; projectId: string; createdAt: number;
  author: 'logan' | 'loop' | 'grok_bot';
  label?: string;
  segments: Segment[];
  changedScope?: { level: 'scene' | 'segment' | 'episode'; ids: string[] };
  decision?: RefinementDecision;
}

export type FormatCriterion = 'curiosity' | 'momentum' | 'clarity' | 'pacing' | 'authenticity'
  | 'clip_choice' | 'resonance' | 'payoff' | 'fairness';

export interface Critique {
  id: string; versionId: string; level: 'scene' | 'segment' | 'episode'; targetId: string;
  issue: string; consequence: string; criterion: FormatCriterion;
  severity: 'blocker' | 'major' | 'minor'; proposedFix: string;
  structuralKind?: 'order' | 'arc' | 'payoff';                       // episode pass only
  proposedOrder?: { segmentId: string; sceneIds: string[] }[] | null; // episode pass only
}

export type JudgeWinner = 'A' | 'B' | 'tie';
export type JudgeConsensus = 'two_wins' | 'win_plus_tie_on_major' | 'rejected';

export interface GateResult {
  factual: 'pass' | 'fail'; faithful: 'pass' | 'fail'; locksIntact: boolean;
  clipBoundsOk: boolean; runtimeOk: boolean; failures: string[];
  factcheck?: { claim: string; label: 'supported' | 'overstated' | 'unsupported'; note: string }[];
}

export interface RefinementDecision {
  candidateId: string; baselineId: string; round: number; promptVersion: string;
  gates: GateResult;
  judge?: { provider: string; model: string; winnerAB: JudgeWinner; winnerBA: JudgeWinner;
            consensus: JudgeConsensus; reasons: string[]; promptVersion?: string };
  notJudged?: string;
  loopAccepted: boolean;                       // the loop's verdict
  reviewOnly?: string;                         // why this candidate never becomes the loop's best (structural moves, polish)
  loganDecision?: 'accept' | 'reject';         // final say
}

export interface StyleRule { rule: string; source: 'approved' | 'rejected' | 'explicit'; weight: number; addedAt?: number }
export interface DistillStatus {
  at: number; ok: boolean; message: string; decisions: number; promptVersion: string;
  provider?: string; model?: string; added?: number; kept?: number; removed?: number;
}
export interface EditorialMemory {
  styleRules: StyleRule[];
  approvedPassages: { text: string; projectId: string }[];
  rejectedRewrites: { before: string; after: string; reason: string }[];
  unresolved: { projectId: string; question: string }[];
  decisionsSinceDistill?: number;
  lastDistill?: DistillStatus;
  removedRules?: string[];                   // learned rules Logan removed; never re-learned
}

export interface StyleTrait { trait: string; examples: string[] }
export interface StyleCard {
  promptVersion: string; traitsPromptVersion: string; createdAt: number; provider: string; model: string; batchProvider: string; batchModel: string;
  live: { summary: string; traits: StyleTrait[] };
  polished: { summary: string; traits: StyleTrait[] };
  avoid: string[];
  stats: {
    recordingsScanned: number; recordingsWithLogan: number; segments: number; words: number; speakingMinutes: number;
    shareOfSpeech: number; wordsPerMinute: number; turns: number; meanTurnWords: number; medianTurnWords: number;
    meanSentenceWords: number; shortSentenceShare: number; questionShare: number;
    fillersPer100Words: Record<string, number>; topOpeners: { opener: string; share: number }[];
    signaturePhrases: { phrase: string; per10kWords: number; ratio: number }[];
    firstDate: string | null; lastDate: string | null;
  };
  sourceHash: string; narrationHash: string;
  coverage: {
    segmentsMeasured: number; recordingsWithLogan: number; recordingsScanned: number; turnsRead: number; recordingsRead: number;
    batches: number; batchesFailed: string[]; narrationFiles: string[]; examplesDropped: number; recordingTags: string[];
  };
  text: string;
}

export interface ScriptEvidenceDoc {
  id: string;
  name: string;
  type?: 'text' | 'markdown' | 'pdf' | 'notes';
  content: string;
  addedAt: number;
  sizeBytes?: number;
  sourceUrl?: string;
  source?: 'upload' | 'manual' | 'google_drive';
}

export interface ScriptProject {
  evidenceDocs?: ScriptEvidenceDoc[];
  googleDriveFolderUrl?: string;
  id: string; title: string; createdAt: number; updatedAt: number;
  format: EpisodeFormat | null; sourceTags: string[]; targetRuntimeSec: number;
  transcriptHashes: Record<string, string>;
  speakerNames: Record<string, string>;      // raw label -> display name (Logan's renames)
  clips: StudioClip[]; excludedClips: { clipId: string; reason: string }[];
  headVersionId: string | null;
  thesis?: string;
  sourceKeys?: Record<string, string>;       // releaseTag -> recording key (E1, E2...) in multi-recording prompts; never reused                           // thematic and investigative episodes: the question the episode answers
  clipTagsKey?: string;                      // analysis hash + clip-tags prompt version of the last tagging
}

export type RunStatus = 'queued' | 'running' | 'paused_limit' | 'interrupted' | 'cancelled' | 'failed' | 'finished';
export type StopReason = 'no_major_issues' | 'marginal_gains' | 'max_rounds' | 'budget' | 'cancelled' | 'error' | 'critique_only';
export type RunStage = 'scenes' | 'episode' | 'polish' | 'done';
export interface RunOptions { critiqueOnly?: boolean; episodePass?: boolean; polish?: boolean; spoken?: boolean }

export interface RunEvent {
  seq: number; at: number;
  type: 'status' | 'round' | 'call' | 'critique' | 'gates' | 'judge' | 'decision' | 'error' | 'finished';
  message: string;
  role?: string; provider?: string; model?: string; durationMs?: number; data?: unknown;
}

export interface ScriptRun {
  id: string; projectId: string; createdAt: number; updatedAt: number;
  status: RunStatus; stopReason?: StopReason;
  mode: 'subscription' | 'fallback';
  maxUsd: number; spentUsd: number;
  roleMap: RoleMap;
  baseVersionId: string; bestVersionId: string;
  currentRound: number; maxRounds: number; staleCount: number;
  targetSceneIds?: string[];
  refinedSceneIds: string[];
  candidateIds: string[];
  stage?: RunStage;                            // scene rounds, then the episode pass, then the optional polish
  options?: RunOptions;
  sceneStop?: { reason: StopReason; message: string };
  critiques?: Critique[];                      // the latest critiques (critique-only runs and the episode pass)
  pausedInfo?: { role: string; provider: string; code: string; message: string; at: number };
  error?: string;
  events: RunEvent[];
}

export type Role = 'analyst' | 'critic' | 'reviser' | 'judge' | 'factcheck' | 'polish';
export interface RoleMap { analyst: string; critic: string; reviser: string; judge: string; factcheck: string; polish?: string }
