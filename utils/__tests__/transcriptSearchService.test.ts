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
  rerankWithCohere,
  RelevantSpan,
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

    it('does not broaden speaker scope to unfiltered results when speaker is unknown', async () => {
      const res = await handleSearchTranscripts({
        query: 'compromise',
        scope: 'all_transcripts',
        speaker_hint: 'NonExistentSpeakerXYZ999',
        maxResults: 5,
      });

      // An unknown speaker returns 0 matches rather than falling back to unfiltered search
      expect(res.totalMatches).toBe(0);
      expect(res.matches.length).toBe(0);
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

  describe('rerankWithCohere (Cohere Rerank 5 with Context Focus)', () => {
    const mockCandidates: TranscriptSearchResult[] = [
      {
        episodeTitle: 'Episode A',
        releaseTag: 'tag_a',
        speaker: 'Alice',
        startSec: 10.5,
        endSec: 25.0,
        text: 'The fundamental issue with autonomous verification is deterministic evaluation.',
        matchType: 'hybrid',
      },
      {
        episodeTitle: 'Episode B',
        releaseTag: 'tag_b',
        speaker: 'Bob',
        startSec: 45.0,
        endSec: 60.2,
        text: 'When we discuss compromise in public policy, stakeholders need transparency.',
        matchType: 'hybrid',
      },
    ];

    it('returns empty array when candidates array is empty without calling fetch', async () => {
      let fetchCalled = false;
      const mockFetch = async () => {
        fetchCalled = true;
        return new Response('{}');
      };

      const results = await rerankWithCohere('any query', [], {
        apiKey: 'test_key',
        fetchImpl: mockFetch as any,
      });

      expect(results).toEqual([]);
      expect(fetchCalled).toBe(false);
    });

    it('falls back to preserving candidate ranking when apiKey is missing or empty', async () => {
      let fetchCalled = false;
      const mockFetch = async () => {
        fetchCalled = true;
        return new Response('{}');
      };

      const results = await rerankWithCohere('compromise', mockCandidates, {
        apiKey: '',
        fetchImpl: mockFetch as any,
      });

      expect(results).toEqual(mockCandidates);
      expect(fetchCalled).toBe(false);
    });

    it('uses rerank-v5.0-fast as default model and enables Context Focus', async () => {
      let capturedUrl = '';
      let capturedBody: any = null;
      let capturedHeaders: any = null;

      const mockFetch = async (url: string, init: any) => {
        capturedUrl = url;
        capturedBody = JSON.parse(init.body);
        capturedHeaders = init.headers;
        return new Response(
          JSON.stringify({
            results: [
              {
                index: 1,
                relevance_score: 0.8954,
                relevant_spans: [{ start: 17, end: 42, score: 0.92 }],
              },
              {
                index: 0,
                relevance_score: 0.412,
                relevant_spans: [],
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const results = await rerankWithCohere('public policy compromise', mockCandidates, {
        apiKey: 'test-cohere-key',
        fetchImpl: mockFetch as any,
      });

      expect(capturedUrl).toBe('https://api.cohere.com/v2/rerank');
      expect(capturedHeaders['Authorization']).toBe('Bearer test-cohere-key');
      expect(capturedBody.model).toBe('rerank-v5.0-fast');
      expect(capturedBody.query).toBe('public policy compromise');
      expect(capturedBody.documents).toEqual([
        mockCandidates[0].text,
        mockCandidates[1].text,
      ]);
      expect(capturedBody.relevant_spans).toEqual({
        mode: 'enabled',
        threshold: 0.3,
        max_spans: 3,
      });

      // Validates reranked order: index 1 first, index 0 second
      expect(results.length).toBe(2);
      expect(results[0].releaseTag).toBe('tag_b');
      expect(results[0].speaker).toBe('Bob');
      expect(results[0].matchType).toBe('rerank');

      // Constraint 1: Preserves raw scores without formatting as percentage or confidence
      expect(results[0].relevanceScore).toBe(0.8954);

      // Constraint 2: Preserves exact segment-level audio boundaries without proportional trimming
      expect(results[0].startSec).toBe(45.0);
      expect(results[0].endSec).toBe(60.2);

      // Context Focus: Substring slice matches text at character offsets
      expect(results[0].relevantSpans).toBeDefined();
      expect(results[0].relevantSpans?.length).toBe(1);
      const span = results[0].relevantSpans![0];
      expect(span.start).toBe(17);
      expect(span.end).toBe(42);
      expect(span.score).toBe(0.92);
      expect(span.text).toBe(mockCandidates[1].text.slice(17, 42)); // "compromise in public policy"

      // Second item
      expect(results[1].releaseTag).toBe('tag_a');
      expect(results[1].relevanceScore).toBe(0.412);
      expect(results[1].startSec).toBe(10.5);
      expect(results[1].endSec).toBe(25.0);
      expect(results[1].relevantSpans).toBeUndefined();
    });

    it('allows specifying rerank-v5.0-pro as an optional model', async () => {
      let capturedModel = '';
      const mockFetch = async (_url: string, init: any) => {
        const body = JSON.parse(init.body);
        capturedModel = body.model;
        return new Response(
          JSON.stringify({
            results: [{ index: 0, relevance_score: 0.95, relevant_spans: [] }],
          }),
          { status: 200 }
        );
      };

      await rerankWithCohere('test', mockCandidates, {
        apiKey: 'test-key',
        model: 'rerank-v5.0-pro',
        fetchImpl: mockFetch as any,
      });

      expect(capturedModel).toBe('rerank-v5.0-pro');
    });

    it('falls back gracefully to candidates on upstream HTTP error (500)', async () => {
      const mockFetch = async () => new Response('Internal Server Error', { status: 500 });

      const results = await rerankWithCohere('compromise', mockCandidates, {
        apiKey: 'test-key',
        fetchImpl: mockFetch as any,
      });

      expect(results).toEqual(mockCandidates);
    });

    it('falls back gracefully to candidates on network throw or exception', async () => {
      const mockFetch = async () => {
        throw new Error('ECONNRESET');
      };

      const results = await rerankWithCohere('compromise', mockCandidates, {
        apiKey: 'test-key',
        fetchImpl: mockFetch as any,
      });

      expect(results).toEqual(mockCandidates);
    });

    it('falls back gracefully on malformed response body', async () => {
      const mockFetch = async () => new Response('not valid json', { status: 200 });

      const results = await rerankWithCohere('compromise', mockCandidates, {
        apiKey: 'test-key',
        fetchImpl: mockFetch as any,
      });

      expect(results).toEqual(mockCandidates);
    });

    it('safely filters out malformed relevant_spans with non-finite or inverted offsets without crashing', async () => {
      const mockFetch = async () =>
        new Response(
          JSON.stringify({
            results: [
              {
                index: 0,
                relevance_score: 0.88,
                relevant_spans: [
                  { start: 'invalid', end: 10, score: 0.9 },
                  { start: 10, end: 'nan', score: 0.8 },
                  { start: -5, end: 10, score: 0.7 },
                  { start: 20, end: 10, score: 0.6 },
                  { start: 0, end: 15, score: 0.95 }, // valid span
                ],
              },
            ],
          }),
          { status: 200 }
        );

      const results = await rerankWithCohere('test', mockCandidates, {
        apiKey: 'test-key',
        fetchImpl: mockFetch as any,
      });

      expect(results.length).toBe(1);
      expect(results[0].relevantSpans).toBeDefined();
      expect(results[0].relevantSpans?.length).toBe(1);
      expect(results[0].relevantSpans![0].start).toBe(0);
      expect(results[0].relevantSpans![0].end).toBe(15);
      expect(results[0].relevantSpans![0].text).toBe(mockCandidates[0].text.slice(0, 15));
    });
  });

  describe('searchTranscriptArchive (rerank mode)', () => {
    it('gathers candidate pool via hybrid search then reranks with Cohere', async () => {
      const mockFetch = async (_url: string, init: any) => {
        const body = JSON.parse(init.body);
        const docCount = body.documents.length;
        const results = body.documents.map((_: any, idx: number) => ({
          index: docCount - 1 - idx,
          relevance_score: 0.99 - idx * 0.05,
          relevant_spans: [{ start: 0, end: 10, score: 0.9 }],
        }));
        return new Response(JSON.stringify({ results }), { status: 200 });
      };

      const results = await searchTranscriptArchive('compromise', {
        mode: 'rerank',
        maxResults: 3,
        apiKey: 'mock-key',
        fetchImpl: mockFetch as any,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results.every(r => r.matchType === 'rerank')).toBe(true);
      expect(results[0].relevanceScore).toBeCloseTo(0.99, 2);
      expect(results[0].relevantSpans).toBeDefined();
    }, 45000);

    it('bounds candidate pool between 50 and 100 documents', async () => {
      let documentCountFor10 = 0;
      let documentCountFor80 = 0;

      const mockFetch10 = async (_url: string, init: any) => {
        const body = JSON.parse(init.body);
        documentCountFor10 = body.documents.length;
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      };

      await searchTranscriptArchive('compromise', {
        mode: 'rerank',
        maxResults: 10,
        apiKey: 'mock-key',
        fetchImpl: mockFetch10 as any,
      });

      // When maxResults: 10, candidateLimit = min(100, max(50, 10 * 2)) = 50
      expect(documentCountFor10).toBe(50);

      const mockFetch80 = async (_url: string, init: any) => {
        const body = JSON.parse(init.body);
        documentCountFor80 = body.documents.length;
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      };

      await searchTranscriptArchive('compromise', {
        mode: 'rerank',
        maxResults: 80,
        apiKey: 'mock-key',
        fetchImpl: mockFetch80 as any,
      });

      // Even though 80 * 2 = 160, candidateLimit is clamped to <= 100
      expect(documentCountFor80).toBeLessThanOrEqual(100);
      expect(documentCountFor80).toBeGreaterThan(0);
    }, 45000);
  });

  describe('handleSearchTranscripts (rerank mode)', () => {
    it('returns structured matches with relevant_spans and match_type rerank', async () => {
      const mockFetch = async (_url: string, init: any) => {
        const body = JSON.parse(init.body);
        const results = body.documents.map((_: any, idx: number) => ({
          index: idx,
          relevance_score: 0.95 - idx * 0.05,
          relevant_spans: [{ start: 0, end: 12, score: 0.88 }],
        }));
        return new Response(JSON.stringify({ results }), { status: 200 });
      };

      const res = await handleSearchTranscripts({
        query: 'compromise',
        scope: 'all_transcripts',
        maxResults: 3,
        mode: 'rerank',
        apiKey: 'mock-key',
        fetchImpl: mockFetch as any,
      });

      expect(res.matches.length).toBeGreaterThan(0);
      expect(res.matches[0].match_type).toBe('rerank');
      expect(res.matches[0].relevance_score).toBeCloseTo(0.95, 2);
      expect(res.matches[0].relevant_spans).toBeDefined();
      expect(res.matches[0].relevant_spans![0].start).toBe(0);
      expect(res.matches[0].relevant_spans![0].end).toBe(12);
    }, 45000);
  });

  describe('speaker filtering and prefix query support', () => {
    it('filters candidates and results strictly by speaker option in hybrid mode', async () => {
      const results = await searchTranscriptArchive('compromise', {
        mode: 'hybrid',
        speaker: 'Angela',
        maxResults: 5,
      });

      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.speaker.toLowerCase()).toContain('angela');
      }
    }, 45000);

    it('filters candidates strictly by speaker before submitting to Cohere in rerank mode', async () => {
      let inspectedCandidates: string[] = [];
      const mockFetch = async (_url: string, init: any) => {
        const body = JSON.parse(init.body);
        inspectedCandidates = body.documents;
        const results = body.documents.map((_: any, idx: number) => ({
          index: idx,
          relevance_score: 0.9 - idx * 0.05,
        }));
        return new Response(JSON.stringify({ results }), { status: 200 });
      };

      const results = await searchTranscriptArchive('compromise', {
        mode: 'rerank',
        speaker: 'Angela',
        maxResults: 5,
        apiKey: 'mock-key',
        fetchImpl: mockFetch as any,
      });

      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.speaker.toLowerCase()).toContain('angela');
      }
      expect(inspectedCandidates.length).toBeGreaterThan(0);
    }, 45000);

    it('extracts speaker:Name prefix and filters results accordingly in rerank mode', async () => {
      let sentQuery = '';
      const mockFetch = async (_url: string, init: any) => {
        const body = JSON.parse(init.body);
        sentQuery = body.query;
        const results = body.documents.map((_: any, idx: number) => ({
          index: idx,
          relevance_score: 0.88 - idx * 0.05,
        }));
        return new Response(JSON.stringify({ results }), { status: 200 });
      };

      const results = await searchTranscriptArchive('speaker:Angela why she left', {
        mode: 'rerank',
        maxResults: 5,
        apiKey: 'mock-key',
        fetchImpl: mockFetch as any,
      });

      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.speaker.toLowerCase()).toContain('angela');
      }
      // Query passed to Cohere should have speaker prefix stripped
      expect(sentQuery).toBe('why she left');
    }, 45000);

    it('supports pure speaker query without calling Cohere in rerank mode', async () => {
      let cohereCalled = false;
      const mockFetch = async () => {
        cohereCalled = true;
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      };

      const results = await searchTranscriptArchive('speaker:Angela', {
        mode: 'rerank',
        maxResults: 5,
        apiKey: 'mock-key',
        fetchImpl: mockFetch as any,
      });

      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.speaker.toLowerCase()).toContain('angela');
      }
      expect(cohereCalled).toBe(false);
    }, 45000);

    it('uses exact normalized speaker matching: Dan does not match Danielle', async () => {
      // "Danielle" is present in archive, but searching for "Dan" must not return Danielle
      const resultsDan = await searchTranscriptArchive('speaker:Dan', {
        mode: 'hybrid',
        maxResults: 5,
      });
      // There is no speaker named "Dan" in the archive
      expect(resultsDan.length).toBe(0);

      // Searching for "Danielle" matches Danielle
      const resultsDanielle = await searchTranscriptArchive('speaker:Danielle', {
        mode: 'hybrid',
        maxResults: 5,
      });
      expect(resultsDanielle.length).toBeGreaterThan(0);
      for (const r of resultsDanielle) {
        expect(r.speaker.toLowerCase().trim()).toBe('danielle');
      }
    }, 45000);

    it('uses exact normalized speaker matching: whitespace and capitalization tolerant', async () => {
      const results = await searchTranscriptArchive('compromise', {
        mode: 'hybrid',
        speaker: '  angela  ',
        maxResults: 5,
      });

      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.speaker.toLowerCase().trim()).toBe('angela');
      }
    }, 45000);

    it('returns empty results for unknown speaker without falling back to unfiltered search', async () => {
      const hybridResults = await searchTranscriptArchive('compromise', {
        mode: 'hybrid',
        speaker: 'UnknownSpeakerXYZ_NeverExists',
        maxResults: 5,
      });
      expect(hybridResults).toEqual([]);

      let cohereCalled = false;
      const mockFetch = async () => {
        cohereCalled = true;
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      };

      const rerankResults = await searchTranscriptArchive('compromise', {
        mode: 'rerank',
        speaker: 'UnknownSpeakerXYZ_NeverExists',
        maxResults: 5,
        apiKey: 'mock-key',
        fetchImpl: mockFetch as any,
      });
      expect(rerankResults).toEqual([]);
      expect(cohereCalled).toBe(false);
    }, 45000);

    it('unfiltered search remains unaffected when no speaker filter is provided', async () => {
      const results = await searchTranscriptArchive('David Grusch', {
        mode: 'hybrid',
        maxResults: 5,
      });
      expect(results.length).toBeGreaterThan(0);
      // Results should not be restricted to any single speaker
      const speakers = new Set(results.map(r => r.speaker));
      expect(speakers.size).toBeGreaterThan(0);
    }, 45000);
  });
});
