/**
 * Frozen copies of the real transcripts the Script Studio tests are written against.
 *
 * Production transcripts in public/transcripts/episodes can be rewritten by any transcription run
 * (20260826_1AxRnZYBVdrxl was re-segmented on 2026-10-29 and utterance u92 moved to a different line),
 * so tests must never read them. These files were taken byte for byte from commit 78db21ef0^ and must
 * not be edited; transcriptFixtures.test.ts checks their hashes. To test against newer data, add a new
 * fixture file under a new name instead of changing these.
 *
 * FIXTURE_ROOT has the same layout as the repo root, so it can be passed to readTranscript() directly.
 */
import path from 'node:path';

export const FIXTURE_ROOT = path.join(__dirname, '..', 'fixtures', 'archive');

export const fixtureTranscriptPath = (releaseTag: string) =>
  path.join(FIXTURE_ROOT, 'public', 'transcripts', 'episodes', `${releaseTag}.json`);

/** sha256 of each fixture with line endings normalized to \n (so a CRLF checkout still matches). */
export const FIXTURE_SHA256: Record<string, string> = {
  '20260826_1AxRnZYBVdrxl': '4e5ffcd9f70d70821db2ead708d4aad6f9b128a9508727309c8d761ed1e2ad63',
  '20260216_1DXxyvyaVXbKM': '4c0dc475ae5cb18c0983d03c13f694cdc3a59b35706752737f97a86544477558',
  '20260218_1yoJMwyzqQpKQ': 'c4c6cbea96d5b55a3950e35e18bb53ea5dc6740c4d412c6e7e6d5f708d60937b',
};
