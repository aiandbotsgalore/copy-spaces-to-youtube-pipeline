/**
 * Safe JSON fetch utilities that prevent Vite SPA HTML fallbacks (200 OK text/html)
 * from throwing `SyntaxError: Unexpected token '<'` and support AbortSignal cleanly.
 */

export async function safeFetchJson<T = unknown>(
  url: string,
  init?: RequestInit
): Promise<T | null> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) return null;

    const ct = (res.headers?.get?.('content-type') || '').toLowerCase();
    if (ct.includes('text/html') || ct.includes('application/xhtml+xml')) {
      return null;
    }

    if (typeof res.text === 'function') {
      const text = await res.text();
      const trimmed = text.trim();
      if (!trimmed || trimmed.startsWith('<')) {
        return null;
      }
      return JSON.parse(trimmed) as T;
    }

    return (await res.json()) as T;
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err;
    return null;
  }
}

export async function fetchJsonCandidates<T = unknown>(
  urls: string[],
  init?: RequestInit & { validate?: (data: T) => boolean }
): Promise<{ data: T; url: string } | null> {
  const { validate, ...fetchInit } = init || {};
  for (const url of urls) {
    if (fetchInit.signal?.aborted) break;
    const data = await safeFetchJson<T>(url, fetchInit);
    if (data !== null && (!validate || validate(data))) {
      return { data, url };
    }
  }
  return null;
}

export async function safeReadErrorPayload(res: Response): Promise<{
  isHtml: boolean;
  message: string;
  code?: string;
  data?: any;
}> {
  const ct = (res.headers?.get?.('content-type') || '').toLowerCase();
  if (ct.includes('text/html')) {
    return {
      isHtml: true,
      message: `Endpoint returned HTML (${res.status}) — backend server may be offline.`,
    };
  }
  try {
    let data: any = {};
    if (typeof res.text === 'function') {
      const text = await res.text();
      const trimmed = text.trim();
      if (trimmed.startsWith('<')) {
        return {
          isHtml: true,
          message: `Endpoint returned HTML (${res.status}) — backend server may be offline.`,
        };
      }
      data = trimmed ? JSON.parse(trimmed) : {};
    } else if (typeof res.json === 'function') {
      data = await res.json();
    }
    return {
      isHtml: false,
      message: data?.message || data?.error || `HTTP ${res.status}`,
      code: data?.code,
      data,
    };
  } catch {
    return {
      isHtml: false,
      message: `HTTP ${res.status}`,
    };
  }
}
