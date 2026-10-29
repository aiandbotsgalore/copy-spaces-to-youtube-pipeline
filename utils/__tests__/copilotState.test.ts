import { describe, it, expect } from 'vitest';
import { buildCompactStateSummary, MAX_STATE_SUMMARY_CHARS } from '../copilotState';

describe('Copilot Compact State Summary', () => {
  it('builds compact summary within strict character/token budget', () => {
    const summary = buildCompactStateSummary({
      activePanel: 'transcripts',
      player: {
        isPlaying: true,
        current: { title: 'Episode 42: Future of Autonomous Coding', id: 'ep_42' },
        currentTime: 125.4,
        duration: 3600,
      },
      montage: {
        clipCount: 4,
        totalDurationSec: 58.4,
        targetDurationSec: 60,
        isAuditioning: false,
      },
      queue: {
        batchCount: 3,
        spaceCount: 0,
        hasGithubAuth: true,
      },
      workflows: {
        totalRuns: 45,
        activeRuns: 1,
        failedRuns: 2,
      },
      scriptStudio: {
        projectCount: 2,
      },
      voiceProfiles: {
        profileCount: 12,
      },
      config: {
        enableTranscription: true,
        enableScheduledMonitoring: false,
        enableDiscordWebhook: true,
        enableSlackWebhook: false,
        hasGithubToken: true,
        targetRepo: 'owner/spaces-archive',
      },
      timestamp: '2026-10-28T12:00:00.000Z',
    });

    expect(summary.length).toBeLessThanOrEqual(MAX_STATE_SUMMARY_CHARS);
    expect(summary).toContain('TIMESTAMP: 2026-10-28T12:00:00.000Z');
    expect(summary).toContain('ACTIVE_VIEW: transcripts');
    expect(summary).toContain('AUDIO_PLAYER: playing');
    expect(summary).toContain('MONTAGE_REEL: 4 clips, 58.4s');
    expect(summary).toContain('QUEUE: batch_queue=3, space_queue=0 (github=connected)');
    expect(summary).toContain('WORKFLOWS: total=45, active=1, failed=2');
    expect(summary).toContain('SCRIPT_STUDIO: projects=2');
    expect(summary).toContain('VOICE_PROFILES: enrolled=12');
    expect(summary).toContain('SECRETS REDACTED');
  });

  it('strictly distinguishes unavailable from empty (0)', () => {
    const summary = buildCompactStateSummary({
      queue: {
        batchCount: 'unavailable',
        spaceCount: 0,
        hasGithubAuth: false,
      },
      workflows: {
        totalRuns: 'unavailable',
        activeRuns: 'unavailable',
        failedRuns: 0,
      },
    });

    expect(summary).toContain('batch_queue=unavailable');
    expect(summary).toContain('space_queue=0');
    expect(summary).toContain('github=no_auth');
    expect(summary).toContain('total=unavailable');
    expect(summary).toContain('failed=0');
  });

  it('never leaks github token or credential strings', () => {
    const summary = buildCompactStateSummary({
      config: {
        hasGithubToken: true,
        targetRepo: 'my-org/my-spaces',
      },
    });

    expect(summary).not.toContain('ghp_');
    expect(summary).not.toContain('githubToken');
    expect(summary).toContain('token=present');
  });
});
