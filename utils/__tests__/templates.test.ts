import { describe, it, expect } from 'vitest';
import {
  generateIngestYaml,
  generateIngestScript,
  generateMonitorYaml,
  generateReadme,
  generateQueueFile,
  generateTestAudioYaml,
} from '../templates';
import { EnhancedConfig } from '../../types';
import { escapeYamlDoubleQuote, escapeYamlSingleQuote } from '../escape';
import { validateConfig } from '../validation';

const mockConfig: EnhancedConfig = {
  repoName: 'my-spaces-pipeline',
  ownerName: 'developer-user',
  podcastTitle: 'Tech "Talks" & Coding: Spaces',
  podcastDescription: 'Discussion of modern "AI" tools, pipelines\nand automated audio transcoding.',
  authorName: "John O'Connor",
  email: 'john@example.com',
  imageUrl: 'https://example.com/art.jpg',
  githubToken: 'ghp_fakeToken1234567890',
  artworkDataUrl: '',
  platforms: ['twitter', 'youtube'],
  batchUrls: ['https://x.com/i/spaces/12345', 'https://youtube.com/watch?v=abc'],
  enableTranscription: true,
  enableSlackWebhook: true,
  slackWebhookUrl: 'https://hooks.slack.com/services/T00/B00/X00',
  enableDiscordWebhook: true,
  discordWebhookUrl: 'https://discord.com/api/webhooks/123/abc',
  enableScheduledMonitoring: true,
  scheduledCron: '0 */4 * * *',
};

describe('Template Generation & Escaping Safety', () => {
  it('escapes quotes and newlines in YAML environment variables', () => {
    const yaml = generateIngestYaml(mockConfig);
    expect(yaml).toContain('name: Ingest Space');
    // Ensure raw quotes do not break the PODCAST_TITLE / PODCAST_DESC line
    expect(yaml).toContain(`PODCAST_TITLE: "${escapeYamlDoubleQuote(mockConfig.podcastTitle)}"`);
    expect(yaml).toContain(`PODCAST_DESC: "${escapeYamlDoubleQuote(mockConfig.podcastDescription)}"`);
    expect(yaml).not.toContain('PODCAST_TITLE: "Tech "Talks"');
  });

  it('escapes single quotes in cron schedules', () => {
    const monitorYaml = generateMonitorYaml(mockConfig);
    expect(monitorYaml).toContain("cron: '0 */4 * * *'");
    expect(monitorYaml).toContain('name: Monitor Batch Queue');
  });

  it('generates valid ingest bash script with LF line endings and safe flags', () => {
    const bash = generateIngestScript(mockConfig);
    expect(bash.startsWith('#!/bin/bash')).toBe(true);
    expect(bash).toContain('set -euo pipefail');
    expect(bash).not.toContain('\r\n');
  });

  it('formats batch queue text with newline delimiters', () => {
    const queue = generateQueueFile(mockConfig);
    expect(queue).toContain('https://x.com/i/spaces/12345\n');
    expect(queue).toContain('https://youtube.com/watch?v=abc\n');
  });

  it('generates test workflow containing required tool checks', () => {
    const testYaml = generateTestAudioYaml(mockConfig);
    expect(testYaml).toContain('name: Test Audio Tools');
    expect(testYaml).toContain('ffmpeg -version');
    expect(testYaml).toContain('yt-dlp --version');
  });

  it('generates comprehensive README with proper author attribution', () => {
    const readme = generateReadme(mockConfig);
    expect(readme).toContain(mockConfig.podcastTitle);
    expect(readme).toContain(`${mockConfig.authorName} · ${mockConfig.email}`);
  });
});

describe('Validation Engine', () => {
  it('validates a correct configuration with 0 errors', () => {
    const errors = validateConfig(mockConfig);
    expect(errors).toHaveLength(0);
  });

  it('catches invalid repository names and missing emails', () => {
    const badConfig: EnhancedConfig = {
      ...mockConfig,
      repoName: 'invalid repo name with spaces!',
      email: 'not-an-email',
      scheduledCron: 'invalid * cron',
    };
    const errors = validateConfig(badConfig);
    expect(errors.some((e) => e.field === 'repoName')).toBe(true);
    expect(errors.some((e) => e.field === 'email')).toBe(true);
    expect(errors.some((e) => e.field === 'scheduledCron')).toBe(true);
  });
});
