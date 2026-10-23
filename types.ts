export interface PipelineFile {
  path: string;
  name: string;
  language: 'yaml' | 'bash' | 'text' | 'markdown';
  content: (config: EnhancedConfig) => string;
  description: string;
}

export interface PipelineConfig {
  repoName: string;
  ownerName: string;
  podcastTitle: string;
  podcastDescription: string;
  authorName: string;
  email: string;
  imageUrl: string;
  githubToken: string;
  artworkDataUrl: string;
  platforms: string[];
  batchUrls: string[];
  enableTranscription: boolean;
  enableSlackWebhook: boolean;
  slackWebhookUrl: string;
  enableDiscordWebhook: boolean;
  discordWebhookUrl: string;
  enableScheduledMonitoring: boolean;
  scheduledCron: string;
  // Pipeline Settings (all optional; defaults live in DEFAULT_CONFIG)
  clipMinScore?: number;
  clipMaxLengthSec?: number;
  autoSuggestClips?: boolean;
  watchedHosts?: string[];
  ingestConcurrency?: number;
  audioFormat?: 'mp3' | 'm4a' | 'opus';
  strictMode?: boolean;
  transcriptionModel?: string;
  transcriptionLanguage?: string;
  keepRawRecordings?: boolean;
  cacheRetentionDays?: number; // 0 = keep forever
}

export type EnhancedConfig = PipelineConfig;

export interface ConfigProfile {
  id: string;
  name: string;
  config: EnhancedConfig;
  updatedAt: number;
}

export interface GitHubUser {
  login: string;
  name: string;
  avatar_url: string;
}

export interface WorkflowRun {
  id: number;
  name: string;
  display_title?: string;
  event?: string;
  head_branch?: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  updated_at: string;
  html_url: string;
  path: string;
  head_commit: { message: string } | null;
}

export interface ReleaseAsset {
  id: number;
  name: string;
  url?: string;
  browser_download_url: string;
  size: number;
  content_type: string;
}

export interface Release {
  id: number;
  tag_name: string;
  name: string;
  body: string | null;
  published_at: string;
  html_url: string;
  assets: ReleaseAsset[];
  draft: boolean;
  prerelease: boolean;
}

export interface EpisodePart {
  partNumber: number;
  label: string;
  mp3Asset: ReleaseAsset | null;
  transcriptAsset: ReleaseAsset | null;
}

export interface DeployStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'error';
  message?: string;
}

export interface VoiceProfile {
  name: string;
  role?: string;
  sample_count?: number;
  embedding?: number[];
  last_updated?: string;
  avatar_emoji?: string;
  color?: string;
  notes?: string;
  sample_audio_url?: string;
}

export interface DeadLetterJob {
  id: string;
  workflow: string;
  runId?: number;
  speakerName?: string;
  audioUrl?: string;
  failedAt: number;
  attempts: number;
  rootCause: string;
  logUrl?: string;
  diagnosticDetails?: string;
  status: 'quarantined' | 'retrying' | 'resolved';
}

export interface WorkflowDiagnostic {
  runId: number;
  workflowName: string;
  status: 'running' | 'healed' | 'quarantined' | 'failed' | 'success';
  healAttempts?: number;
  healedAt?: number;
  reason?: string;
  logUrl?: string;
}

export interface VoiceProfilesCatalog {
  version: string;
  updated_at: string;
  embedding_model: string;
  embedding_dim: number;
  profiles: Record<string, VoiceProfile>;
  dlq?: DeadLetterJob[];
}
