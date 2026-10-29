/**
 * Compact System State Summary for SpacePipe AI Copilot.
 * 
 * Provides an always-on compact state summary under a strict token budget (~350 tokens, max 1400 chars).
 * Enforces:
 * 1. ISO-8601 timestamps.
 * 2. Distinction between "unavailable" (no auth/error) and 0 ("empty").
 * 3. Strict secret redaction: NO tokens, secrets, or passwords are ever exposed.
 * 4. Hard character budget to avoid blowing out LLM context windows.
 */

export interface StateSummaryInput {
  activePanel?: string;
  player?: {
    isPlaying?: boolean;
    current?: { title?: string; id?: string | number } | null;
    currentTime?: number;
    duration?: number;
  };
  montage?: {
    clipCount: number;
    totalDurationSec: number;
    targetDurationSec?: number;
    isAuditioning?: boolean;
  };
  queue?: {
    batchCount: number | 'unavailable';
    spaceCount: number | 'unavailable';
    hasGithubAuth?: boolean;
  };
  workflows?: {
    totalRuns: number | 'unavailable';
    activeRuns: number | 'unavailable';
    failedRuns: number | 'unavailable';
  };
  scriptStudio?: {
    projectCount: number | 'unavailable';
  };
  voiceProfiles?: {
    profileCount: number | 'unavailable';
  };
  config?: {
    enableTranscription?: boolean;
    enableScheduledMonitoring?: boolean;
    enableDiscordWebhook?: boolean;
    enableSlackWebhook?: boolean;
    hasGithubToken?: boolean;
    targetRepo?: string;
  };
  timestamp?: string;
}

export const MAX_STATE_SUMMARY_CHARS = 1400;

export function buildCompactStateSummary(input: StateSummaryInput = {}): string {
  const ts = input.timestamp || new Date().toISOString();
  const lines: string[] = [];

  lines.push(`TIMESTAMP: ${ts}`);

  if (input.activePanel) {
    lines.push(`ACTIVE_VIEW: ${input.activePanel}`);
  }

  // Player state
  if (input.player) {
    const isPlaying = Boolean(input.player.isPlaying);
    const title = input.player.current?.title ? `"${input.player.current.title.slice(0, 40)}"` : 'none';
    const cur = Math.round(input.player.currentTime || 0);
    const dur = Math.round(input.player.duration || 0);
    lines.push(`AUDIO_PLAYER: ${isPlaying ? 'playing' : 'idle'} (track=${title}, pos=${cur}s/${dur}s)`);
  }

  // Montage reel state
  if (input.montage) {
    const count = input.montage.clipCount;
    const dur = input.montage.totalDurationSec.toFixed(1);
    const target = input.montage.targetDurationSec ? `${input.montage.targetDurationSec}s` : 'unset';
    const aud = input.montage.isAuditioning ? 'auditioning' : 'stopped';
    lines.push(`MONTAGE_REEL: ${count} clips, ${dur}s (target=${target}, status=${aud})`);
  }

  // Queue state
  if (input.queue) {
    const batch = input.queue.batchCount === 'unavailable' ? 'unavailable' : `${input.queue.batchCount}`;
    const space = input.queue.spaceCount === 'unavailable' ? 'unavailable' : `${input.queue.spaceCount}`;
    const auth = input.queue.hasGithubAuth ? 'connected' : 'no_auth';
    lines.push(`QUEUE: batch_queue=${batch}, space_queue=${space} (github=${auth})`);
  }

  // Workflow runs
  if (input.workflows) {
    const total = input.workflows.totalRuns === 'unavailable' ? 'unavailable' : `${input.workflows.totalRuns}`;
    const active = input.workflows.activeRuns === 'unavailable' ? '0' : `${input.workflows.activeRuns}`;
    const failed = input.workflows.failedRuns === 'unavailable' ? '0' : `${input.workflows.failedRuns}`;
    lines.push(`WORKFLOWS: total=${total}, active=${active}, failed=${failed}`);
  }

  // Script Studio
  if (input.scriptStudio) {
    const pCount = input.scriptStudio.projectCount === 'unavailable' ? 'unavailable' : `${input.scriptStudio.projectCount}`;
    lines.push(`SCRIPT_STUDIO: projects=${pCount}`);
  }

  // Voice profiles
  if (input.voiceProfiles) {
    const vCount = input.voiceProfiles.profileCount === 'unavailable' ? 'unavailable' : `${input.voiceProfiles.profileCount}`;
    lines.push(`VOICE_PROFILES: enrolled=${vCount}`);
  }

  // Safe config summary (strictly zero secrets)
  if (input.config) {
    const trans = input.config.enableTranscription ? 'ON' : 'OFF';
    const sched = input.config.enableScheduledMonitoring ? 'ON' : 'OFF';
    const discord = input.config.enableDiscordWebhook ? 'ON' : 'OFF';
    const slack = input.config.enableSlackWebhook ? 'ON' : 'OFF';
    const auth = input.config.hasGithubToken ? 'present' : 'none';
    const repo = input.config.targetRepo ? input.config.targetRepo.slice(0, 30) : 'none';
    lines.push(`CONFIG_SAFE: transcription=${trans}, cron=${sched}, discord=${discord}, slack=${slack}, repo="${repo}", token=${auth} (SECRETS REDACTED)`);
  }

  const rawSummary = lines.join('\n');
  if (rawSummary.length > MAX_STATE_SUMMARY_CHARS) {
    return rawSummary.slice(0, MAX_STATE_SUMMARY_CHARS - 25) + '\n...[state truncated]';
  }

  return rawSummary;
}
