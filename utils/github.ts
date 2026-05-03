import { GitHubUser, WorkflowRun, Release } from '../types';

const BASE = 'https://api.github.com';

async function ghFetch(token: string, path: string, options: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  return res;
}

function assertNotRateLimited(res: Response) {
  if (res.status === 429 || (res.status === 403 && res.headers.get('X-RateLimit-Remaining') === '0')) {
    const reset = res.headers.get('X-RateLimit-Reset');
    const msg = reset
      ? `GitHub rate limit reached. Resets at ${new Date(Number(reset) * 1000).toLocaleTimeString()}.`
      : 'GitHub rate limit reached. Try again in a few minutes.';
    throw new Error(msg);
  }
}

export async function validateToken(token: string): Promise<GitHubUser> {
  const res = await ghFetch(token, '/user');
  assertNotRateLimited(res);
  if (!res.ok) throw new Error('Invalid token or insufficient permissions.');
  return res.json();
}

export async function repoExists(token: string, owner: string, repo: string): Promise<boolean> {
  const res = await ghFetch(token, `/repos/${owner}/${repo}`);
  assertNotRateLimited(res);
  return res.ok;
}

export async function createRepo(token: string, name: string, description: string): Promise<void> {
  const res = await ghFetch(token, '/user/repos', {
    method: 'POST',
    body: JSON.stringify({ name, description, private: false, auto_init: true }),
  });
  assertNotRateLimited(res);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || 'Failed to create repository.');
  }
}

async function getFileSha(token: string, owner: string, repo: string, path: string): Promise<string | null> {
  const res = await ghFetch(token, `/repos/${owner}/${repo}/contents/${path}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.sha || null;
}

export async function pushFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
  isBinary = false
): Promise<void> {
  const sha = await getFileSha(token, owner, repo, path);
  const encoded = isBinary ? content : btoa(unescape(encodeURIComponent(content)));
  const body: Record<string, unknown> = { message, content: encoded };
  if (sha) body.sha = sha;
  const res = await ghFetch(token, `/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  assertNotRateLimited(res);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || `Failed to push ${path}`);
  }
}

export async function enablePages(token: string, owner: string, repo: string): Promise<void> {
  const res = await ghFetch(token, `/repos/${owner}/${repo}/pages`, {
    method: 'POST',
    body: JSON.stringify({ build_type: 'workflow' }),
  });
  assertNotRateLimited(res);
  if (!res.ok && res.status !== 409) {
    const res2 = await ghFetch(token, `/repos/${owner}/${repo}/pages`, {
      method: 'PUT',
      body: JSON.stringify({ build_type: 'workflow' }),
    });
    assertNotRateLimited(res2);
    if (!res2.ok && res2.status !== 409) {
      console.warn('Pages will be configured automatically on first workflow run.');
    }
  }
}

export async function getWorkflowRuns(token: string, owner: string, repo: string): Promise<WorkflowRun[]> {
  const res = await ghFetch(token, `/repos/${owner}/${repo}/actions/runs?per_page=30`);
  assertNotRateLimited(res);
  if (!res.ok) {
    if (res.status === 404) throw new Error('Repository not found or Actions not enabled.');
    throw new Error('Could not fetch workflow runs. Check your token permissions.');
  }
  const data = await res.json();
  return data.workflow_runs || [];
}

export async function getReleases(token: string, owner: string, repo: string): Promise<Release[]> {
  const all: Release[] = [];
  let page = 1;
  while (true) {
    const res = await ghFetch(token, `/repos/${owner}/${repo}/releases?per_page=100&page=${page}`);
    assertNotRateLimited(res);
    if (!res.ok) {
      if (res.status === 404) return [];
      throw new Error('Could not fetch releases.');
    }
    const batch: Release[] = await res.json();
    if (!batch.length) break;
    all.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return all.filter(r => !r.draft && !r.prerelease);
}

export async function dispatchWorkflow(
  token: string,
  owner: string,
  repo: string,
  workflowFile: string,
  inputs: Record<string, string> = {}
): Promise<void> {
  const res = await ghFetch(token, `/repos/${owner}/${repo}/actions/workflows/${workflowFile}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref: 'main', inputs }),
  });
  assertNotRateLimited(res);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message || 'Failed to dispatch workflow.');
  }
}

export async function fetchRssXml(url: string): Promise<string> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Feed returned HTTP ${res.status}. Has the repo been deployed to GitHub Pages?`);
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('xml') && !ct.includes('text')) {
    throw new Error(`Unexpected content type: ${ct}`);
  }
  return res.text();
}

export async function fetchAssetText(url: string): Promise<string> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not fetch asset (HTTP ${res.status}).`);
  return res.text();
}

export async function dataUrlToBase64(dataUrl: string): Promise<string> {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) throw new Error('Invalid image data: expected a base64 data URL.');
  return dataUrl.slice(commaIdx + 1);
}
