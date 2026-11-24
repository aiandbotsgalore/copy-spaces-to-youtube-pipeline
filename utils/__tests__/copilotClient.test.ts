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

  it('serializes message attachments properly in post body', async () => {
    const mockResponse = {
      ok: true,
      text: 'Analyzing the attached image and document.',
      actions: [],
      model: 'mercury-3',
      usage: { promptTokens: 120, completionTokens: 60 },
      ms: 180,
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });

    globalThis.fetch = mockFetch;

    const attachments = [
      {
        id: 'att_1',
        name: 'architecture.png',
        size: 50000,
        type: 'image' as const,
        mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,abc123',
      },
      {
        id: 'att_2',
        name: 'notes.md',
        size: 1024,
        type: 'document' as const,
        mimeType: 'text/markdown',
        textContent: '# System Architecture Notes',
      },
    ];

    const result = await sendCopilotMessage({
      req: {
        messages: [
          {
            role: 'user',
            content: 'Please review these files.',
            attachments,
          },
        ],
        model: 'mercury-3',
      },
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const bodySent = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(bodySent.messages[0].attachments).toHaveLength(2);
    expect(bodySent.messages[0].attachments[0].name).toBe('architecture.png');
    expect(bodySent.messages[0].attachments[1].textContent).toBe('# System Architecture Notes');
    expect(result).toEqual(mockResponse);
  });
});
