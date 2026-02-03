export interface PipelineFile {
  path: string;
  name: string;
  language: 'yaml' | 'bash' | 'text' | 'markdown';
  content: (config: PipelineConfig) => string;
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