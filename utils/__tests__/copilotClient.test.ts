import { describe, it, expect, vi } from 'vitest';
import { sendCopilotMessage } from '../copilotClient';

describe('copilotClient', () => {
  it('posts request to /api/montage/direct/copilot with json headers', async () => {
    const mockResponse = {
      ok: true,
      text: 'I found a great clip for your reel.',
      actions: [],
      model: 'claude-sonnet-5.5',
      usage: { promptTokens: 100, completionTokens: 50 },
      ms: 250,
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });

    globalThis.fetch = mockFetch;

    const result = await sendCopilotMessage({
      req: {
        messages: [{ role: 'user', content: 'Scan transcript' }],
        model: 'claude-sonnet-5.5',
      },
      backupKey: 'test-backup-key-12345',
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/montage/direct/copilot');
    const init = mockFetch.mock.calls[0][1];
    expect(init.method).toBe('POST');
    expect(init.headers['x-director-key']).toBe('test-backup-key-12345');
    expect(result).toEqual(mockResponse);
  });

  it('throws friendly error message when upstream fails', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ code: 'NO_KEY', message: 'No API key configured.' }),
    });

    globalThis.fetch = mockFetch;

    await expect(
      sendCopilotMessage({
        req: { messages: [{ role: 'user', content: 'test' }] },
      })
    ).rejects.toThrow('[NO_KEY] No API key configured.');
  });
});
