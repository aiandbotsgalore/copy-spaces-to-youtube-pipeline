import { GitHubUser, WorkflowRun, Release } from '../types';

const BASE = 'https://api.github.com';

export class GitHubApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
  }
}

export interface RepositoryTextFile {
  content: string;
  sha: string;
}

async function ghFetch(token: string, path: string, options: RequestInit = {}) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(options.headers as Record<string, string> || {}),
  };
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, {
    ...options,
    headers,
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

async function githubError(res: Response, fallback: string): Promise<GitHubApiError> {
  const data = await res.json().catch(() => ({})) as { message?: string };
  return new GitHubApiError(data.message || fallback, res.status);
}

function encodeRepositoryPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function encodeText(content: string): string {
  const bytes = new TextEncoder().encode(content);
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function decodeText(content: string): string {
  const binary = atob(content.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
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

export async function getRepositoryDefaultBranch(
  token: string,
  owner: string,
  repo: string
): Promise<string> {
  const res = await ghFetch(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
  assertNotRateLimited(res);
  if (!res.ok) throw await githubError(res, 'Could not read the repository settings.');
  const data = await res.json() as { default_branch?: string };
  if (!data.default_branch) throw new Error('The repository does not have a default branch yet.');
  return data.default_branch;
}

export async function readRepositoryTextFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  branch: string
): Promise<RepositoryTextFile | null> {
  const encodedPath = encodeRepositoryPath(path);
  const res = await ghFetch(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`
  );
  assertNotRateLimited(res);
  if (res.status === 404) return null;
  if (!res.ok) throw await githubError(res, `Could not read ${path}.`);
  const data = await res.json() as { content?: string; encoding?: string; sha?: string; type?: string };
  if (data.type !== 'file' || data.encoding !== 'base64' || !data.sha || data.content === undefined) {
    throw new Error(`${path} is not a readable text file.`);
  }
  return { content: decodeText(data.content), sha: data.sha };
}

export async function writeRepositoryTextFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
  branch: string,
  sha?: string
): Promise<void> {
  const encodedPath = encodeRepositoryPath(path);
  const body: Record<string, string> = {
    message,
    content: encodeText(content),
    branch,
  };
  if (sha) body.sha = sha;

  const res = await ghFetch(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`,
    { method: 'PUT', body: JSON.stringify(body) }
  );
  assertNotRateLimited(res);
  if (!res.ok) throw await githubError(res, `Could not update ${path}.`);
}

export async function appendLineToRepositoryTextFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  line: string,
  message: string,
  maxAttempts = 3
): Promise<void> {
  const branch = await getRepositoryDefaultBranch(token, owner, repo);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const current = await readRepositoryTextFile(token, owner, repo, path, branch);
    const existing = current?.content.replace(/(?:\r?\n)+$/, '') || '';
    const updated = existing ? `${existing}\n${line}\n` : `${line}\n`;

    try {
      await writeRepositoryTextFile(token, owner, repo, path, updated, message, branch, current?.sha);
      return;
    } catch (error) {
      const isConflict = error instanceof GitHubApiError && (error.status === 409 || error.status === 422);
      if (!isConflict || attempt === maxAttempts) {
        if (isConflict) {
          throw new Error(`Queue update conflict after ${maxAttempts} attempts. Reload and try again.`);
        }
        throw error;
      }
    }
  }
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
  inputs: Record<string, string> = {},
  ref?: string
): Promise<void> {
  const branch = ref || await getRepositoryDefaultBranch(token, owner, repo);
  const res = await ghFetch(token, `/repos/${owner}/${repo}/actions/workflows/${workflowFile}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref: branch, inputs }),
  });
  assertNotRateLimited(res);
  if (!res.ok) {
    throw await githubError(res, 'Failed to dispatch workflow.');
  }
}

export async function deleteRelease(token: string, owner: string, repo: string, releaseId: number): Promise<void> {
  const res = await ghFetch(token, `/repos/${owner}/${repo}/releases/${releaseId}`, { method: 'DELETE' });
  assertNotRateLimited(res);
  if (!res.ok && res.status !== 404) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message || `Failed to delete release ${releaseId}.`);
  }
}

export async function uploadReleaseAsset(
  token: string,
  owner: string,
  repo: string,
  releaseId: number,
  assetName: string,
  content: string,
  contentType: string = 'text/plain; charset=utf-8'
): Promise<void> {
  const isLocal = typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname.startsWith('10.') ||
    window.location.hostname.startsWith('192.168.')
  );

  if (isLocal) {
    try {
      const res = await fetch(`/api/upload-asset?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}&releaseId=${releaseId}&name=${encodeURIComponent(assetName)}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': contentType,
        },
        body: content,
      });
      if (res.ok) return;
    } catch (e) {
      console.warn('Local proxy upload error, falling back:', e);
    }
  }

  const uploadUrl = `https://uploads.github.com/repos/${owner}/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(assetName)}`;
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': contentType,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: content,
  });
  assertNotRateLimited(res);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message || `Failed to upload ${assetName} to release.`);
  }
}

export async function updateReleaseTranscriptAssets(
  token: string,
  owner: string,
  repo: string,
  release: Release,
  updatedTxtContent: string,
  updatedJsonContent?: string
): Promise<void> {
  const baseTag = release.tag_name || `episode_${release.id}`;
  const baseName = (release.name || release.tag_name || 'transcript').replace(/[^a-zA-Z0-9_-]/g, '_');
  const txtPath = `transcripts/${baseTag}.txt`;
  const jsonPath = `transcripts/${baseTag}.json`;

  // 1. Commit to git repository (100% CORS-supported official GitHub API)
  try {
    const branch = await getRepositoryDefaultBranch(token, owner, repo).catch(() => 'master');
    const existingTxt = await readRepositoryTextFile(token, owner, repo, txtPath, branch).catch(() => null);
    await writeRepositoryTextFile(
      token,
      owner,
      repo,
      txtPath,
      updatedTxtContent,
      `chore(transcripts): update speaker names for ${release.tag_name} [skip ci]`,
      branch,
      existingTxt?.sha
    );

    if (updatedJsonContent) {
      const existingJson = await readRepositoryTextFile(token, owner, repo, jsonPath, branch).catch(() => null);
      await writeRepositoryTextFile(
        token,
        owner,
        repo,
        jsonPath,
        updatedJsonContent,
        `chore(transcripts): update speaker json for ${release.tag_name} [skip ci]`,
        branch,
        existingJson?.sha
      );
    }
  } catch (gitErr) {
    console.warn('Repository file commit warning:', gitErr);
  }

  // 2. Delete existing txt and json release assets before uploading replacements
  for (const asset of release.assets) {
    if (asset.name.endsWith('.txt') || (updatedJsonContent && asset.name.endsWith('.json'))) {
      try {
        await ghFetch(token, `/repos/${owner}/${repo}/releases/assets/${asset.id}`, {
          method: 'DELETE',
        });
      } catch (delErr) {
        console.warn(`Could not delete old asset ${asset.name}:`, delErr);
      }
    }
  }

  // 3. Upload updated txt and json release assets
  const txtName = `${baseName}.txt`;
  await uploadReleaseAsset(token, owner, repo, release.id, txtName, updatedTxtContent, 'text/plain; charset=utf-8').catch(err => {
    console.warn('Release asset txt upload warning:', err);
  });

  if (updatedJsonContent) {
    const jsonName = `${baseName}.json`;
    await uploadReleaseAsset(token, owner, repo, release.id, jsonName, updatedJsonContent, 'application/json').catch(err => {
      console.warn('Release asset json upload warning:', err);
    });
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

export async function fetchReleaseAssetText(
  token: string,
  asset: { id?: number; url?: string; browser_download_url: string },
  owner?: string,
  repo?: string
): Promise<string> {
  const isLocal = typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname.startsWith('10.') ||
    window.location.hostname.startsWith('192.168.')
  );

  // 1. If running on local Vite server, use the asset proxy
  if (isLocal && asset.browser_download_url) {
    try {
      const proxyRes = await fetch(`/api/fetch-asset?url=${encodeURIComponent(asset.browser_download_url)}`);
      if (proxyRes.ok) {
        return await proxyRes.text();
      }
    } catch (e) {
      console.warn('Proxy asset fetch failed, falling back:', e);
    }
  }

  // 2. Try GitHub API
  const assetApiUrl = asset.url || (asset.id && owner && repo ? `https://api.github.com/repos/${owner}/${repo}/releases/assets/${asset.id}` : null);
  if (assetApiUrl && token) {
    try {
      const res = await ghFetch(token, assetApiUrl, {
        headers: {
          Accept: 'application/octet-stream',
        },
      });
      if (res.ok) {
        return await res.text();
      }
    } catch (e) {
      console.warn('API asset fetch failed, falling back to direct URL:', e);
    }
  }

  // 3. Direct browser download fallback
  const res = await fetch(asset.browser_download_url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not fetch asset (HTTP ${res.status}).`);
  return res.text();
}

export async function dataUrlToBase64(dataUrl: string): Promise<string> {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) throw new Error('Invalid image data: expected a base64 data URL.');
  return dataUrl.slice(commaIdx + 1);
}
