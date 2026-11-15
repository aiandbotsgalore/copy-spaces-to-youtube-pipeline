import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';
import { createScriptStudioMiddleware } from '../../server/scriptStudioMiddleware';
import { createScriptStore } from '../../server/scriptStore';

describe('Script Studio Project Deletion and Reset API', () => {
  let tmpRoot: string;
  let mw: ReturnType<typeof createScriptStudioMiddleware>;
  let store: ReturnType<typeof createScriptStore>;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'script-actions-test-'));
    fs.mkdirSync(path.join(tmpRoot, 'public', 'transcripts', 'episodes'), { recursive: true });

    // Seed dummy episode transcript
    const epData = {
      release_tag: '20240915_test_ep',
      title: 'Investigation Ep 1',
      date: '2024-09-15',
      duration: 3600,
      segments: [
        { start: 0, end: 10, speaker: 'Logan', text: 'Logan opening statement.' },
        { start: 10, end: 20, speaker: 'Guest', text: 'Guest response.' },
      ],
    };
    fs.writeFileSync(
      path.join(tmpRoot, 'public', 'transcripts', 'episodes', '20240915_test_ep.json'),
      JSON.stringify(epData)
    );

    store = createScriptStore(tmpRoot);
    mw = createScriptStudioMiddleware({
      root: tmpRoot,
      getEnv: () => ({}),
      now: () => 1700000000000,
    });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  const callApi = async (method: string, url: string, body?: any) => {
    let statusCode = 200;
    let headers: Record<string, string> = {};
    let responseBody = '';

    const req: any = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
    Object.assign(req, {
      method,
      url,
      socket: { remoteAddress: '127.0.0.1' },
      headers: { host: 'localhost', 'content-type': 'application/json' },
    });

    const res: any = {
      setHeader: (k: string, v: string) => { headers[k] = v; },
      end: (data?: any) => {
        if (data) responseBody += data.toString();
      },
      write: (data?: any) => {
        if (data) responseBody += data.toString();
      },
      get statusCode() { return statusCode; },
      set statusCode(v: number) { statusCode = v; },
    };

    await mw(req, res);
    const parsed = responseBody ? JSON.parse(responseBody) : null;
    return {
      status: statusCode,
      body: parsed,
    };
  };

  it('deletes a project via POST /project/delete and removes its directory and runs', async () => {
    // 1. Create a project
    const createRes = await callApi('POST', '/project', {
      releaseTags: ['20240915_test_ep'],
      title: 'ZZ AUDIT TEST (to be deleted)',
    });
    expect(createRes.status).toBe(201);
    const projectId = createRes.body.project.id;
    expect(projectId).toBeDefined();

    // Verify project exists in list
    const listBefore = await callApi('GET', '/projects');
    expect(listBefore.body.projects.some((p: any) => p.id === projectId)).toBe(true);
    expect(fs.existsSync(path.join(tmpRoot, '.spacepipe-studio', 'projects', projectId))).toBe(true);

    // 2. Call delete endpoint
    const deleteRes = await callApi('POST', '/project/delete', { id: projectId });
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.ok).toBe(true);
    expect(deleteRes.body.deleted).toBe(true);

    // 3. Verify directory is gone from storage
    expect(fs.existsSync(path.join(tmpRoot, '.spacepipe-studio', 'projects', projectId))).toBe(false);

    // 4. Verify projects list immediately decrements
    const listAfter = await callApi('GET', '/projects');
    expect(listAfter.body.projects.some((p: any) => p.id === projectId)).toBe(false);
    expect(listAfter.body.projects.length).toBe(listBefore.body.projects.length - 1);
  });

  it('deletes a project via DELETE /project?id=...', async () => {
    const createRes = await callApi('POST', '/project', {
      releaseTags: ['20240915_test_ep'],
      title: 'Project To Delete Via DELETE method',
    });
    const projectId = createRes.body.project.id;

    const deleteRes = await callApi('DELETE', `/project?id=${projectId}`);
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.ok).toBe(true);
    expect(deleteRes.body.deleted).toBe(true);

    expect(fs.existsSync(path.join(tmpRoot, '.spacepipe-studio', 'projects', projectId))).toBe(false);
  });

  it('resets a script via POST /project/reset-script, clearing scenes and blocks', async () => {
    // 1. Create project with uploaded script
    const scriptMarkdown = `# Act 1: Intro
## Scene 1: Opening
Logan: Here is the opening narration for the investigation.`;

    const uploadRes = await callApi('POST', '/project/upload-script', {
      title: 'Manuscript Project',
      releaseTags: ['20240915_test_ep'],
      scriptText: scriptMarkdown,
    });
    expect(uploadRes.status).toBe(201);
    const projectId = uploadRes.body.project.id;
    expect(uploadRes.body.project.headVersionId).toBeTruthy();

    // Verify script loads with head version and scenes
    const getBefore = await callApi('GET', `/project?id=${projectId}`);
    expect(getBefore.body.head).toBeTruthy();
    expect(getBefore.body.head.segments.length).toBeGreaterThan(0);
    expect(getBefore.body.head.segments[0].scenes.length).toBeGreaterThan(0);

    // 2. Reset script
    const resetRes = await callApi('POST', '/project/reset-script', { id: projectId });
    expect(resetRes.status).toBe(200);
    expect(resetRes.body.ok).toBe(true);
    expect(resetRes.body.project.headVersionId).toBeNull();

    // 3. Verify GET /project now returns null head and no active script
    const getAfter = await callApi('GET', `/project?id=${projectId}`);
    expect(getAfter.body.head).toBeNull();
    expect(getAfter.body.project.headVersionId).toBeNull();
  });
});
