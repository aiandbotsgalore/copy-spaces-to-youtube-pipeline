import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';
import { createScriptStudioMiddleware } from '../../server/scriptStudioMiddleware';

describe('Script and Evidence Upload API', () => {
  let tmpRoot: string;
  let mw: ReturnType<typeof createScriptStudioMiddleware>;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'script-upload-test-'));
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

  it('uploads a manual script and creates a new project with parsed scenes', async () => {
    const scriptMarkdown = `# Act 1: The Investigation
## Scene 1: The Beginning
Logan: We uncovered the files late on a Friday night.
[Pause: 2s]
[Music: sting - dramatic tension]

## Scene 2: The Fallout
The reaction was immediate and loud.`;

    const res = await callApi('POST', '/project/upload-script', {
      title: 'Watergate 2.0',
      format: 'investigative',
      releaseTags: ['20240915_test_ep'],
      scriptText: scriptMarkdown,
      filename: 'script.md',
      evidenceDocs: [
        {
          name: 'Leaked_Memos.txt',
          content: 'Here is the confidential memo detailing the transactions.',
          type: 'text',
        },
      ],
    });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.project.title).toBe('Watergate 2.0');
    expect(res.body.project.format).toBe('investigative');
    expect(res.body.project.evidenceDocs).toHaveLength(1);
    expect(res.body.project.evidenceDocs[0].name).toBe('Leaked_Memos.txt');

    expect(res.body.version.segments).toHaveLength(1);
    expect(res.body.version.segments[0].title).toBe('Act 1: The Investigation');
    expect(res.body.version.segments[0].scenes).toHaveLength(2);

    const sc1 = res.body.version.segments[0].scenes[0];
    expect(sc1.title).toBe('Scene 1: The Beginning');
    expect(sc1.blocks).toHaveLength(3);
    expect(sc1.blocks[0].kind).toBe('narration');
    expect(sc1.blocks[1].kind).toBe('pause');
    expect(sc1.blocks[2].kind).toBe('music');
  });

  it('attaches and removes evidence documents from a project', async () => {
    // 1. Create standard project
    const createRes = await callApi('POST', '/project', {
      releaseTags: ['20240915_test_ep'],
      title: 'Evidence Test Project',
    });
    const projectId = createRes.body.project.id;

    // 2. Add evidence document
    const addRes = await callApi('POST', '/project/evidence', {
      projectId,
      documents: [
        {
          name: 'Court_Filing_Exhibit_A.md',
          content: '# Exhibit A\nSworn affidavit from primary witness.',
          type: 'markdown',
        },
      ],
    });

    expect(addRes.status).toBe(200);
    expect(addRes.body.project.evidenceDocs).toHaveLength(1);
    const docId = addRes.body.project.evidenceDocs[0].id;
    expect(addRes.body.project.evidenceDocs[0].name).toBe('Court_Filing_Exhibit_A.md');

    // 3. Remove evidence document
    const rmRes = await callApi('POST', '/project/evidence/remove', {
      projectId,
      documentId: docId,
    });
    expect(rmRes.status).toBe(200);
    expect(rmRes.body.project.evidenceDocs).toHaveLength(0);
  });

  it('creates project with googleDriveFolderUrl and supports /google-drive/fetch route', async () => {
    // 1. Upload script with googleDriveFolderUrl
    const res = await callApi('POST', '/project/upload-script', {
      title: 'Drive Evidence Project',
      releaseTags: ['20240915_test_ep'],
      scriptText: 'Logan: Testing Google Drive integration.',
      googleDriveFolderUrl: 'https://drive.google.com/drive/folders/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs',
      evidenceDocs: [
        {
          name: 'FBI_Report.pdf.txt',
          content: 'Classified report contents from Google Drive folder.',
          type: 'text',
          sourceUrl: 'https://drive.google.com/file/d/f1/view',
          source: 'google_drive',
        },
      ],
    });

    expect(res.status).toBe(201);
    expect(res.body.project.googleDriveFolderUrl).toBe('https://drive.google.com/drive/folders/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs');
    expect(res.body.project.evidenceDocs).toHaveLength(1);
    expect(res.body.project.evidenceDocs[0].source).toBe('google_drive');
    expect(res.body.project.evidenceDocs[0].sourceUrl).toBe('https://drive.google.com/file/d/f1/view');

    // 2. Call /google-drive/fetch route with folder without key
    const fetchRes = await callApi('POST', '/google-drive/fetch', {
      url: 'https://drive.google.com/drive/folders/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs',
    });
    expect(fetchRes.status).toBe(200);
    expect(fetchRes.body.ok).toBe(false);
    expect(fetchRes.body.code).toBe('AUTH_REQUIRED');

    // 3. Update googleDriveFolderUrl on project
    const updateRes = await callApi('POST', '/project/update', {
      id: res.body.project.id,
      googleDriveFolderUrl: 'https://drive.google.com/drive/folders/new_folder_id',
    });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.project.googleDriveFolderUrl).toBe('https://drive.google.com/drive/folders/new_folder_id');
  });

  it('persists clips into project through /project/update and retrieves them on /project', async () => {
    // 1. Create a project
    const uploadRes = await callApi('POST', '/project/upload-script', {
      title: 'Clip Persistence Test Project',
      releaseTags: ['20240915_test_ep'],
      scriptText: 'Logan: Testing clip persistence.',
    });
    expect(uploadRes.status).toBe(201);
    const projectId = uploadRes.body.project.id;
    expect(uploadRes.body.project.clips).toHaveLength(0);

    // 2. Call /project/update with synced clips
    const newClips = [
      {
        id: 'clip_1700000000000_0',
        clipId: 'clip_1700000000000_0',
        speaker: 'Angela',
        timestamp: '12:34',
        time: '12:34',
        quote: 'Nobody will ever trace this back to us.',
        text: 'Nobody will ever trace this back to us.',
        label: 'Angela (12:34)',
        source: 'manuscript_extracted',
        title: 'Angela (12:34)',
        releaseTag: '20240915_test_ep',
        audioUrl: '',
        durationSec: 5.2,
        episodeStartSec: 754,
        fn: 'evidence',
      },
      {
        id: 'clip_1700000000000_1',
        clipId: 'clip_1700000000000_1',
        speaker: 'Logan',
        timestamp: '05:20',
        time: '05:20',
        quote: 'We need to verify this right now.',
        text: 'We need to verify this right now.',
        label: 'Logan (05:20)',
        source: 'manuscript_extracted',
        title: 'Logan (05:20)',
        releaseTag: '20240915_test_ep',
        audioUrl: '',
        durationSec: 3.5,
        episodeStartSec: 320,
        fn: 'evidence',
      },
    ];

    const updateRes = await callApi('POST', '/project/update', {
      id: projectId,
      clips: newClips,
    });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.project.clips).toHaveLength(2);
    expect(updateRes.body.project.clips[0].speaker).toBe('Angela');
    expect(updateRes.body.project.clips[0].source).toBe('manuscript_extracted');
    expect(updateRes.body.project.clips[1].speaker).toBe('Logan');

    // 3. Fetch project and verify persistence from disk
    const getRes = await callApi('GET', `/project?id=${encodeURIComponent(projectId)}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.project.clips).toHaveLength(2);
    expect(getRes.body.project.clips[0].clipId).toBe('clip_1700000000000_0');
    expect(getRes.body.project.clips[0].label).toBe('Angela (12:34)');
    expect(getRes.body.project.clips[1].clipId).toBe('clip_1700000000000_1');
  });
});
