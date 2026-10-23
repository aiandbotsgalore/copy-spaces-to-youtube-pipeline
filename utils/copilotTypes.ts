export type CopilotActionType =
  | 'CREATE_CLIP'
  | 'TRIM_CLIP'
  | 'SEQUENCE_MONTAGE'
  | 'PLAY_AUDIO'
  | 'UPDATE_CONFIG'
  | 'NAVIGATE_TAB'
  | 'AUDITION_MONTAGE'
  | 'SEARCH_TRANSCRIPTS'
  | 'LOAD_EPISODE';

export interface TranscriptMatch {
  episode_id: string;
  episode_title: string;
  start_timestamp: number;
  end_timestamp: number;
  formatted_time: string; // e.g. "47:42"
  speaker: string;
  snippet: string;
  audio_url?: string;
  match_type?: string;
  relevance_score?: number;
}

export interface CopilotAction {
  id: string;
  action: CopilotActionType;
  params: Record<string, any>;
  explanation: string;
  applied?: boolean;
  appliedAt?: string;
  reverted?: boolean;
  status?: 'running' | 'completed' | 'no_matches' | 'applied' | 'pending';
  matchCount?: number;
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
  }>;
  archiveStats?: {
    totalEpisodes: number;
    totalTranscriptsOnDisk: number;
    allSpeakersSample: string[];
  };
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
}
