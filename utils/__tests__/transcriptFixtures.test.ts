/**
 * The frozen transcript fixtures must stay exactly as captured, or the Script Studio tests that
 * cite utterance ids in them would silently test different dialogue.
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { readTranscript } from '../../server/scriptData';
import { FIXTURE_ROOT, FIXTURE_SHA256, fixtureTranscriptPath } from './helpers/transcriptFixtures';

describe('frozen transcript fixtures', () => {
  for (const [tag, sha] of Object.entries(FIXTURE_SHA256)) {
    it(`${tag} is unchanged`, () => {
      const raw = fs.readFileSync(fixtureTranscriptPath(tag), 'utf8').replace(/\r\n/g, '\n');
      expect(createHash('sha256').update(raw).digest('hex')).toBe(sha);
    });
  }

  it('loads through the same reader production uses', () => {
    const t = readTranscript(FIXTURE_ROOT, '20260826_1AxRnZYBVdrxl')!;
    expect(t.utterances).toHaveLength(984);
    expect(t.utterances[92]).toMatchObject({ id: 'u92', speaker: 'Oor', start: 1207.94 });
    expect(t.utterances[92].text).toMatch(/Delicious\.$/);
  });
});
