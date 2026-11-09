import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { unzipSync, strFromU8 } from 'fflate';
import { generatePipelineZipBytes } from '../exportZip';
import {
  generateIngestYaml,
  generateIngestScript,
  generateMonitorYaml,
  generateReadme,
  generateTestAudioYaml,
  generateQueueFile,
} from '../templates';
import {
  normalizeLineEndings,
  toPosixPath,
  sanitizeSafeFilename,
  xmlSafeText,
  xmlSafeAttr,
} from '../posixUtils';
import { ClipItemSchema } from '../contracts/clipCatalog';
import { createScriptStore } from '../../server/scriptStore';
import { EPISODE_SEGMENTS_CACHE, cacheEpisodeSegments } from '../transcriptData';
import type { EnhancedConfig, PipelineFile } from '../../types';

const mockConfig: EnhancedConfig = {
  repoName: 'test-spaces-pipeline',
  ownerName: 'test-user',
  podcastTitle: 'Test "Podcast" & Spaces 🚀',
  podcastDescription: 'Audio archive for Twitter/X Spaces\nSecond line with special <chars>',
  authorName: "John O'Connor",
  email: 'john@example.com',
  imageUrl: 'https://example.com/art.jpg?token=abc&size=large',
  githubToken: '',
  artworkDataUrl: '',
  platforms: ['twitter'],
  batchUrls: ['https://x.com/i/spaces/1', 'https://x.com/i/spaces/2'],
  enableTranscription: true,
  enableSlackWebhook: true,
  slackWebhookUrl: 'https://hooks.slack.com/services/T/B/X',
  enableDiscordWebhook: true,
  discordWebhookUrl: 'https://discord.com/api/webhooks/1/abc',
  enableScheduledMonitoring: true,
  scheduledCron: '0 */4 * * *',
};

describe('Exhaustive File Handling, Serialization & Compatibility Regression Tests', () => {
  it('guarantees zero carriage returns (\\r) in all template generators', () => {
    const outputs = [
      generateIngestScript(mockConfig),
      generateIngestYaml(mockConfig),
      generateMonitorYaml(mockConfig),
      generateReadme(mockConfig),
      generateTestAudioYaml(mockConfig),
      generateQueueFile(mockConfig),
    ];

    for (const output of outputs) {
      expect(output).not.toContain('\r');
      expect(output).not.toContain('\r\n');
      if (output.length > 0) {
        expect(output.split('\n').length).toBeGreaterThan(1);
      }
    }

    const ingestScript = generateIngestScript(mockConfig);
    expect(ingestScript).toContain('COOKIE_ARGS');
    expect(ingestScript).toContain('config/quarantined_spaces.json');
    expect(ingestScript).toContain('Denied by access control');
  });

  function parseZipUnixPermissions(buf: Uint8Array): Record<string, number> {
    const nodeBuf = Buffer.from(buf);
    const perms: Record<string, number> = {};
    for (let i = 0; i < nodeBuf.length - 46; i++) {
      if (nodeBuf[i] === 0x50 && nodeBuf[i + 1] === 0x4b && nodeBuf[i + 2] === 0x01 && nodeBuf[i + 3] === 0x02) {
        const fnLen = nodeBuf.readUInt16LE(i + 28);
        const extLen = nodeBuf.readUInt16LE(i + 30);
        const commentLen = nodeBuf.readUInt16LE(i + 32);
        const extAttrs = nodeBuf.readUInt32LE(i + 38);
        const filename = nodeBuf.toString('utf8', i + 46, i + 46 + fnLen);
        perms[filename] = (extAttrs >>> 16) & 0o777;
        i += 46 + fnLen + extLen + commentLen - 1;
      }
    }
    return perms;
  }

  it('sets 0755 UNIX permissions and UNIX platform in fflate bundles for shell scripts', async () => {
    const files: PipelineFile[] = [
      {
        path: 'scripts/ingest.sh',
        name: 'Ingest Script',
        language: 'bash',
        content: () => '#!/bin/bash\necho "test"\n',
        description: 'Bash script',
      },
      {
        path: 'README.md',
        name: 'Readme',
        language: 'markdown',
        content: () => '# Readme\n',
        description: 'Doc file',
      },
    ];

    const buffer = await generatePipelineZipBytes(files, mockConfig);
    const unzipped = unzipSync(buffer);

    expect(unzipped['scripts/ingest.sh']).toBeDefined();
    expect(unzipped['README.md']).toBeDefined();

    const perms = parseZipUnixPermissions(buffer);
    // 0o755 octal is 493 in decimal, 0o644 is 420
    expect(perms['scripts/ingest.sh']).toBe(0o755);
    expect(perms['README.md']).toBe(0o644);
  });

  it('generates full pipeline bundle where all files have 0 carriage returns and correct UNIX modes', async () => {
    const pipelineFiles: PipelineFile[] = [
      {
        path: '.github/workflows/ingest.yml',
        name: 'Workflow',
        language: 'yaml',
        content: generateIngestYaml,
        description: 'Main workflow',
      },
      {
        path: 'scripts/ingest.sh',
        name: 'Ingest Script',
        language: 'bash',
        content: generateIngestScript,
        description: 'Ingest script',
      },
      {
        path: 'batch_queue.txt',
        name: 'batch_queue.txt',
        language: 'text',
        content: generateQueueFile,
        description: 'Queue file',
      },
      {
        path: 'README.md',
        name: 'Readme',
        language: 'markdown',
        content: generateReadme,
        description: 'Documentation',
      },
      {
        path: '.github/workflows/monitor.yml',
        name: 'Monitor Workflow',
        language: 'yaml',
        content: generateMonitorYaml,
        description: 'Monitor',
      },
    ];

    const buffer = await generatePipelineZipBytes(pipelineFiles, mockConfig);
    const unzipped = unzipSync(buffer);
    const perms = parseZipUnixPermissions(buffer);

    for (const f of pipelineFiles) {
      const entryKey = toPosixPath(f.path);
      const fileBytes = unzipped[entryKey];
      expect(fileBytes).toBeDefined();
      const text = strFromU8(fileBytes);
      expect(text).not.toContain('\r');
      expect(text).not.toContain('\r\n');
      if (f.path.endsWith('.sh')) {
        expect(perms[entryKey]).toBe(0o755);
      } else {
        expect(perms[entryKey]).toBe(0o644);
      }
    }
  });

  it('normalizes Windows backslashes into POSIX forward slashes', () => {
    const windowsPath = 'best_saved_clips\\Wild_Stories\\01h21m40s_Speaker.mp3';
    expect(toPosixPath(windowsPath)).toBe('best_saved_clips/Wild_Stories/01h21m40s_Speaker.mp3');
    expect(toPosixPath('')).toBe('');
  });

  it('auto-normalizes backslashes in ClipItemSchema file_path and download_url', () => {
    const rawClip = {
      title: 'Wild Story',
      category: 'Wild_Stories',
      start_seconds: 10,
      end_seconds: 70,
      viral_score: 9,
      file_path: 'best_saved_clips\\Wild_Stories\\test_clip.mp3',
      download_url: 'https://example.com/downloads\\test_clip.mp3',
    };

    const parsed = ClipItemSchema.parse(rawClip);
    expect(parsed.file_path).toBe('best_saved_clips/Wild_Stories/test_clip.mp3');
    expect(parsed.download_url).toBe('https://example.com/downloads/test_clip.mp3');
  });

  it('sanitizes illegal Windows characters, device names, and trailing dots in filenames', () => {
    expect(sanitizeSafeFilename('Space: "Episode" *Special*?')).toBe('Space_ _Episode_ _Special__');
    expect(sanitizeSafeFilename('CON.mp3')).toBe('CON.mp3_safe');
    expect(sanitizeSafeFilename('aux')).toBe('aux_safe');
    expect(sanitizeSafeFilename('nul.txt')).toBe('nul.txt_safe');
    expect(sanitizeSafeFilename('Trailing Dot....')).toBe('Trailing Dot');
    expect(sanitizeSafeFilename('???')).toBe('file_safe');
    expect(sanitizeSafeFilename('', 'fallback_title')).toBe('fallback_title');
  });

  it('cleanses XML 1.0 disallowed control characters and escapes attribute entities', () => {
    // Control chars \x00, \x08, \x1F must be stripped
    const rawWithCtrl = 'Title \x00\x08 with \x1F control codes & "quotes" <tag>';
    expect(xmlSafeText(rawWithCtrl)).toBe('Title  with  control codes &amp; "quotes" &lt;tag&gt;');
    expect(xmlSafeAttr(rawWithCtrl)).toBe('Title  with  control codes &amp; &quot;quotes&quot; &lt;tag&gt;');

    // URL with query parameter &
    const cdnUrl = 'https://cdn.example.com/audio.mp3?token=abc&expire=123';
    expect(xmlSafeAttr(cdnUrl)).toBe('https://cdn.example.com/audio.mp3?token=abc&amp;expire=123');
  });

  it('resizes or converts image blob to compact base64 without error', async () => {
    const { resizeImageToDataUrl } = await import('../imageResize');
    const mockBlob = new Blob(['fake-image-bytes'], { type: 'image/jpeg' });
    const res = await resizeImageToDataUrl(mockBlob, 512, 0.85);
    expect(res).toBeDefined();
    expect(res.dataUrl).toContain('data:');
    expect(res.base64).toBeDefined();
  });

  describe('ScriptStore atomic overwrite resilience on Windows', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'script-store-test-'));
    });

    afterEach(() => {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    });

    it('safely overwrites an existing JSON file multiple times without EPERM/EBUSY', () => {
      const store = createScriptStore(tempDir);
      const projectData = {
        id: 'proj_test1',
        title: 'Initial Title',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sourceTags: ['tag1'],
        targetRuntimeSec: 600,
        transcriptHashes: {},
        speakerNames: [],
        clips: [],
        excludedClips: [],
        headVersionId: null,
      };

      // First save
      store.saveProject(projectData as any);
      const read1 = store.getProject('proj_test1');
      expect(read1?.title).toBe('Initial Title');

      // Overwrite existing file
      projectData.title = 'Updated Title';
      projectData.updatedAt = Date.now() + 1000;
      expect(() => store.saveProject(projectData as any)).not.toThrow();

      const read2 = store.getProject('proj_test1');
      expect(read2?.title).toBe('Updated Title');
    });
  });

  describe('Transcript memory cache bounding', () => {
    it('evicts oldest entries when cache exceeds capacity', () => {
      EPISODE_SEGMENTS_CACHE.clear();

      for (let i = 0; i < 35; i++) {
        cacheEpisodeSegments(`episode_${i}`, [{ start: i, end: i + 5, speaker: 'Test', text: `Turn ${i}` }]);
      }

      // Max capacity is 30, so the first 5 should have been evicted
      expect(EPISODE_SEGMENTS_CACHE.size).toBe(30);
      expect(EPISODE_SEGMENTS_CACHE.has('episode_0')).toBe(false);
      expect(EPISODE_SEGMENTS_CACHE.has('episode_4')).toBe(false);
      expect(EPISODE_SEGMENTS_CACHE.has('episode_5')).toBe(true);
      expect(EPISODE_SEGMENTS_CACHE.has('episode_34')).toBe(true);
    });
  });
});
