import { describe, it, expect } from 'vitest';
import {
  generateIngestYaml,
  generateIngestScript,
  generateMonitorYaml,
  generateReadme,
  generateQueueFile,
  generateTestAudioYaml,
} from '../templates';
import { buildPythonRSSScript } from '../templates/pythonRss';
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
  it('escapes quotes, newlines, and ${{ expressions in YAML environment variables', () => {
    const maliciousConfig: EnhancedConfig = {
      ...mockConfig,
      podcastTitle: 'Hack "Space" ${{ secrets.GITHUB_TOKEN }}',
      podcastDescription: 'Line 1\nLine 2 ${{ env.LEAK }}',
    };
    const yaml = generateIngestYaml(maliciousConfig);
    expect(yaml).toContain('name: Ingest Space');
    expect(yaml).toContain(`PODCAST_TITLE: "${escapeYamlDoubleQuote(maliciousConfig.podcastTitle)}"`);
    expect(yaml).toContain(`PODCAST_DESC: "${escapeYamlDoubleQuote(maliciousConfig.podcastDescription)}"`);
    expect(yaml).not.toContain('PODCAST_TITLE: "Hack "Space"');
    // Ensure raw ${{ is escaped with ${{ '${{' }}
    expect(yaml).toContain("${{ '${{' }} secrets.GITHUB_TOKEN }}");
    expect(yaml).toContain("${{ '${{' }} env.LEAK }}");
  });

  it('escapes single quotes and ${{ expressions in cron schedules', () => {
    const maliciousCronConfig: EnhancedConfig = {
      ...mockConfig,
      scheduledCron: "0 */2 * * *' ${{ secrets.TOKEN }}",
    };
    const monitorYaml = generateMonitorYaml(maliciousCronConfig);
    expect(monitorYaml).toContain("cron: '0 */2 * * *'' ${{ '${{' }} secrets.TOKEN }}'");
    expect(monitorYaml).toContain('name: Monitor Batch Queue');
    expect(monitorYaml).toContain('gh workflow run ingest.yml -f space_url="$NEXT_URL"');
  });

  it('generates valid ingest bash script with LF line endings and safe flags', () => {
    const bash = generateIngestScript(mockConfig);
    expect(bash.startsWith('#!/bin/bash')).toBe(true);
    expect(bash).toContain('set -euo pipefail');
    expect(bash).not.toContain('\r\n');
    // Checks that delimiter format is used for GITHUB_OUTPUT
    expect(bash).toContain('space_title<<$DELIM');
    // Checks that space_queue.txt is prioritized if non-empty
    expect(bash).toContain('if [[ -f "space_queue.txt" ]]');
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

  it('generates comprehensive README with single-line safe title and author attribution', () => {
    const multilineTitleConfig: EnhancedConfig = {
      ...mockConfig,
      podcastTitle: 'My Podcast\nLine 2',
      authorName: 'Jane\nSmith',
    };
    const readme = generateReadme(multilineTitleConfig);
    expect(readme).toContain('# My Podcast Line 2 — SpacePipe');
    expect(readme).toContain('Jane Smith · john@example.com');
    expect(readme).not.toContain('# My Podcast\nLine 2');
  });

  it('prevents script injection in ingest.yml run steps', () => {
    const yaml = generateIngestYaml(mockConfig);
    // MP3 path duration check must pass via env rather than inline expression
    expect(yaml).toContain('MP3_PATH: ${{ steps.process.outputs.mp3_path }}');
    expect(yaml).toContain('"$MP3_PATH"');
    expect(yaml).not.toContain('"${{ steps.process.outputs.mp3_path }}"');

    // Transcription dispatch must pass release_tag via env
    expect(yaml).toContain('RELEASE_TAG: ${{ steps.process.outputs.release_tag }}');
    expect(yaml).toContain('release_tag="$RELEASE_TAG"');
    expect(yaml).not.toContain('release_tag="${{ steps.process.outputs.release_tag }}"');

    // Slack and Discord notification must use python json.dumps
    expect(yaml).toContain('json.dumps({"text":');
    expect(yaml).toContain('json.dumps({"content":');

    // Heredoc PYEOF must not be indented
    expect(yaml).toContain('\nPYEOF\n');
  });

  it('generates Python RSS script starting at column 0 without unexpected indentation', () => {
    const pythonScript = buildPythonRSSScript();
    const lines = pythonScript.split('\n');
    expect(lines[0].startsWith('import ')).toBe(true);
    expect(lines[0].startsWith(' ')).toBe(false);
    expect(pythonScript).toContain('def xml_text(');
    expect(pythonScript).toContain('def xml_attr(');
    expect(pythonScript).toContain('<?xml version="1.0" encoding="UTF-8"?>');
  });

  it("enforces multi-feed RSS isolation and repository script priority", () => {
    const yaml = generateIngestYaml(mockConfig);
    expect(yaml).toContain("scripts/generate_rss.py --all");

    const pythonScript = buildPythonRSSScript();
    expect(pythonScript).toContain("podcast_archive.xml");
    expect(pythonScript).toContain("podcast.xml");
    expect(pythonScript).toContain("(11 * 3600 + 58 * 60)");
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
