export type CopilotActionType =
  | 'CREATE_CLIP'
  | 'TRIM_CLIP'
  | 'SEQUENCE_MONTAGE'
  | 'AUDITION_MONTAGE'
  | 'PLAY_AUDIO'
  | 'PAUSE_AUDIO'
  | 'SEEK_AUDIO'
  | 'UPDATE_CONFIG'
  | 'NAVIGATE_TAB'
  | 'LOAD_EPISODE'
  | 'SEARCH_TRANSCRIPTS'
  | 'ENQUEUE_SPACE'
  | 'DISPATCH_WORKFLOW'
  | 'GET_QUEUE'
  | 'GET_RUN_HISTORY'
  | 'GET_RUN_JOBS'
  | 'GET_VOICE_PROFILES'
  | 'GET_SCRIPT_PROJECTS'
  | 'INSPECT_KNOWLEDGE_GRAPH'
  | 'CREATE_PROJECT'
  | 'ANALYZE_PROJECT'
  | 'OUTLINE_PROJECT'
  | 'DRAFT_PROJECT'
  | 'REFINE_PROJECT'
  | 'SYNTHESIZE_VOX'
  | 'GET_TRANSCRIPT_GAPS'
  | 'DISPATCH_TRANSCRIPT_BACKFILL'
  | 'RENDER_AVATAR';

export type ActionTier = 0 | 1 | 2;

export type ActionExecutionStatus =
  | 'pending'
  | 'confirmed'
  | 'accepted'
  | 'running'
  | 'completed'
  | 'failed'
  | 'no_matches';

export interface ActionSnapshot {
  type: 'montage_clips' | 'config' | 'custom';
  timestamp: number;
  data: any;
}

export interface DocumentLocation {
  filePath: string;
  pageNumber?: number;
  lineNumber?: number;
  messageIndex?: number;
  displayText: string;
}

export interface DialogueTurn {
  speaker: string;
  text: string;
  start: number;
  end: number;
}

export interface TranscriptMatch {
  episode_id: string;
  episode_title: string;
  start_timestamp: number;
  end_timestamp: number;
  formatted_time: string; // e.g. "47:42" or "DM Exchange (Lines 1-4)"
  speaker: string;
  snippet: string;
  audio_url?: string;
  match_type?: string;
  relevance_score?: number;
  relevant_spans?: Array<{ start: number; end: number; score: number; text?: string }>;
  dialogue_window?: DialogueTurn[];
  chunk_id?: string;
  source_type?: string;
  source_classification?: string;
  content_nature?: string;
  document_location?: DocumentLocation;
}

export interface CopilotAction {
  id: string;
  action: CopilotActionType;
  params: Record<string, any>;
  explanation: string;
  tier?: ActionTier;
  applied?: boolean;
  appliedAt?: string;
  reverted?: boolean;
  status?: ActionExecutionStatus;
  matchCount?: number;
  snapshot?: ActionSnapshot;
  resultData?: Record<string, any>;
  errorMessage?: string;
  triggerSource?: 'user' | 'auto_apply' | 'palette' | 'chain';
  executionDurationMs?: number;
  analyzed?: boolean;
  activePhase?: string;
}

export interface CopilotMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  actions?: CopilotAction[];
  matches?: TranscriptMatch[];
  model?: string;
  usage?: { promptTokens: number; completionTokens: number };
}

export interface CopilotContextPayload {
  activeTab?: string;
  selectedText?: string;
  currentEpisode?: {
    releaseId?: number;
    releaseTag?: string;
    title?: string;
    audioUrl?: string;
    speakers?: string[];
    segmentsSample?: Array<{ speaker: string; text: string; start: number; end: number }>;
    allSegments?: Array<{ speaker: string; text: string; start: number; end: number }>;
    totalTurns?: number;
    durationSec?: number;
  };
  activeMontageClips?: Array<{
    id: string;
    title: string;
    quote: string;
    speaker: string;
    startSec: number;
    endSec: number;
    category?: string;
    tensionScore?: number;
  }>;
  configSummary?: Record<string, any>;
  clipCatalogSample?: Array<{
    title: string;
    speaker?: string;
    category?: string;
    viralScore?: number;
    startSec?: number;
    endSec?: number;
  }>;
  transcriptSearchResults?: Array<{
    episodeTitle: string;
    releaseTag: string;
    audioUrl?: string;
    episodeDate?: string;
    speaker: string;
    startSec: number;
    endSec: number;
    text: string;
    relevanceScore?: number;
    matchType?: string;
    relevantSpans?: Array<{ start: number; end: number; score: number; text?: string }>;
    dialogueWindow?: Array<{ speaker: string; text: string; start: number; end: number }>;
    chunkId?: string;
    sourceType?: string;
    sourceClassification?: string;
    contentNature?: string;
    documentLocation?: DocumentLocation;
  }>;
  archiveStats?: {
    totalEpisodes: number;
    totalTranscriptsOnDisk: number;
    allSpeakersSample: string[];
    voiceProfilesCatalog?: any;
  };
  compactStateSummary?: string;
  githubToken?: string;
  ownerName?: string;
  repoName?: string;
  inspectedRuns?: Record<number, InspectedRunEvidence>;
}

export interface InspectedRunEvidence {
  runId: number;
  name: string;
  conclusion: string;
  status?: string;
  headBranch?: string;
  createdAt?: string;
  htmlUrl?: string;
  failedJob?: string;
  failedStep?: string;
  errorExcerpt?: string;
  inspectedAt: string;
}

export interface CopilotRequestBody {
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  model?: string;
  context?: CopilotContextPayload;
}

export interface CopilotResponseBody {
  ok: boolean;
  text: string;
  actions: CopilotAction[];
  matches?: TranscriptMatch[];
  model: string;
  usage: { promptTokens: number; completionTokens: number };
  ms: number;
  error?: string;
  inspectedRuns?: Record<number, InspectedRunEvidence>;
}
