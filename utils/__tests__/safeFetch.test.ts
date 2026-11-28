import { describe, it, expect, vi, afterEach } from 'vitest';
import { safeFetchJson, fetchJsonCandidates } from '../safeFetch';
import { sendCopilotMessage } from '../copilotClient';
import { validateSubmission } from '../submitSpace';
import { confirmLeaveAsync, setUnsavedGuard } from '../unsavedGuard';
import { DEFAULT_CONFIG } from '../../contexts/ConfigContext';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('P0/P1 regression coverage', () => {
  it('safeFetchJson returns null without throwing when server returns Vite SPA HTML', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('<!doctype html><html><body>SPA</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    );
    const result = await safeFetchJson('/clips/clips_catalog.json');
    expect(result).toBeNull();
  });

  it('safeFetchJson accepts text/plain JSON (raw.githubusercontent.com)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, count: 3 }), {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    );
    const result = await safeFetchJson<{ ok: boolean; count: number }>('https://raw.githubusercontent.com/o/r/master/test.json');
    expect(result).toEqual({ ok: true, count: 3 });
  });

  it('fetchJsonCandidates skips HTML responses and returns first valid JSON candidate', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('<html>fallback</html>', { status: 200, headers: { 'content-type': 'text/html' } })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: '1' }]), { status: 200, headers: { 'content-type': 'application/json' } })
      );

    const hit = await fetchJsonCandidates<any[]>(['/missing.json', '/raw.json'], {
      validate: d => Array.isArray(d) && d.length > 0,
    });
    expect(hit).toEqual({ data: [{ id: '1' }], url: '/raw.json' });
  });

  it('sendCopilotMessage falls back cleanly on 404 or HTML SPA responses using episode segments', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('<!doctype html><html>404</html>', {
        status: 404,
        headers: { 'content-type': 'text/html' },
      })
    );

    const res = await sendCopilotMessage({
      req: {
        messages: [{ role: 'user', content: 'Find quotes about eviction' }],
        context: {
          currentEpisode: {
            releaseTag: 'ep-1',
            title: 'Test Episode',
            allSegments: [
              { speaker: 'Angela', text: 'We handled the eviction notice directly.', start: 120, end: 130 },
              { speaker: 'Logan', text: 'Unrelated remark.', start: 200, end: 210 },
            ],
          },
        },
      },
    });

    expect(res.ok).toBe(true);
    expect(res.model).toBe('local-fallback');
    expect(res.matches?.length).toBe(1);
    expect(res.matches?.[0].speaker).toBe('Angela');
  });

  it('validateSubmission rejects bare X profile URLs from TrackedProfiles handoff', () => {
    const cfg = { ...DEFAULT_CONFIG, githubToken: 'tok', ownerName: 'o', repoName: 'r' };
    expect(validateSubmission('https://x.com/AngelaMaggard3', cfg)).toMatch(/profile URL/i);
    expect(validateSubmission('https://x.com/i/spaces/1abcXYZ', cfg)).toBeNull();
  });

  it('confirmLeaveAsync uses async modal callback when unsaved guard is active', async () => {
    const clear = setUnsavedGuard(() => 'Script Studio has unsaved edits.');
    try {
      const denied = await confirmLeaveAsync(async () => false);
      const allowed = await confirmLeaveAsync(async () => true);
      expect(denied).toBe(false);
      expect(allowed).toBe(true);
    } finally {
      clear();
    }
  });
});
