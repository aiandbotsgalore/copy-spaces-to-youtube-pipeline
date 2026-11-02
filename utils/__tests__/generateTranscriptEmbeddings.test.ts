import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  discoverCanonicalEpisodes,
  validateExistingEmbeddings,
  atomicWriteEmbeddings,
  extractSegmentsAndInputs,
  formatDuration,
  EmbeddingManifest,
} from '../../scripts/generateTranscriptEmbeddings';
import { getEpisodeEmbeddings } from '../../server/transcriptSearchService';

describe('Hardened Archive Embedding Generator (Phase 1)', () => {
  let tempDir: string;
  let cacheDir: string;
  let episodesDir: string;
  let summaryPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spacepipe-test-embeddings-'));
    cacheDir = path.join(tempDir, 'cache');
    episodesDir = path.join(tempDir, 'episodes');
    summaryPath = path.join(tempDir, 'summary.json');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.mkdirSync(episodesDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  describe('1. Transcript Discovery & Multi-Asset Deduplication', () => {
    it('discovers episodes across both public/episodes and .cache/transcripts directories', () => {
      // Episode 1 only in public/episodes
      fs.writeFileSync(
        path.join(episodesDir, 'ep_public_only.json'),
        JSON.stringify({ segments: [{ text: 'Hello from public', speaker: 'Alice' }] })
      );

      // Episode 2 in both, but .cache has multi-asset file with more turns
      fs.writeFileSync(
        path.join(episodesDir, 'ep_shared.json'),
        JSON.stringify({ segments: [{ text: 'Short turn', speaker: 'Bob' }] })
      );
      fs.writeFileSync(
        path.join(cacheDir, 'ep_shared_asset999.json'),
        JSON.stringify({
          segments: [
            { text: 'Turn 1 in cache', speaker: 'Bob' },
            { text: 'Turn 2 in cache', speaker: 'Charlie' },
          ],
        })
      );

      const result = discoverCanonicalEpisodes({ cacheDir, episodesDir, summaryPath });
      expect(result.plans.length).toBe(2);

      const epPublic = result.plans.find(p => p.tag === 'ep_public_only');
      expect(epPublic).toBeDefined();
      expect(epPublic?.sourceType).toBe('public');
      expect(epPublic?.segmentCount).toBe(1);

      const epShared = result.plans.find(p => p.tag === 'ep_shared');
      expect(epShared).toBeDefined();
      // Should pick cache candidate because it has 2 turns vs 1 turn in public
      expect(epShared?.sourceType).toBe('cache');
      expect(epShared?.segmentCount).toBe(2);
      expect(epShared?.alternativeSources.length).toBe(1);
    });

    it('deduplicates multi-asset files by canonical tag and selects source with max turns', () => {
      const tag = '20261020_multi';
      fs.writeFileSync(
        path.join(episodesDir, `${tag}.json`),
        JSON.stringify({ segments: [{ text: 'Turn 1', speaker: 'Speaker A' }] })
      );
      fs.writeFileSync(
        path.join(cacheDir, `${tag}_asset1.json`),
        JSON.stringify({
          segments: [
            { text: 'Turn 1', speaker: 'Speaker A' },
            { text: 'Turn 2', speaker: 'Speaker B' },
          ],
        })
      );
      fs.writeFileSync(
        path.join(cacheDir, `${tag}_asset2.json`),
        JSON.stringify({
          segments: [
            { text: 'Turn 1', speaker: 'Speaker A' },
            { text: 'Turn 2', speaker: 'Speaker B' },
            { text: 'Turn 3', speaker: 'Speaker C' },
            { text: 'Turn 4', speaker: 'Speaker D' },
          ],
        })
      );

      const result = discoverCanonicalEpisodes({ cacheDir, episodesDir, summaryPath });
      expect(result.plans.length).toBe(1);
      const plan = result.plans[0];
      expect(plan.tag).toBe(tag);
      expect(plan.segmentCount).toBe(4);
      expect(plan.resolvedPath).toContain(`${tag}_asset2.json`);
      expect(plan.alternativeSources.length).toBe(2);
    });

    it('identifies unmapped test fixture files or empty transcripts', () => {
      fs.writeFileSync(
        path.join(cacheDir, 'test_synthetic_fixture.json'),
        JSON.stringify({ segments: [{ text: 'Test only' }] })
      );

      const result = discoverCanonicalEpisodes({ cacheDir, episodesDir, summaryPath });
      expect(result.unmappedCacheFiles).toContain('test_synthetic_fixture.json');
    });
  });

  describe('2. Embedding Validation & Strict Resuming', () => {
    it('verifies valid existing embeddings with matching binary size', () => {
      const tag = 'ep_valid';
      const segmentCount = 3;
      const dims = 384;
      const expectedBytes = segmentCount * dims * 4;

      const manifest: EmbeddingManifest = {
        version: 1,
        episodeTag: tag,
        title: 'Valid Episode',
        dims,
        segmentCount,
        generatedAt: new Date().toISOString(),
        segments: [
          { index: 0, start: 0, end: 1, speaker: 'A', text: 'One' },
          { index: 1, start: 1, end: 2, speaker: 'B', text: 'Two' },
          { index: 2, start: 2, end: 3, speaker: 'C', text: 'Three' },
        ],
      };

      fs.writeFileSync(path.join(cacheDir, `${tag}.embeddings.json`), JSON.stringify(manifest), 'utf8');
      const fakeVectors = new Float32Array(segmentCount * dims);
      fs.writeFileSync(path.join(cacheDir, `${tag}.embeddings.bin`), Buffer.from(fakeVectors.buffer));

      const validation = validateExistingEmbeddings(tag, cacheDir);
      expect(validation.valid).toBe(true);
      expect(validation.segmentCount).toBe(3);
      expect(validation.dims).toBe(384);
    });

    it('detects corrupted or truncated binary files (size mismatch)', () => {
      const tag = 'ep_corrupt_bin';
      const manifest: EmbeddingManifest = {
        version: 1,
        episodeTag: tag,
        dims: 384,
        segmentCount: 5,
        generatedAt: new Date().toISOString(),
        segments: Array.from({ length: 5 }, (_, i) => ({
          index: i,
          start: i,
          end: i + 1,
          speaker: 'Speaker',
          text: `Text ${i}`,
        })),
      };

      fs.writeFileSync(path.join(cacheDir, `${tag}.embeddings.json`), JSON.stringify(manifest), 'utf8');
      // Truncated binary (only 2 vectors instead of 5)
      const truncatedVectors = new Float32Array(2 * 384);
      fs.writeFileSync(path.join(cacheDir, `${tag}.embeddings.bin`), Buffer.from(truncatedVectors.buffer));

      const validation = validateExistingEmbeddings(tag, cacheDir);
      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain('binary_size_mismatch');
    });

    it('detects corrupted manifest JSON or invalid segment counts', () => {
      const tag = 'ep_bad_json';
      fs.writeFileSync(path.join(cacheDir, `${tag}.embeddings.json`), '{ malformed json...', 'utf8');
      fs.writeFileSync(path.join(cacheDir, `${tag}.embeddings.bin`), Buffer.alloc(100));

      const validation = validateExistingEmbeddings(tag, cacheDir);
      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain('manifest_json_corrupted');
    });

    it('returns missing_files when one or both files are missing', () => {
      const validation = validateExistingEmbeddings('non_existent_tag', cacheDir);
      expect(validation.valid).toBe(false);
      expect(validation.reason).toBe('missing_files');
    });
  });

  describe('3. Safe Atomic File Writing & Rollback', () => {
    it('atomically writes .bin and .json files with temp file validation', () => {
      const tag = 'ep_atomic_test';
      const segmentCount = 2;
      const dims = 384;

      const manifest: EmbeddingManifest = {
        version: 1,
        episodeTag: tag,
        dims,
        segmentCount,
        generatedAt: new Date().toISOString(),
        segments: [
          { index: 0, start: 0, end: 1, speaker: 'S1', text: 'T1' },
          { index: 1, start: 1, end: 2, speaker: 'S2', text: 'T2' },
        ],
      };

      const vectors = new Float32Array(segmentCount * dims);
      const buffer = Buffer.from(vectors.buffer);

      atomicWriteEmbeddings(tag, cacheDir, manifest, buffer);

      const targetBin = path.join(cacheDir, `${tag}.embeddings.bin`);
      const targetManifest = path.join(cacheDir, `${tag}.embeddings.json`);

      expect(fs.existsSync(targetBin)).toBe(true);
      expect(fs.existsSync(targetManifest)).toBe(true);
      expect(fs.statSync(targetBin).size).toBe(segmentCount * dims * 4);

      // Verify no stray .tmp files left
      const remainingFiles = fs.readdirSync(cacheDir);
      const tmpFiles = remainingFiles.filter(f => f.includes('.tmp'));
      expect(tmpFiles.length).toBe(0);
    });

    it('cleans up temp files and does not overwrite target if buffer length does not match manifest', () => {
      const tag = 'ep_atomic_fail';
      const manifest: EmbeddingManifest = {
        version: 1,
        episodeTag: tag,
        dims: 384,
        segmentCount: 4,
        generatedAt: new Date().toISOString(),
        segments: Array.from({ length: 4 }, (_, i) => ({
          index: i,
          start: i,
          end: i + 1,
          speaker: 'S',
          text: `T${i}`,
        })),
      };

      // Mismatched buffer (only 1 vector)
      const wrongVectors = new Float32Array(1 * 384);
      const buffer = Buffer.from(wrongVectors.buffer);

      expect(() => {
        atomicWriteEmbeddings(tag, cacheDir, manifest, buffer);
      }).toThrow(/Temp binary verification failed/);

      // Verify target files do not exist
      expect(fs.existsSync(path.join(cacheDir, `${tag}.embeddings.bin`))).toBe(false);
      expect(fs.existsSync(path.join(cacheDir, `${tag}.embeddings.json`))).toBe(false);

      // Verify temp files were cleaned up
      const remaining = fs.readdirSync(cacheDir);
      expect(remaining.filter(f => f.includes('.tmp')).length).toBe(0);
    });
  });

  describe('4. Turn Alignment & Speaker Formatting', () => {
    it('formats dialogue with [Speaker: name] prefix and skips blank turns', () => {
      const rawData = {
        segments: [
          { speaker: 'Logan', text: 'First valid turn', start: 0, end: 5 },
          { speaker: 'Dan', text: '   ', start: 5, end: 10 }, // Blank text
          { speaker: '', text: 'Second valid turn with empty speaker', start: 10, end: 15 },
        ],
      };

      const { manifestSegments, inputTexts } = extractSegmentsAndInputs(rawData);

      expect(manifestSegments.length).toBe(2);
      expect(inputTexts.length).toBe(2);

      // First turn
      expect(manifestSegments[0].index).toBe(0);
      expect(manifestSegments[0].speaker).toBe('Logan');
      expect(manifestSegments[0].text).toBe('First valid turn');
      expect(inputTexts[0]).toBe('[Speaker: Logan] First valid turn');

      // Second valid turn (speaker defaulted to Unknown)
      expect(manifestSegments[1].index).toBe(1);
      expect(manifestSegments[1].speaker).toBe('Unknown');
      expect(manifestSegments[1].text).toBe('Second valid turn with empty speaker');
      expect(inputTexts[1]).toBe('[Speaker: Unknown] Second valid turn with empty speaker');
    });
  });

  describe('5. Formatting & Telemetry Helpers', () => {
    it('formats seconds into human readable duration strings', () => {
      expect(formatDuration(45)).toBe('00m 45s');
      expect(formatDuration(125)).toBe('02m 05s');
      expect(formatDuration(3665)).toBe('1h 01m 05s');
      expect(formatDuration(-10)).toBe('00:00');
    });
  });

  describe('6. Compatibility with Runtime Vector Search Loader', () => {
    it('ensures generated manifests and binaries are readable by getEpisodeEmbeddings', () => {
      const tag = '20260202_1770117309';
      // Test with one of the real archive embeddings in .cache/transcripts
      const entry = getEpisodeEmbeddings(tag);
      expect(entry).not.toBeNull();
      expect(entry?.manifest.dims).toBe(384);
      expect(entry?.manifest.episodeTag).toBe(tag);
      expect(entry?.vectors.length).toBe(entry!.manifest.segmentCount * 384);
    });
  });
});
