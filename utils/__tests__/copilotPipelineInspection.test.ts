import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { createDirectorMiddleware, __resetGatewayMemory } from '../../server/directorMiddleware';
import * as githubUtils from '../../utils/github';

vi.mock('../../utils/github', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    getWorkflowRuns: vi.fn(),
    inspectRunFailure: vi.fn(),
  };
});

function mkReq(o: { method?: string; url?: string; headers?: Record<string, string>; body?: unknown } = {}) {
  const text = o.body === undefined ? '' : typeof o.body === 'string' ? o.body : JSON.stringify(o.body);
  const r: any = Readable.from(text ? [Buffer.from(text)] : []);
  r.method = o.method || 'POST';
  r.url = o.url || '/copilot';
  r.headers = Object.fromEntries(Object.entries(o.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  r.socket = { remoteAddress: '127.0.0.1' };
  return r;
}

function mkRes() {
  const ee: any = new EventEmitter();
  ee.statusCode = 200;
  ee.headers = {};
  ee.writableEnded = false;
  ee.setHeader = (k: string, v: string) => (ee.headers[k.toLowerCase()] = v);
  ee.end = (b: string) => {
    ee.writableEnded = true;
    ee.body = b;
    ee.emit('finish');
  };
  return ee;
}

async function call(handler: any, o: Parameters<typeof mkReq>[0]) {
  const req = mkReq(o);
  const res = mkRes();
  const done = new Promise(r => res.on('finish', r));
  await handler(req, res);
  await done;
  return { status: res.statusCode as number, json: JSON.parse(res.body), raw: res.body as string };
}

type Resp = (url: string, init: any) => Response | Error | Promise<Response | Error>;
function mkFetch(queue: Resp[]) {
  const calls: Array<{ url: string; init: any; body: any }> = [];
  const fn: any = async (url: string, init: any) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : undefined });
    const next = queue.shift();
    if (!next) throw new Error('unexpected fetch call');
    const r = await next(url, init);
    if (r instanceof Error) throw r;
    return r;
  };
  fn.calls = calls;
  return fn as typeof fetch & { calls: typeof calls };
}

const chat = (content: unknown, usage = { prompt_tokens: 100, completion_tokens: 50 }) =>
  new Response(
    JSON.stringify({
      model: 'mercury-3',
      choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }],
      usage,
    }),
    { status: 200 }
  );

describe('Copilot Autonomous Multi-Hop Pipeline Investigation', () => {
  const mockRuns = [
    { id: 42426046804, name: 'Auto-Detect & Ingest Spaces', status: 'completed', conclusion: 'success', created_at: '2026-11-07T15:36:00Z', html_url: 'https://github.com/runs/42426046804' },
    { id: 42418412595, name: 'Ingest 1vylmgmJadRMzE', status: 'completed', conclusion: 'failure', created_at: '2026-11-07T13:59:00Z', html_url: 'https://github.com/runs/42418412595' },
    { id: 42418411900, name: 'Ingest 1rJqboeezyXgAQ', status: 'completed', conclusion: 'failure', created_at: '2026-11-07T13:59:00Z', html_url: 'https://github.com/runs/42418411900' },
    { id: 42418411122, name: 'Ingest 1vylmgmJadRMzE (Retry)', status: 'completed', conclusion: 'failure', created_at: '2026-11-07T13:58:00Z', html_url: 'https://github.com/runs/42418411122' },
    { id: 42418410500, name: 'Ingest 1rJqboeezyXgAQ (Retry)', status: 'completed', conclusion: 'failure', created_at: '2026-11-07T13:58:00Z', html_url: 'https://github.com/runs/42418410500' },
  ];

  beforeEach(() => {
    __resetGatewayMemory();
    vi.clearAllMocks();

    vi.mocked(githubUtils.getWorkflowRuns).mockResolvedValue(mockRuns as any);
    vi.mocked(githubUtils.inspectRunFailure).mockImplementation(async (_t, _o, _r, runId) => {
      return {
        failedJobName: 'Ingest Space Audio',
        failedStepName: 'Download Space M3U8 Stream',
        errorExcerpt: `[Run #${runId}] ERROR: Space audio stream expired or returned HTTP 403 Forbidden.`,
      };
    });
  });

  it('autonomously investigates all 4 failed runs in parallel across 2 tool rounds and synthesizes findings in a single interaction', async () => {
    // Model Call 1: Model requests workflow history filtered to failed runs
    const turn1ModelResp = chat(`Checking recent workflow failures...
\`\`\`action
{
  "action": "GET_RUN_HISTORY",
  "params": { "limit": 10, "status": "failed" },
  "explanation": "Fetching failed workflow run history"
}
\`\`\``);

    // Model Call 2: Model sees all 4 failed run IDs and requests parallel job inspection
    const turn2ModelResp = chat(`Inspecting failure logs for all four runs...
\`\`\`action
{
  "action": "GET_RUN_JOBS",
  "params": {
    "runIds": [42418412595, 42418411900, 42418411122, 42418410500]
  },
  "explanation": "Inspecting logs for all 4 failed runs"
}
\`\`\``);

    // Model Call 3: Final evidence-backed synthesis
    const turn3ModelResp = chat(`## Critical Failure Analysis: All 4 Failed Runs

All 4 failures occurred during Space ingest workflows:
1. **Run #42418412595 & #42418411122** (\`1vylmgmJadRMzE\`): Failed at step **Download Space M3U8 Stream** with HTTP 403 Forbidden.
2. **Run #42418411900 & #42418410500** (\`1rJqboeezyXgAQ\`): Failed at step **Download Space M3U8 Stream** with HTTP 403 Forbidden.

**Root Cause:** The target X Space audio streams expired or require authentication.`);

    const fetchMock = mkFetch([
      () => turn1ModelResp,
      () => turn2ModelResp,
      () => turn3ModelResp,
    ]);

    const handler = createDirectorMiddleware({
      getEnv: () => ({ DIRECTOR_API_KEY: 'test_director_key_12345678', GITHUB_TOKEN: 'gh_test_123' }),
      fetchImpl: fetchMock,
    });

    const res = await call(handler, {
      method: 'POST',
      url: '/copilot',
      headers: { 'x-github-token': 'gh_test_123' },
      body: {
        messages: [{ role: 'user', content: 'why are there four failed github runs?' }],
        context: { ownerName: 'aiandbotsgalore', repoName: 'copy-spaces-to-youtube-pipeline' },
      },
    });

    expect(res.status).toBe(200);
    expect(res.json.ok).toBe(true);

    // Verified: Exactly 3 gateway calls in a single HTTP interaction
    expect(fetchMock.calls).toHaveLength(3);

    // Verified: Both tools executed server-side
    const completedActionTypes = res.json.actions.map((a: any) => a.action);
    expect(completedActionTypes).toContain('GET_RUN_HISTORY');
    expect(completedActionTypes).toContain('GET_RUN_JOBS');

    // Verified: Parallel inspection called inspectRunFailure for all 4 runs
    expect(githubUtils.inspectRunFailure).toHaveBeenCalledTimes(4);
    expect(githubUtils.inspectRunFailure).toHaveBeenCalledWith(expect.any(String), 'aiandbotsgalore', 'copy-spaces-to-youtube-pipeline', 42418412595);
    expect(githubUtils.inspectRunFailure).toHaveBeenCalledWith(expect.any(String), 'aiandbotsgalore', 'copy-spaces-to-youtube-pipeline', 42418411900);
    expect(githubUtils.inspectRunFailure).toHaveBeenCalledWith(expect.any(String), 'aiandbotsgalore', 'copy-spaces-to-youtube-pipeline', 42418411122);
    expect(githubUtils.inspectRunFailure).toHaveBeenCalledWith(expect.any(String), 'aiandbotsgalore', 'copy-spaces-to-youtube-pipeline', 42418410500);

    // Verified: Inspected runs telemetry accumulated for all 4 runs
    expect(res.json.inspectedRuns).toBeDefined();
    expect(Object.keys(res.json.inspectedRuns)).toHaveLength(4);
    expect(res.json.inspectedRuns[42418412595].failedStep).toBe('Download Space M3U8 Stream');
    expect(res.json.inspectedRuns[42418412595].errorExcerpt).toContain('HTTP 403 Forbidden');

    // Verified: Final synthesized text delivered directly to user
    expect(res.json.text).toContain('Critical Failure Analysis: All 4 Failed Runs');
    expect(res.json.text).toContain('Download Space M3U8 Stream');
  });

  it('supports single-run GET_RUN_JOBS with runId for backwards compatibility', async () => {
    const turn1ModelResp = chat(`Checking single run...
\`\`\`action
{
  "action": "GET_RUN_JOBS",
  "params": { "runId": 42418412595 },
  "explanation": "Inspecting single run logs"
}
\`\`\``);

    const turn2ModelResp = chat('Run #42418412595 failed at Download Space M3U8 Stream.');

    const fetchMock = mkFetch([
      () => turn1ModelResp,
      () => turn2ModelResp,
    ]);

    const handler = createDirectorMiddleware({
      getEnv: () => ({ DIRECTOR_API_KEY: 'test_director_key_12345678', GITHUB_TOKEN: 'gh_test_123' }),
      fetchImpl: fetchMock,
    });

    const res = await call(handler, {
      method: 'POST',
      url: '/copilot',
      body: {
        messages: [{ role: 'user', content: 'check run 42418412595' }],
        context: { ownerName: 'aiandbotsgalore', repoName: 'copy-spaces-to-youtube-pipeline' },
      },
    });

    expect(res.status).toBe(200);
    expect(res.json.ok).toBe(true);
    expect(fetchMock.calls).toHaveLength(2);
    expect(githubUtils.inspectRunFailure).toHaveBeenCalledTimes(1);
    expect(githubUtils.inspectRunFailure).toHaveBeenCalledWith(expect.any(String), 'aiandbotsgalore', 'copy-spaces-to-youtube-pipeline', 42418412595);
    expect(res.json.inspectedRuns[42418412595]).toBeDefined();
  });

  it('auto-resolves GET_VOICE_PROFILES tool in Round 1 and delivers full voice registry in Round 2', async () => {
    // Model Call 1: Model requests voice profile registry
    const turn1ModelResp = chat(`Let me check the live voice profile registry.
\`\`\`action
{
  "action": "GET_VOICE_PROFILES",
  "params": {}
}
\`\`\``);

    // Model Call 2: Final synthesis
    const turn2ModelResp = chat(`You have 15 enrolled voice profiles in the catalog, including Logan, Angela, and Eric Hecker.`);

    const fetchMock = mkFetch([
      () => turn1ModelResp,
      () => turn2ModelResp,
    ]);

    const handler = createDirectorMiddleware({
      getEnv: () => ({ DIRECTOR_API_KEY: 'test_director_key_12345678' }),
      fetchImpl: fetchMock,
    });

    const res = await call(handler, {
      method: 'POST',
      url: '/copilot',
      body: {
        messages: [{ role: 'user', content: 'why do you say there are no voice profiles?' }],
        context: {},
      },
    });

    expect(res.status).toBe(200);
    expect(res.json.ok).toBe(true);
    expect(fetchMock.calls).toHaveLength(2);
    expect(res.json.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'GET_VOICE_PROFILES',
          status: 'completed',
          resultData: expect.objectContaining({
            voiceProfilesCatalog: expect.objectContaining({
              total: 15,
              enrolled: 15,
            }),
          }),
        }),
      ])
    );
    expect(res.json.text).toContain('15 enrolled voice profiles');
  });
});
