import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EnhancedConfig } from '../../types';
import {
  parseBatchUrlsInput,
  validateBatchSubmission,
  friendlyGitHubError,
} from '../submitSpace';
import * as github from '../github';

describe('Batch Episode Submission', () => {
  const baseConfig: EnhancedConfig = {
    repoName: 'my-podcast',
    ownerName: 'my-org',
    githubToken: 'ghp_secret123',
    authorName: 'Logan Black',
    podcastTitle: 'Test Podcast',
    podcastDescription: 'Description',
    email: 'test@example.com',
    imageUrl: 'https://example.com/art.png',
    artworkDataUrl: '',
    platforms: ['twitter'],
    batchUrls: [],
    enableTranscription: true,
    enableSlackWebhook: false,
    slackWebhookUrl: '',
    enableDiscordWebhook: false,
    discordWebhookUrl: '',
    enableScheduledMonitoring: false,
    scheduledCron: '0 * * * *',
  };

  describe('parseBatchUrlsInput', () => {
    it('parses newline-delimited URLs', () => {
      const raw = `
        https://x.com/i/spaces/1DXxyvjZpZQKM
        https://x.com/i/spaces/1eaKbgElQanGX
      `;
      const result = parseBatchUrlsInput(raw);
      expect(result).toEqual([
        'https://x.com/i/spaces/1DXxyvjZpZQKM',
        'https://x.com/i/spaces/1eaKbgElQanGX',
      ]);
    });

    it('parses comma-separated URLs', () => {
      const raw = 'https://x.com/i/spaces/1DXxyvjZpZQKM, https://x.com/i/spaces/1eaKbgElQanGX';
      const result = parseBatchUrlsInput(raw);
      expect(result).toEqual([
        'https://x.com/i/spaces/1DXxyvjZpZQKM',
        'https://x.com/i/spaces/1eaKbgElQanGX',
      ]);
    });

    it('ignores comments and empty lines', () => {
      const raw = `
        # My favorite spaces
        https://x.com/i/spaces/1DXxyvjZpZQKM

        # Another one
        https://x.com/i/spaces/1eaKbgElQanGX
      `;
      const result = parseBatchUrlsInput(raw);
      expect(result).toEqual([
        'https://x.com/i/spaces/1DXxyvjZpZQKM',
        'https://x.com/i/spaces/1eaKbgElQanGX',
      ]);
    });
  });

  describe('validateBatchSubmission', () => {
    it('returns error when URL list is empty', () => {
      const err = validateBatchSubmission([], baseConfig);
      expect(err).toMatch(/at least one valid Space/i);
    });

    it('returns error when URLs are not http/https', () => {
      const err = validateBatchSubmission(['invalid-text', 'not-a-url'], baseConfig);
      expect(err).toMatch(/at least one valid Space/i);
    });

    it('returns error when githubToken is missing', () => {
      const err = validateBatchSubmission(
        ['https://x.com/i/spaces/1DXxyvjZpZQKM'],
        { ...baseConfig, githubToken: '' }
      );
      expect(err).toMatch(/connect github/i);
    });

    it('returns error when repoName or ownerName is missing', () => {
      const err = validateBatchSubmission(
        ['https://x.com/i/spaces/1DXxyvjZpZQKM'],
        { ...baseConfig, repoName: '' }
      );
      expect(err).toMatch(/configuration/i);
    });

    it('returns null when valid', () => {
      const err = validateBatchSubmission(
        ['https://x.com/i/spaces/1DXxyvjZpZQKM', 'https://youtu.be/12345'],
        baseConfig
      );
      expect(err).toBeNull();
    });
  });

  describe('friendlyGitHubError for batch actions', () => {
    it('handles 404 for workflow dispatch', () => {
      const err = new github.GitHubApiError('Not found', 404);
      const msg = friendlyGitHubError(err, 'dispatch');
      expect(msg).toContain('ingest workflow was not found');
    });

    it('handles 422 for workflow dispatch', () => {
      const err = new github.GitHubApiError('Unprocessable', 422);
      const msg = friendlyGitHubError(err, 'dispatch');
      expect(msg).toContain('could not start the workflow');
    });

    it('handles 404 for queue update', () => {
      const err = new github.GitHubApiError('Not found', 404);
      const msg = friendlyGitHubError(err, 'queue');
      expect(msg).toContain('default branch was not found');
    });
  });

  describe('appendLinesToRepositoryTextFile', () => {
    it('returns 0 added when input lines are empty', async () => {
      const result = await github.appendLinesToRepositoryTextFile(
        'token',
        'owner',
        'repo',
        'batch_queue.txt',
        ['  ', ''],
        'msg'
      );
      expect(result).toEqual({ addedCount: 0, totalCount: 0 });
    });

    it('appends lines and commits updated content', async () => {
      const originalFetch = globalThis.fetch;
      const fetchCalls: Array<{ url: string; method?: string; body?: any }> = [];

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        const method = init?.method || 'GET';
        let body: any = undefined;
        if (init?.body && typeof init.body === 'string') {
          try {
            body = JSON.parse(init.body);
          } catch {
            body = init.body;
          }
        }
        fetchCalls.push({ url, method, body });

        // 1. getRepositoryDefaultBranch: /repos/owner/repo
        if (url.endsWith('/repos/owner/repo')) {
          return new Response(JSON.stringify({ default_branch: 'main' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // 2. readRepositoryTextFile: /contents/batch_queue.txt
        if (url.includes('/contents/batch_queue.txt') && method === 'GET') {
          const contentBase64 = Buffer.from('https://x.com/i/spaces/existing1\n').toString('base64');
          return new Response(
            JSON.stringify({
              type: 'file',
              content: contentBase64,
              encoding: 'base64',
              sha: 'sha123',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        // 3. writeRepositoryTextFile: PUT /contents/batch_queue.txt
        if (url.includes('/contents/batch_queue.txt') && method === 'PUT') {
          return new Response(JSON.stringify({ commit: { sha: 'commit456' } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({}), { status: 200 });
      });

      try {
        const result = await github.appendLinesToRepositoryTextFile(
          'token',
          'owner',
          'repo',
          'batch_queue.txt',
          [
            'https://x.com/i/spaces/new1',
            'https://x.com/i/spaces/new2',
          ],
          'chore(queue): batch enqueue'
        );

        expect(result).toEqual({ addedCount: 2, totalCount: 3 });

        const putCall = fetchCalls.find(c => c.method === 'PUT');
        expect(putCall).toBeDefined();
        const decodedContent = Buffer.from(putCall?.body?.content, 'base64').toString('utf8');
        expect(decodedContent).toBe(
          'https://x.com/i/spaces/existing1\nhttps://x.com/i/spaces/new1\nhttps://x.com/i/spaces/new2\n'
        );
        expect(putCall?.body?.sha).toBe('sha123');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('creates file cleanly when current is null (file did not exist)', async () => {
      const originalFetch = globalThis.fetch;
      const fetchCalls: Array<{ url: string; method?: string; body?: any }> = [];

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        const method = init?.method || 'GET';
        let body: any = undefined;
        if (init?.body && typeof init.body === 'string') {
          try {
            body = JSON.parse(init.body);
          } catch {
            body = init.body;
          }
        }
        fetchCalls.push({ url, method, body });

        if (url.endsWith('/repos/owner/repo')) {
          return new Response(JSON.stringify({ default_branch: 'main' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // Return 404 when reading batch_queue.txt
        if (url.includes('/contents/batch_queue.txt') && method === 'GET') {
          return new Response(JSON.stringify({ message: 'Not Found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // PUT succeeds
        if (url.includes('/contents/batch_queue.txt') && method === 'PUT') {
          return new Response(JSON.stringify({ commit: { sha: 'commit789' } }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({}), { status: 200 });
      });

      try {
        const result = await github.appendLinesToRepositoryTextFile(
          'token',
          'owner',
          'repo',
          'batch_queue.txt',
          ['https://x.com/i/spaces/new1'],
          'chore(queue): batch enqueue'
        );

        expect(result).toEqual({ addedCount: 1, totalCount: 1 });

        const putCall = fetchCalls.find(c => c.method === 'PUT');
        expect(putCall).toBeDefined();
        const decodedContent = Buffer.from(putCall?.body?.content, 'base64').toString('utf8');
        expect(decodedContent).toBe('https://x.com/i/spaces/new1\n');
        expect(putCall?.body?.sha).toBeUndefined();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
