import { GitHubUser, WorkflowRun } from '../types';

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

export async function validateToken(token: string): Promise<GitHubUser> {
  const res = await ghFetch(token, '/user');
  if (!res.ok) throw new Error('Invalid token or insufficient permissions.');
  return res.json();
}

export async function repoExists(token: string, owner: string, repo: string): Promise<boolean> {
  const res = await ghFetch(token, `/repos/${owner}/${repo}`);
  return res.ok;
}

export async function createRepo(token: string, name: string, description: string): Promise<void> {
  const res = await ghFetch(token, '/user/repos', {
    method: 'POST',
    body: JSON.stringify({
      name,
      description,
      private: false,
      auto_init: true,
    }),
  });
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
  const body: Record<string, unknown> = {
    message,
    content: encoded,
  };
  if (sha) body.sha = sha;
  const res = await ghFetch(token, `/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || `Failed to push ${path}`);
  }
}

export async function enablePages(token: string, owner: string, repo: string): Promise<void> {
  const res = await ghFetch(token, `/repos/${owner}/${repo}/pages`, {
    method: 'POST',
    body: JSON.stringify({ source: { branch: 'gh-pages', path: '/' } }),
  });
  if (!res.ok && res.status !== 409) {
    const res2 = await ghFetch(token, `/repos/${owner}/${repo}/pages`, {
      method: 'PUT',
      body: JSON.stringify({ source: { branch: 'gh-pages', path: '/' } }),
    });
    if (!res2.ok && res2.status !== 409) {
      console.warn('Pages may need manual configuration via the Actions workflow.');
    }
  }
}

export async function getWorkflowRuns(token: string, owner: string, repo: string): Promise<WorkflowRun[]> {
  const res = await ghFetch(token, `/repos/${owner}/${repo}/actions/runs?per_page=20`);
  if (!res.ok) throw new Error('Could not fetch workflow runs.');
  const data = await res.json();
  return data.workflow_runs || [];
}

export async function dataUrlToBase64(dataUrl: string): Promise<string> {
  const base64 = dataUrl.split(',')[1];
  return base64;
}
