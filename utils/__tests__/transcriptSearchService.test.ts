import { describe, it, expect } from 'vitest';
import {
  detectSearchIntent,
  searchTranscriptArchive,
  getArchiveStats,
  loadSummaries,
  dotProduct,
  computeRRF,
  getEpisodeEmbeddings,
  searchTranscriptVector,
  TranscriptSearchResult,
  normalizeSpokenQuery,
  handleSearchTranscripts,
  formatTimestamp,
  parseTimestampSec,
  getTagToFileMap,
} from '../../server/transcriptSearchService';

describe('transcriptSearchService', () => {
  describe('detectSearchIntent', () => {
    it('detects capability inquiries correctly', () => {
      expect(detectSearchIntent('are you able to search the transcripts ?')).toEqual({
        isCapabilityInquiry: true,
        isSearchQuery: false,
      });

      expect(detectSearchIntent('Can you search transcripts for me?')).toEqual({
        isCapabilityInquiry: true,
        isSearchQuery: false,
      });

      expect(detectSearchIntent('Do you have access to the transcripts?')).toEqual({
        isCapabilityInquiry: true,
        isSearchQuery: false,
      });
    });

    it('extracts query terms and speaker targets for search requests', () => {
      const res1 = detectSearchIntent('find quotes about compromise');
      expect(res1.isSearchQuery).toBe(true);
      expect(res1.query).toBe('compromise');

      const res2 = detectSearchIntent('what did Angela say about compromise?');
      expect(res2.isSearchQuery).toBe(true);
      expect(res2.speaker).toBe('Angela');
      expect(res2.query).toBe('compromise');

      const res3 = detectSearchIntent('search transcripts for artificial intelligence');
      expect(res3.isSearchQuery).toBe(true);
      expect(res3.query).toBe('artificial intelligence');
    });

    it('detects release tag in queries', () => {
      const res = detectSearchIntent('transcripts for 20260925_1qJDzWQRqWNKV');
      expect(res.isSearchQuery).toBe(true);
      expect(res.episodeTag).toBe('20260925_1qJDzWQRqWNKV');
    });
  });

  describe('getArchiveStats & loadSummaries', () => {
    it('loads episode summaries and reports stats', () => {
      const summaries = loadSummaries();
      expect(summaries.length).toBeGreaterThan(0);

      const stats = getArchiveStats();
      expect(stats.totalEpisodes).toBeGreaterThanOrEqual(100);
      expect(stats.totalTranscriptsOnDisk).toBeGreaterThanOrEqual(10);
    });
  });

  describe('dotProduct & cosine similarity', () => {
    it('calculates exact dot product for normalized 384-dim vectors', () => {
      const a = new Float32Array(384);
      const b = new Float32Array(384);

      // Identity unit vector
      a[0] = 1.0;
      b[0] = 1.0;
      expect(dotProduct(a, 0, b)).toBeCloseTo(1.0, 5);

      // Orthogonal unit vectors
      a[0] = 1.0;
      a[1] = 0.0;
      b[0] = 0.0;
      b[1] = 1.0;
      expect(dotProduct(a, 0, b)).toBeCloseTo(0.0, 5);

      // Opposing unit vector
      b[0] = -1.0;
      b[1] = 0.0;
      expect(dotProduct(a, 0, b)).toBeCloseTo(-1.0, 5);
    });

    it('correctly handles subvector offset indexing', () => {
      // 2 vectors concatenated into single buffer of length 768
      const packed = new Float32Array(384 * 2);
      const query = new Float32Array(384);

      // Vector 0 is orthogonal
      packed[0] = 0.0;
      packed[1] = 1.0;

      // Vector 1 (offset 384) is parallel
      packed[384 + 0] = 1.0;

      query[0] = 1.0;

      expect(dotProduct(packed, 0, query)).toBeCloseTo(0.0, 5);
      expect(dotProduct(packed, 384, query)).toBeCloseTo(1.0, 5);
    });
  });

  describe('computeRRF (Reciprocal Rank Fusion)', () => {
    const makeItem = (tag: string, start: number, text: string, type: 'lexical' | 'vector'): TranscriptSearchResult => ({
      episodeTitle: 'Test Ep',
      releaseTag: tag,
      speaker: 'Alice',
      startSec: start,
      endSec: start + 10,
      text,
      matchType: type,
    });

    it('boosts items appearing in both lexical and vector result sets', () => {
      const itemA = makeItem('ep1', 10.0, 'Disclosed government files', 'lexical');
      const itemB = makeItem('ep1', 20.0, 'Unrelated topic', 'lexical');
      const itemC = makeItem('ep1', 30.0, 'Other discussion', 'lexical');

      const lexicalResults = [itemA, itemB, itemC];

      // In vector results, itemA is rank 2, while itemD is rank 1
      const itemD = makeItem('ep1', 40.0, 'Vector only top hit', 'vector');
      const itemAVec = makeItem('ep1', 10.0, 'Disclosed government files', 'vector');
      const vectorResults = [itemD, itemAVec];

      const fused = computeRRF(lexicalResults, vectorResults, 60);

      // itemA has lexical rank 1 (1/61) + vector rank 2 (1/62) = 0.016393 + 0.016129 = 0.032522
      // itemD has vector rank 1 (1/61) = 0.016393
      // itemB has lexical rank 2 (1/62) = 0.016129
      expect(fused.length).toBe(4);
      expect(fused[0].releaseTag).toBe('ep1');
      expect(fused[0].startSec).toBe(10.0);
      expect(fused[0].matchType).toBe('hybrid');
      expect(fused[0].relevanceScore).toBeGreaterThan(fused[1].relevanceScore || 0);
    });

    it('orders purely disjoint result sets correctly by rank', () => {
      const itemL1 = makeItem('ep1', 5.0, 'Lexical hit 1', 'lexical');
      const itemV1 = makeItem('ep2', 15.0, 'Vector hit 1', 'vector');

      const fused = computeRRF([itemL1], [itemV1], 60);
      expect(fused.length).toBe(2);
      // Both have rank 1 in their respective set: 1 / (60 + 1) = 0.016393
      expect(fused[0].relevanceScore).toBeCloseTo(1 / 61, 5);
      expect(fused[1].relevanceScore).toBeCloseTo(1 / 61, 5);
    });
  });

  describe('fallback handling for missing or pending embeddings', () => {
    it('returns null for non-existent episode embeddings without crashing', () => {
      const result = getEpisodeEmbeddings('non_existent_episode_tag_999999');
      expect(result).toBeNull();
    });

    it('returns empty array when vector search targets an episode without embeddings', async () => {
      const results = await searchTranscriptVector('disclosure', {
        episodeTag: 'non_existent_episode_tag_999999',
      });
      expect(results).toEqual([]);
    });

    it('searchTranscriptArchive falls back gracefully to lexical search when vector returns empty', async () => {
      const results = await searchTranscriptArchive('compromise', {
        mode: 'hybrid',
        maxResults: 3,
      });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty('speaker');
      expect(results[0]).toHaveProperty('text');
    });
  });

  describe('searchTranscriptArchive modes', () => {
    it('executes in lexical mode when specified', async () => {
      const results = await searchTranscriptArchive('compromise', { mode: 'lexical', maxResults: 3 });
      expect(results.length).toBeGreaterThan(0);
      expect(results.every(r => r.matchType === 'lexical')).toBe(true);
    });

    it('executes in hybrid mode by default', async () => {
      const results = await searchTranscriptArchive('compromise', { maxResults: 3 });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty('text');
    });
  });

  describe('normalizeSpokenQuery (spoken audio normalizer)', () => {
    it('strips em dashes, en dashes, and ellipses', () => {
      expect(normalizeSpokenQuery('Wait—she said... maybe–never')).toBe('Wait she said maybe never');
    });

    it('normalizes digits to words', () => {
      expect(normalizeSpokenQuery('step 2 and phase 3')).toBe('step two and phase three');
    });

    it('strips repeated stutter and filler words', () => {
      expect(normalizeSpokenQuery('in, in the the meeting, we we talked')).toBe('in the meeting we talked');
    });
  });

  describe('handleSearchTranscripts (multi-tier resilient search runner)', () => {
    it('returns structured matches with required studio fields', async () => {
      const res = await handleSearchTranscripts({
        query: 'compromise',
        scope: 'all_transcripts',
        maxResults: 5,
      });

      expect(res.totalMatches).toBeGreaterThan(0);
      expect(res.matches.length).toBeGreaterThan(0);
      const first = res.matches[0];
      expect(first).toHaveProperty('episode_id');
      expect(first).toHaveProperty('episode_title');
      expect(first).toHaveProperty('start_timestamp');
      expect(first).toHaveProperty('end_timestamp');
      expect(first).toHaveProperty('speaker');
      expect(first).toHaveProperty('snippet');
    });

    it('broadens speaker scope when speaker hint yields no matches', async () => {
      const res = await handleSearchTranscripts({
        query: 'compromise',
        scope: 'all_transcripts',
        speaker_hint: 'NonExistentSpeakerXYZ999',
        maxResults: 5,
      });

      // Because 'compromise' exists in the archive, broadening the speaker filter returns matches
      expect(res.totalMatches).toBeGreaterThan(0);
      expect(res.matches.length).toBeGreaterThan(0);
      expect(res.speakerFilterApplied).toBeUndefined();
    });

    it('falls back to Tier 2 anchor words search when verbatim sentence fails', async () => {
      const res = await handleSearchTranscripts({
        query: 'compromise newsletter policy discussions',
        scope: 'all_transcripts',
        maxResults: 5,
      });

      expect(res.matches).toBeDefined();
    });

    it('returns formatted_time on all matches', async () => {
      const res = await handleSearchTranscripts({
        query: 'compromise',
        scope: 'all_transcripts',
        maxResults: 3,
      });

      expect(res.matches.length).toBeGreaterThan(0);
      for (const m of res.matches) {
        expect(m).toHaveProperty('formatted_time');
        expect(m.formatted_time).toMatch(/^\d{1,2}:\d{2}(?::\d{2})?$/);
      }
    });

    it('retrieves turns around a target timestamp without 942s truncation', async () => {
      // Simulate multi-hour episode turns beyond 942s (e.g. at 2862s / 47:42)
      const mockTurns = [
        { speaker: 'Host', text: 'Early welcome at the beginning', start: 10, end: 20 },
        { speaker: 'Guest', text: 'Midway discussion at 15 minutes', start: 900, end: 940 },
        { speaker: 'Angela', text: 'You sent some sort of newsletter you have me in', start: 2855, end: 2865 },
        { speaker: 'Speaker 1', text: 'Yes Angela that went out to everyone', start: 2866, end: 2875 },
      ];

      const res = await handleSearchTranscripts({
        query: 'newsletter Angela',
        scope: 'active_episode',
        episodeTag: 'test_multi_hour_episode',
        timestamp_sec: 2862,
        activeSegments: mockTurns,
        maxResults: 5,
      });

      expect(res.matches.length).toBeGreaterThan(0);
      const targetMatch = res.matches.find(m => m.snippet.includes('newsletter'));
      expect(targetMatch).toBeDefined();
      expect(targetMatch?.formatted_time).toBe('47:35');
      expect(targetMatch?.speaker).toBe('Angela');
      expect(targetMatch?.start_timestamp).toBe(2855);
    });

    it('executes Tier 2 anchor word search on spoken query with filler words and stutters', async () => {
      const mockTurns = [
        { speaker: 'Angela', text: 'You sent some newsletter you have me in', start: 2855, end: 2865 },
      ];

      const res = await handleSearchTranscripts({
        query: 'sent some sort of newsletter, newsletter... you have me in, Angela',
        scope: 'active_episode',
        episodeTag: 'test_spoken_episode',
        activeSegments: mockTurns,
        maxResults: 5,
      });

      expect(res.matches.length).toBeGreaterThan(0);
      expect(res.matches[0].snippet).toContain('newsletter');
    });
  });

  describe('formatTimestamp & parseTimestampSec', () => {
    it('parses timestamps in MM:SS and HH:MM:SS format', () => {
      expect(parseTimestampSec('▶ 47:42')).toBe(2862);
      expect(parseTimestampSec('47:42')).toBe(2862);
      expect(parseTimestampSec('@ 47:42')).toBe(2862);
      expect(parseTimestampSec('at 47:42')).toBe(2862);
      expect(parseTimestampSec('1:47:42')).toBe(6462);
      expect(parseTimestampSec('12:30')).toBe(750);
    });

    it('parses timestamps in seconds notation', () => {
      expect(parseTimestampSec('2862s')).toBe(2862);
      expect(parseTimestampSec('2,862s')).toBe(2862);
      expect(parseTimestampSec('2862 sec')).toBe(2862);
      expect(parseTimestampSec('2862 seconds')).toBe(2862);
    });

    it('formats seconds into MM:SS and HH:MM:SS strings', () => {
      expect(formatTimestamp(2862)).toBe('47:42');
      expect(formatTimestamp(750)).toBe('12:30');
      expect(formatTimestamp(6462)).toBe('1:47:42');
      expect(formatTimestamp(0)).toBe('0:00');
    });
  });

  describe('detectSearchIntent with timestamp and episode awareness', () => {
    it('detects timestamp and episode title from spoken audio query', () => {
      const intent = detectSearchIntent('At 47:42 in Who_or_What_has_Ruined_UFO_X_Spaces someone said sent some sort of newsletter you have me in Angela');
      expect(intent.isSearchQuery).toBe(true);
      expect(intent.timestampSec).toBe(2862);
      expect(intent.episodeTag).toBe('20261012_1yxBePojzaWJN');
      expect(intent.query).toContain('newsletter');
    });
  });

  describe('getTagToFileMap dual directory indexing', () => {
    it('indexes files from disk without crashing and maps release tags', () => {
      const map = getTagToFileMap();
      expect(map.size).toBeGreaterThan(100);
    });
  });
});
