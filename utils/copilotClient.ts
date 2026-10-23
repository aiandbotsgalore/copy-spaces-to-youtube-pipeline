import type { CopilotRequestBody, CopilotResponseBody } from './copilotTypes';
import { loadDirectorKey } from './storage';

export interface SendCopilotOptions {
  req: CopilotRequestBody;
  backupKey?: string;
  signal?: AbortSignal;
}

export async function sendCopilotMessage(options: SendCopilotOptions): Promise<CopilotResponseBody> {
  const { req, backupKey, signal } = options;
  const key = (backupKey || loadDirectorKey() || '').trim();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (key) {
    headers['x-director-key'] = key;
  }

  const res = await fetch('/api/montage/direct/copilot', {
    method: 'POST',
    headers,
    body: JSON.stringify(req),
    signal,
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    const errorMsg = json?.message || `Copilot request failed with status ${res.status}`;
    const errCode = json?.code || 'UPSTREAM';
    throw new Error(`[${errCode}] ${errorMsg}`);
  }

  return json as CopilotResponseBody;
}
