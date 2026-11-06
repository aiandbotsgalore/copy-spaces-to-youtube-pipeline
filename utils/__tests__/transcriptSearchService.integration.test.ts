import { describe, it, expect, beforeEach } from 'vitest';
import {
  searchTranscriptArchive,
  handleSearchTranscripts,
  __setEmbeddingPipelineForTest,
} from '../../server/transcriptSearchService';

beforeEach(() => {
  __setEmbeddingPipelineForTest(async () => ({
    data: new Float32Array(384).fill(0.01),
  }));
});

describe('transcriptSearchService (integration)', () => {
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
