import type { CopilotRequestBody, CopilotResponseBody, TranscriptMatch } from './copilotTypes';
import { loadDirectorKey } from './storage';
import { safeReadErrorPayload } from './safeFetch';
import { formatTimestamp } from './copilotText';

export interface SendCopilotOptions {
  req: CopilotRequestBody;
  backupKey?: string;
  githubToken?: string;
  signal?: AbortSignal;
}

function runOfflineCopilotFallback(req: CopilotRequestBody, startMs: number, reason: string): CopilotResponseBody {
  const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')?.content || '';
  const terms = lastUser
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);

  const ep = req.context?.currentEpisode;
  const segments = ep?.allSegments || ep?.segmentsSample || [];
  const matches: TranscriptMatch[] = [];

  if (segments.length > 0) {
    const scored = segments
      .map((seg) => {
        const hay = `${seg.speaker} ${seg.text}`.toLowerCase();
        const score = terms.reduce((acc, term) => (hay.includes(term) ? acc + 1 : acc), 0);
        return { seg, score };
      })
      .filter((item) => (terms.length > 0 ? item.score > 0 : true))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    for (const { seg, score } of scored) {
      matches.push({
        episode_title: ep?.title || ep?.releaseTag || 'Active Episode',
        episode_id: ep?.releaseTag || String(ep?.releaseId || ''),
        speaker: seg.speaker || 'Speaker',
        start_timestamp: seg.start,
        end_timestamp: seg.end,
        formatted_time: formatTimestamp(seg.start),
        snippet: seg.text,
        audio_url: ep?.audioUrl,
        relevance_score: score,
      });
    }
  }

  const lines: string[] = [
    `> **Local Fallback Mode** (${reason}) — answering directly from loaded studio context.`,
    '',
  ];

  if (matches.length > 0) {
    lines.push(`Found **${matches.length}** matching transcript excerpt(s) in **${ep?.title || ep?.releaseTag || 'current episode'}**:`);
    for (const m of matches) {
      const mm = Math.floor(m.start_timestamp / 60);
      const ss = Math.floor(m.start_timestamp % 60).toString().padStart(2, '0');
      lines.push(`- **${m.speaker}** (${mm}:${ss}): "${m.snippet.slice(0, 220)}${m.snippet.length > 220 ? '…' : ''}"`);
    }
  } else if (req.context?.clipCatalogSample?.length) {
    lines.push(`Loaded **${req.context.clipCatalogSample.length}** catalog clips in context. Connect the local Vite dev server (\`npm run dev\`) with your Gemini/Director key for full generative synthesis.`);
  } else {
    lines.push(`No live \`/api/montage/direct/copilot\` backend is reachable right now, and no transcript segments are loaded in context. Open an episode in **Transcripts** or run via \`npm run dev\` for full AI synthesis.`);
  }

  return {
    ok: true,
    text: lines.join('\n'),
    actions: [],
    matches,
    model: 'local-fallback',
    usage: { promptTokens: 0, completionTokens: 0 },
    ms: Date.now() - startMs,
  };
}

export async function sendCopilotMessage(options: SendCopilotOptions): Promise<CopilotResponseBody> {
  const { req, backupKey, githubToken, signal } = options;
  const startMs = Date.now();
  const key = (backupKey || loadDirectorKey() || '').trim();
  const ghToken = (githubToken || (req.context as any)?.githubToken || '').trim();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (key) {
    headers['x-director-key'] = key;
  }
  if (ghToken) {
    headers['x-github-token'] = ghToken;
  }

  let res: Response;
  try {
    res = await fetch('/api/montage/direct/copilot', {
      method: 'POST',
      headers,
      body: JSON.stringify(req),
      signal,
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err;
    if (err instanceof TypeError) {
      return runOfflineCopilotFallback(req, startMs, 'network offline');
    }
    throw err;
  }

  if (!res.ok) {
    const errInfo = await safeReadErrorPayload(res);
    if (res.status === 404 || errInfo.isHtml) {
      return runOfflineCopilotFallback(req, startMs, `HTTP ${res.status}`);
    }
    const errCode = errInfo.code || 'UPSTREAM';
    throw new Error(`[${errCode}] ${errInfo.message || `Copilot request failed with status ${res.status}`}`);
  }

  const ct = (res.headers?.get?.('content-type') || '').toLowerCase();
  if (ct.includes('text/html')) {
    return runOfflineCopilotFallback(req, startMs, 'static SPA host');
  }

  if (typeof res.text === 'function') {
    const text = await res.text();
    if (!text || text.trim().startsWith('<')) {
      return runOfflineCopilotFallback(req, startMs, 'static HTML response');
    }
    return JSON.parse(text) as CopilotResponseBody;
  }

  return (await res.json()) as CopilotResponseBody;
}
