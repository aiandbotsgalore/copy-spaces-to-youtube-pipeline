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
}

export interface EnhancedConfig extends PipelineConfig {
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
}

export interface GitHubUser {
  login: string;
  name: string;
  avatar_url: string;
}

export interface WorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  updated_at: string;
  html_url: string;
  path: string;
  head_commit: { message: string };
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

export interface DeployStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'error';
  message?: string;
}
