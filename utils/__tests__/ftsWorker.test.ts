import { describe, it, expect, beforeAll } from 'vitest';
import {
  sanitizeFTS5Query,
  initDB,
  batchIngest,
  batchIngestEpisodes,
  searchTurns,
  deleteEpisode,
} from '../../workers/fts-worker';

describe('SQLite WASM FTS5 Full-Text Search Worker Engine', () => {
  describe('Query Sanitization', () => {
    it('handles empty query', () => {
      expect(sanitizeFTS5Query('')).toBe('');
      expect(sanitizeFTS5Query('   ')).toBe('');
      expect(sanitizeFTS5Query('!@#$%^&*()')).toBe('');
    });

    it('strips handles like @user and wraps terms in quotes with prefix wildcard', () => {
      const sanitized = sanitizeFTS5Query('@logan whistleblower');
      expect(sanitized).toBe('"logan"* "whistleblower"*');
    });

    it('strips timestamps and colons that break FTS5 grammar', () => {
      const sanitized = sanitizeFTS5Query('12:34:56 speaker: hello!');
      expect(sanitized).toBe('"12"* "34"* "56"* "speaker"* "hello"*');
    });

    it('preserves unicode characters and diacritics', () => {
      const sanitized = sanitizeFTS5Query('café résumé naïve');
      expect(sanitized).toBe('"café"* "résumé"* "naïve"*');
    });
  });

  describe('Database Operations', () => {
    beforeAll(async () => {
      await initDB();
    });

    it('initializes DB schema and ingests turns in batch transaction', () => {
      const turns = [
        { turn_id: 't1', episode_id: 'ep1', speaker: 'Logan', text: 'Welcome to SpacePipe Studio podcast archiving.', start_time: 1.0, end_time: 5.0 },
        { turn_id: 't2', episode_id: 'ep1', speaker: 'Angela', text: 'We are discussing UFO whistleblower testimonies and radar evidence.', start_time: 5.5, end_time: 12.0 },
        { turn_id: 't3', episode_id: 'ep2', speaker: 'Logan', text: 'Another episode about artificial intelligence and web workers.', start_time: 0.0, end_time: 4.2 },
      ];

      const count = batchIngest(turns, 'ep1');
      expect(count).toBe(3);
    });

    it('executes BM25 ranked search across indexed turns', () => {
      const results = searchTurns({ query: 'whistleblower' });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].speaker).toBe('Angela');
      expect(results[0].text).toContain('whistleblower');
      expect(typeof results[0].rank).toBe('number');
      expect(results[0].startSec).toBe(5.5);
    });

    it('filters search by episodeId', () => {
      const resultsEp1 = searchTurns({ query: 'SpacePipe', episodeId: 'ep1' });
      expect(resultsEp1.length).toBe(1);
      expect(resultsEp1[0].turn_id).toBe('t1');

      const resultsEp2 = searchTurns({ query: 'SpacePipe', episodeId: 'ep2' });
      expect(resultsEp2.length).toBe(0);
    });

    it('filters search by speaker', () => {
      const results = searchTurns({ query: 'SpacePipe', speaker: 'Logan' });
      expect(results.length).toBe(1);
      expect(results[0].speaker).toBe('Logan');

      const noMatch = searchTurns({ query: 'SpacePipe', speaker: 'Angela' });
      expect(noMatch.length).toBe(0);
    });

    it('deletes episode turns cleanly', () => {
      deleteEpisode('ep1');
      const results = searchTurns({ query: 'whistleblower' });
      expect(results.length).toBe(0);

      // ep2 should still exist
      const resultsEp2 = searchTurns({ query: 'intelligence' });
      expect(resultsEp2.length).toBe(1);
      expect(resultsEp2[0].speaker).toBe('Logan');
    });

    it('batch ingests episodes with nested segments', () => {
      const episodes = [
        {
          release_id: 101,
          release_tag: 'tag-101',
          segments: [
            { speaker: 'Sav', text: 'This is a test segment for full pipeline verification.', start: 10, end: 20 },
            { speaker: 'Deacon', text: 'Acknowledged, audio synchronized and ready.', start: 21, end: 30 },
          ],
        },
      ];

      const count = batchIngestEpisodes(episodes);
      expect(count).toBe(2);

      const searchRes = searchTurns({ query: 'pipeline' });
      expect(searchRes.length).toBe(1);
      expect(searchRes[0].speaker).toBe('Sav');
      expect(searchRes[0].release_tag).toBe('101');
    });
  });
});
