import { describe, it, expect } from 'vitest';
import { diffTranscriptGaps, extractRecordedDate, enqueueMissingTranscripts } from '../../server/transcriptGapService';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('Transcript Gap Service', () => {
  it('extracts recorded dates across various metadata formats', () => {
    // 1. METADATA::EPISODE_DATE::
    const res1 = extractRecordedDate({ body: 'Some info\nMETADATA::EPISODE_DATE::2026-09-15\nMore info' });
    expect(res1.dateDisplay).toBe('2026-09-15');

    // 2. **Recorded:**
    const res2 = extractRecordedDate({ body: 'Release description\n- **Recorded:** 2026-08-20' });
    expect(res2.dateDisplay).toBe('2026-08-20');

    // 3. tag_name prefix
    const res3 = extractRecordedDate({ tag_name: '20260714_1vylmgmJadRMzE' });
    expect(res3.dateDisplay).toBe('2026-07-14');

    // 4. published_at fallback
    const res4 = extractRecordedDate({ published_at: '2026-06-01T12:00:00Z' });
    expect(res4.dateDisplay).toBe('2026-06-01');
  });

  it('correctly detects untranscribed releases vs transcribed ones', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spacepipe-gap-test-'));
    // Simulate one local transcript file
    fs.writeFileSync(path.join(tempDir, '20260901_transcribed.json'), JSON.stringify({ segments: [] }));

    const mockReleases = [
      {
        tag_name: '20260901_transcribed',
        name: 'Episode 1 (Transcribed)',
        assets: [{ name: 'audio.mp3', size: 10000000, browser_download_url: 'https://github.com/.../audio.mp3' }],
      },
      {
        tag_name: '20260902_missing',
        name: 'Episode 2 (Missing Transcript)',
        assets: [{ name: 'audio.mp3', size: 15000000, browser_download_url: 'https://github.com/.../audio2.mp3' }],
      },
      {
        tag_name: 'test-placeholder',
        name: 'Test Placeholder',
        assets: [{ name: 'audio.mp3', size: 1000 }], // < 5000 bytes, should be ignored
      },
      {
        tag_name: '20260903_no_audio',
        name: 'Documentation update',
        assets: [{ name: 'notes.txt', size: 500 }], // No MP3, should be ignored
      },
    ];

    const report = diffTranscriptGaps(mockReleases as any, tempDir);

    expect(report.missingCount).toBe(1);
    expect(report.missingEpisodes[0].tag).toBe('20260902_missing');
    expect(report.missingEpisodes[0].name).toBe('Episode 2 (Missing Transcript)');
    expect(report.missingEpisodes[0].audioUrl).toBe('https://github.com/.../audio2.mp3');

    // Clean up
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('enqueues missing episodes into batch queue without duplicates', () => {
    const tempQueue = path.join(os.tmpdir(), `batch_queue_${Date.now()}.txt`);
    fs.writeFileSync(tempQueue, 'existing_tag_1\nexisting_tag_2\n');

    const res = enqueueMissingTranscripts(['existing_tag_1', 'new_missing_tag_3'], tempQueue);
    expect(res.enqueued).toBe(1);
    expect(res.totalInQueue).toBe(3);

    const content = fs.readFileSync(tempQueue, 'utf8');
    expect(content).toContain('new_missing_tag_3');

    fs.unlinkSync(tempQueue);
  });
});
