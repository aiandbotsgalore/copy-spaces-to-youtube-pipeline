import { EnhancedConfig } from '../types';
import { GitHubApiError } from './github';

export type SubmitAction = 'run' | 'queue' | 'upload' | string;

export interface LocalAudioMetadata {
  title: string;
  speakers: string;
  recordedDate: string; // YYYY-MM-DD
  description: string;
  durationFormatted?: string; // HH:MM:SS
}

export interface StagedLocalReleasePayload {
  sourceId: string;
  releaseTag: string;
  episodeDateCompact: string;
  assetName: string;
  contentType: string;
  releaseName: string;
  releaseBody: string;
}

export function validateSubmission(url: string, config: EnhancedConfig): string | null {
  if (!url.trim()) return 'Enter a Space or audio URL first.';
  if (!config.githubToken) return 'Connect GitHub before submitting a URL.';
  if (!config.ownerName || !config.repoName) {
    return 'Add the GitHub owner and repository name in Configuration before submitting.';
  }
  return null;
}

export function validateLocalUpload(
  file: File | null,
  meta: LocalAudioMetadata,
  config: EnhancedConfig
): string | null {
  if (!file) return 'Select an audio file from your computer first.';
  if (!meta.title.trim()) return 'Enter an Episode Title before uploading.';
  if (!meta.speakers.trim()) return 'Enter the Host or Speakers for this episode.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.recordedDate.trim())) {
    return 'Select a valid Recording Date (YYYY-MM-DD).';
  }
  if (!config.githubToken) return 'Connect GitHub before uploading an audio file.';
  if (!config.ownerName || !config.repoName) {
    return 'Add the GitHub owner and repository name in Configuration before uploading.';
  }
  return null;
}

/**
 * Generates a deterministic alphanumeric source ID (e.g. local_8f3a92b1c4)
 * from the file attributes and episode date/title to prevent duplicate uploads.
 */
export function computeDeterministicSourceId(file: File, meta: LocalAudioMetadata): string {
  const raw = `${meta.recordedDate.trim()}|${meta.title.trim().toLowerCase()}|${file.name}|${file.size}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  const part1 = (h1 >>> 0).toString(36).padStart(6, '0').slice(0, 6);
  const part2 = (h2 >>> 0).toString(36).padStart(4, '0').slice(0, 4);
  return `local_${part1}${part2}`;
}

export function formatSecondsToDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '00:00:00';
  const secs = Math.round(totalSeconds);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function probeBrowserAudioDuration(file: File): Promise<string> {
  return new Promise(resolve => {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') {
      resolve('00:00:00');
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    const audio = new Audio();
    let settled = false;

    const finish = (dur: string) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(objectUrl);
      resolve(dur);
    };

    const timer = setTimeout(() => finish('00:00:00'), 5000);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      clearTimeout(timer);
      finish(formatSecondsToDuration(audio.duration));
    };
    audio.onerror = () => {
      clearTimeout(timer);
      finish('00:00:00');
    };
    audio.src = objectUrl;
  });
}

export function buildLocalReleasePayload(
  file: File,
  meta: LocalAudioMetadata
): StagedLocalReleasePayload {
  const title = meta.title.trim();
  const speakers = meta.speakers.trim();
  const recordedDate = meta.recordedDate.trim();
  const episodeDateCompact = recordedDate.replace(/-/g, '');
  const description = meta.description.trim();
  const duration = meta.durationFormatted && meta.durationFormatted !== '00:00:00'
    ? meta.durationFormatted
    : '00:00:00';

  const sourceId = computeDeterministicSourceId(file, meta);
  const releaseTag = `${episodeDateCompact}_${sourceId}`;

  const extMatch = file.name.match(/\.([a-zA-Z0-9]{2,5})$/);
  const ext = extMatch ? extMatch[1].toLowerCase() : 'mp3';
  const safeTitle = title
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'Episode';

  const assetName = `${episodeDateCompact}_${sourceId}_${safeTitle}.${ext}`;
  const contentType = file.type || (ext === 'mp3' ? 'audio/mpeg' : 'application/octet-stream');

  const bodyLines = [
    `- **Title:** ${title}`,
    `- **Space Title:** ${title}`,
    `- **Host:** ${speakers}`,
    `- **Speakers:** ${speakers}`,
    `- **Recorded:** ${recordedDate}`,
    `- **Duration:** ${duration}`,
    `- **Processed:** ${releaseTag}`,
    `- **Source:** Local Audio Upload (${file.name})`,
    `- **Source ID:** ${sourceId}`,
    `- **Space ID:** ${sourceId}`,
    '',
  ];

  if (description) {
    bodyLines.push(description, '');
  }

  bodyLines.push(
    '---',
    `METADATA::DURATION::${duration}`,
    `METADATA::SOURCE_ID::${sourceId}`,
    `METADATA::EPISODE_DATE::${episodeDateCompact}`,
    `METADATA::SPEAKERS::${speakers}`,
    'METADATA::YOUTUBE_STATUS::UNLISTED'
  );

  return {
    sourceId,
    releaseTag,
    episodeDateCompact,
    assetName,
    contentType,
    releaseName: title,
    releaseBody: bodyLines.join('\n'),
  };
}

export function friendlyGitHubError(error: unknown, action: SubmitAction): string {
  if (error instanceof GitHubApiError) {
    if (error.status === 401) return 'GitHub rejected the connection. Reconnect with a valid token and try again.';
    if (error.status === 403) return 'GitHub denied this action. Check that the token has repository and workflow permissions.';
    if (error.status === 404) {
      return action === 'run' || action === 'upload'
        ? 'The repository or ingest workflow was not found. Check the owner/repo and confirm that .github/workflows/ingest.yml exists.'
        : 'The repository or its default branch was not found. Check the owner and repository settings.';
    }
    if (error.status === 422) {
      return action === 'run' || action === 'upload'
        ? 'GitHub could not start the workflow. Check its workflow_dispatch input and default branch.'
        : 'GitHub could not update the queue on the configured branch. Reload and try again.';
    }
    return `GitHub could not complete the request. ${error.message}`;
  }
  if (error instanceof Error) return error.message;
  return 'GitHub could not complete the request. Try again.';
}
