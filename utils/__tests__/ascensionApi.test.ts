import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';
import {
  createAscensionApiMiddleware,
  createGeneratedMediaMiddleware,
  sanitizePath,
  checkSecretLeak,
  setKillSwitchState,
  getKillSwitchState,
} from '../../server/ascensionApi';
import { validateActionParams, resolveActionTier } from '../contracts/copilotActions';

class MockRequest extends EventEmitter {
  method: string;
  url: string;
  headers: Record<string, string>;
  socket: { remoteAddress: string };

  constructor(method: string, url: string, headers: Record<string, string> = {}) {
    super();
    this.method = method;
    this.url = url;
    this.headers = headers;
    this.socket = { remoteAddress: '127.0.0.1' };
  }

  sendBody(data: unknown) {
    const raw = typeof data === 'string' ? data : JSON.stringify(data);
    this.emit('data', Buffer.from(raw));
    this.emit('end');
  }
}

class MockResponse extends EventEmitter {
  statusCode: number = 200;
  headers: Record<string, string> = {};
  body: string = '';
  writableEnded: boolean = false;

  setHeader(name: string, value: string) {
    this.headers[name.toLowerCase()] = value;
  }

  writeHead(status: number, headers: Record<string, string> = {}) {
    this.statusCode = status;
    for (const [k, v] of Object.entries(headers)) {
      this.setHeader(k, v);
    }
  }

  write(chunk: any) {
    this.body += chunk.toString();
    return true;
  }

  end(chunk?: any) {
    if (chunk) this.body += chunk.toString();
    this.writableEnded = true;
    this.emit('finish');
  }

  json(): any {
    try {
      return JSON.parse(this.body);
    } catch {
      return null;
    }
  }
}

const testRoot = path.resolve(__dirname, '..', '..');

describe('Ascension API Backend & Security Guardrails', () => {
  let middleware: ReturnType<typeof createAscensionApiMiddleware>;

  beforeEach(() => {
    setKillSwitchState('resume');
    middleware = createAscensionApiMiddleware({
      rootDir: testRoot,
      getEnv: () => ({}),
      now: () => 1763870000000,
    });
  });

  afterEach(() => {
    setKillSwitchState('resume');
  });

  it('Path Traversal Defense: rejects ../ traversal and unauthorized directories', () => {
    const allowed = sanitizePath(testRoot, 'data/valid.txt', ['data']);
    expect(allowed.ok).toBe(true);

    const traversal = sanitizePath(testRoot, '../../etc/passwd', ['data']);
    expect(traversal.ok).toBe(false);
    if (!traversal.ok) {
      expect(traversal.error).toMatch(/Path traversal/);
    }

    const outsideRoot = sanitizePath(testRoot, 'C:/Windows/System32/cmd.exe', ['data']);
    expect(outsideRoot.ok).toBe(false);
  });

  it('Secret Leak Prevention: scans and flags sensitive credential patterns', () => {
    expect(checkSecretLeak('Normal research timeline notes')).toBeNull();
    expect(checkSecretLeak('github_token = "ghp_1234567890abcdef1234"')).not.toBeNull();
    expect(checkSecretLeak('API_KEY = "sk-live-1234567890abcdef"')).not.toBeNull();
    expect(checkSecretLeak('Authorization: Bearer my_secret_token_1234567890')).not.toBeNull();
    // Allows GitHub Actions ${{ secrets.GITHUB_TOKEN }} expressions
    expect(checkSecretLeak('env:\n  TOKEN: ${{ secrets.GITHUB_TOKEN }}')).toBeNull();
  });

  it('POST /api/ascension/graph/introspect returns graph topology', async () => {
    const req = new MockRequest('POST', '/api/ascension/graph/introspect');
    const res = new MockResponse();
    const done = new Promise((resolve) => res.on('finish', resolve));

    middleware(req as any, res as any);
    req.sendBody({ query: 'Angela' });
    await done;

    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data.ok).toBe(true);
    expect(data.stats).toBeDefined();
    expect(Array.isArray(data.nodes)).toBe(true);
  });

  it('POST /api/ascension/graph/mutate executes and records graph mutation', async () => {
    const req = new MockRequest('POST', '/api/ascension/graph/mutate');
    const res = new MockResponse();
    const done = new Promise((resolve) => res.on('finish', resolve));

    middleware(req as any, res as any);
    req.sendBody({
      type: 'add_node',
      episodeTag: 'AQ-0118',
      nodeData: { id: 'test_node_ascension', label: 'Test Ascension Node' },
    });
    await done;

    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data.ok).toBe(true);
    expect(data.type).toBe('add_node');
    expect(data.summary).toMatch(/Added node "test_node_ascension"/);
  });

  it('POST /api/ascension/fs/write blocks secret leakage and path traversal', async () => {
    // 1. Path traversal rejected
    const req1 = new MockRequest('POST', '/api/ascension/fs/write');
    const res1 = new MockResponse();
    const done1 = new Promise((resolve) => res1.on('finish', resolve));

    middleware(req1 as any, res1 as any);
    req1.sendBody({
      path: '../../escape.txt',
      content: 'hello',
    });
    await done1;
    expect(res1.statusCode).toBe(403);

    // 2. Secret leak rejected
    const req2 = new MockRequest('POST', '/api/ascension/fs/write');
    const res2 = new MockResponse();
    const done2 = new Promise((resolve) => res2.on('finish', resolve));

    middleware(req2 as any, res2 as any);
    req2.sendBody({
      path: 'data/secret_test.txt',
      content: 'API_KEY = "sk-live-1234567890abcdef"',
    });
    await done2;
    expect(res2.statusCode).toBe(400);
    expect(res2.json().error).toMatch(/Secret Leak Prevention/);
  });

  it('POST /api/ascension/fs/exec enforces command allowlist and rejects metacharacters', async () => {
    // Forbidden command
    const req1 = new MockRequest('POST', '/api/ascension/fs/exec');
    const res1 = new MockResponse();
    const done1 = new Promise((resolve) => res1.on('finish', resolve));

    middleware(req1 as any, res1 as any);
    req1.sendBody({ command: 'curl', args: ['https://evil.com'] });
    await done1;
    expect(res1.statusCode).toBe(403);
    expect(res1.json().error).toMatch(/not in the allowlist/);

    // Shell metacharacters rejected
    const req2 = new MockRequest('POST', '/api/ascension/fs/exec');
    const res2 = new MockResponse();
    const done2 = new Promise((resolve) => res2.on('finish', resolve));

    middleware(req2 as any, res2 as any);
    req2.sendBody({ command: 'ls; rm -rf /' });
    await done2;
    expect(res2.statusCode).toBe(400);
    expect(res2.json().error).toMatch(/forbidden shell metacharacters/);

    // Allowlisted command succeeds
    const req3 = new MockRequest('POST', '/api/ascension/fs/exec');
    const res3 = new MockResponse();
    const done3 = new Promise((resolve) => res3.on('finish', resolve));

    middleware(req3 as any, res3 as any);
    req3.sendBody({ command: 'ls', args: [] });
    await done3;
    expect(res3.statusCode).toBe(200);
    expect(res3.json().ok).toBe(true);
  });

  it('POST /api/ascension/workflow/write writes validated workflow file', async () => {
    const req = new MockRequest('POST', '/api/ascension/workflow/write');
    const res = new MockResponse();
    const done = new Promise((resolve) => res.on('finish', resolve));

    middleware(req as any, res as any);
    req.sendBody({
      filename: 'ascension_test.yml',
      content: 'name: Ascension Test\non:\n  workflow_dispatch:\njobs:\n  run:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo OK\n',
      commitMessage: 'ci(workflow): test workflow write',
    });
    await done;

    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data.ok).toBe(true);
    expect(data.filePath).toBe('.github/workflows/ascension_test.yml');

    // Clean up test file
    const createdPath = path.resolve(testRoot, '.github', 'workflows', 'ascension_test.yml');
    if (fs.existsSync(createdPath)) {
      fs.unlinkSync(createdPath);
    }
  });

  it('Kill Switch Enforcement: pause blocks Tier 1/2 but permits Tier 0', async () => {
    // 1. Engage pause
    setKillSwitchState('pause');
    expect(getKillSwitchState()).toBe('pause');

    // 2. Tier 0 read is permitted
    const req0 = new MockRequest('POST', '/api/ascension/graph/introspect');
    const res0 = new MockResponse();
    const done0 = new Promise((resolve) => res0.on('finish', resolve));
    middleware(req0 as any, res0 as any);
    req0.sendBody({ query: 'test' });
    await done0;
    expect(res0.statusCode).toBe(200);

    // 3. Tier 1 mutation is forbidden with 403
    const req1 = new MockRequest('POST', '/api/ascension/graph/mutate');
    const res1 = new MockResponse();
    const done1 = new Promise((resolve) => res1.on('finish', resolve));
    middleware(req1 as any, res1 as any);
    req1.sendBody({ type: 'reload_episode', episodeTag: 'AQ-0118' });
    await done1;
    expect(res1.statusCode).toBe(403);
    expect(res1.json().error).toMatch(/Kill switch is paused/);

    // 4. Tier 2 exec is forbidden with 403
    const req2 = new MockRequest('POST', '/api/ascension/fs/exec');
    const res2 = new MockResponse();
    const done2 = new Promise((resolve) => res2.on('finish', resolve));
    middleware(req2 as any, res2 as any);
    req2.sendBody({ command: 'ls' });
    await done2;
    expect(res2.statusCode).toBe(403);

    // 5. Resume restores full access
    setKillSwitchState('resume');
    const req3 = new MockRequest('POST', '/api/ascension/graph/mutate');
    const res3 = new MockResponse();
    const done3 = new Promise((resolve) => res3.on('finish', resolve));
    middleware(req3 as any, res3 as any);
    req3.sendBody({ type: 'reload_episode', episodeTag: 'AQ-0118' });
    await done3;
    expect(res3.statusCode).toBe(200);
  });
});

describe('Ascension Copilot Action Contracts & Tiers', () => {
  it('assigns correct authorization tiers to all thirteen Ascension actions', () => {
    // Tier 0
    expect(resolveActionTier('STREAM_LIVE_LOGS', {})).toBe(0);
    expect(resolveActionTier('READ_FILE', {})).toBe(0);
    expect(resolveActionTier('INTROSPECT_NODE_LINKAGE', {})).toBe(0);
    expect(resolveActionTier('REVEAL_VECTOR_EMBEDDINGS', {})).toBe(0);

    // Tier 1
    expect(resolveActionTier('MUTATE_KNOWLEDGE_GRAPH', {})).toBe(1);
    expect(resolveActionTier('WRITE_FILE', {})).toBe(1);
    expect(resolveActionTier('SYNTHESIZE_VOX', {})).toBe(2); // Tier 2 unless AUTO_EXECUTE_VOX
    expect(resolveActionTier('RENDER_AVATAR_DIRECT', {})).toBe(2);
    expect(resolveActionTier('CLONE_VOICE_PROFILE', {})).toBe(1);
    expect(resolveActionTier('SYNC_CRON', {})).toBe(1);
    expect(resolveActionTier('SEND_DISCORD_MESSAGE', {})).toBe(1);
    expect(resolveActionTier('SEND_SLACK_MESSAGE', {})).toBe(1);

    // Tier 2
    expect(resolveActionTier('EXECUTE_BASH_COMMAND', {})).toBe(2);
    expect(resolveActionTier('WRITE_WORKFLOW_FILE', {})).toBe(2);
    expect(resolveActionTier('TOGGLE_KILL_SWITCH', {})).toBe(2);
  });

  it('validates action schemas for INTROSPECT, EXECUTE, and CLONE_VOICE', () => {
    const introspect = validateActionParams('INTROSPECT_NODE_LINKAGE', {
      query: 'contradiction',
      episodeTag: 'AQ-0118',
    });
    expect(introspect.ok).toBe(true);

    const execValid = validateActionParams('EXECUTE_BASH_COMMAND', {
      command: 'ffprobe',
      args: ['-version'],
      reason: 'Probing acoustic engine version',
    });
    expect(execValid.ok).toBe(true);

    const execInvalid = validateActionParams('EXECUTE_BASH_COMMAND', {
      command: 'curl',
      reason: 'Should be rejected',
    });
    expect(execInvalid.ok).toBe(false);

    const cloneVoice = validateActionParams('CLONE_VOICE_PROFILE', {
      sourceProfileId: 'Logan',
      name: 'Logan_Clone_01',
    });
    expect(cloneVoice.ok).toBe(true);
  });

  it('Static Media Route (GET /api/media/generated/:filename) strictly validates filenames and serves images', async () => {
    const mediaMiddleware = createGeneratedMediaMiddleware({ rootDir: testRoot });
    const genDir = path.resolve(testRoot, 'data', 'generated_images');
    if (!fs.existsSync(genDir)) fs.mkdirSync(genDir, { recursive: true });

    const sampleFile = path.resolve(genDir, 'test_sample.png');
    fs.writeFileSync(sampleFile, Buffer.from('fake_png_data'));

    try {
      // 1. Valid file served
      const req1 = new MockRequest('GET', '/api/media/generated/test_sample.png');
      const res1 = new MockResponse();
      mediaMiddleware(req1 as any, res1 as any);
      expect(res1.statusCode).toBe(200);
      expect(res1.headers['content-type']).toBe('image/png');
      expect(res1.headers['x-content-type-options']).toBe('nosniff');

      // 2. Reject SVG (XSS prevention)
      const req2 = new MockRequest('GET', '/api/media/generated/vector.svg');
      const res2 = new MockResponse();
      mediaMiddleware(req2 as any, res2 as any);
      expect(res2.statusCode).toBe(400);

      // 3. Reject path traversal
      const req3 = new MockRequest('GET', '/api/media/generated/../../secret.png');
      const res3 = new MockResponse();
      mediaMiddleware(req3 as any, res3 as any);
      // Path traversal or invalid format rejected
      expect(res3.statusCode).toBeGreaterThanOrEqual(400);
    } finally {
      if (fs.existsSync(sampleFile)) fs.unlinkSync(sampleFile);
    }
  });

  it('POST /api/ascension/generate-image invokes OpenRouter image API with Recraft payload, validates media and records audit log', async () => {
    const mockImageB64 = Buffer.from('mock_recraft_png_image_data').toString('base64');
    let capturedBody: any = null;
    const mockFetch = async (url: string, opts: any) => {
      if (url.includes('openrouter.ai/api/v1/images')) {
        capturedBody = JSON.parse(opts.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ b64_json: mockImageB64, media_type: 'image/png' }],
            usage: { cost: 0.0 },
          }),
        } as any;
      }
      return { ok: false, status: 404 } as any;
    };

    const imageMiddleware = createAscensionApiMiddleware({
      rootDir: testRoot,
      getEnv: () => ({ OPENROUTER_API_KEY: 'sk-or-test-mock-key' }),
      fetchImpl: mockFetch as any,
      now: () => 1763870000000,
    });

    const req = new MockRequest('POST', '/api/ascension/generate-image');
    const res = new MockResponse();
    const done = new Promise((resolve) => res.on('finish', resolve));

    imageMiddleware(req as any, res as any);
    req.sendBody({
      prompt: 'A cinematic wide angle shot of a recording studio with retro neon lighting',
      aspect_ratio: '16:9',
    });
    await done;

    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data.status).toBe('success');
    expect(data.image_url).toBe('/api/media/generated/gen_1763870000000.png');
    expect(data.filename).toBe('gen_1763870000000.png');
    expect(data.model_used).toBe('recraft/recraft-v4.1-flash-v2:free');
    expect(data.cost).toBe(0.0);

    // Verify Recraft payload has ONLY model, prompt, aspect_ratio, n: 1
    expect(capturedBody).toEqual({
      model: 'recraft/recraft-v4.1-flash-v2:free',
      prompt: 'A cinematic wide angle shot of a recording studio with retro neon lighting',
      aspect_ratio: '16:9',
      n: 1,
    });
    expect(capturedBody.output_format).toBeUndefined();
    expect(capturedBody.input_references).toBeUndefined();

    // Verify generated file exists and clean it up
    const savedPath = path.resolve(testRoot, 'data', 'generated_images', data.filename);
    expect(fs.existsSync(savedPath)).toBe(true);
    fs.unlinkSync(savedPath);

    // Verify audit log has no base64
    const auditFile = path.resolve(testRoot, 'data', 'audit', 'wizard_audit.jsonl');
    if (fs.existsSync(auditFile)) {
      const logs = fs.readFileSync(auditFile, 'utf8');
      expect(logs).not.toContain(mockImageB64);
    }
  });

  it('POST /api/ascension/generate-image handles 401, 402, 404, and 429 status codes with clear error messages', async () => {
    let mockStatus = 401;
    let mockStatusText = 'Unauthorized';
    const mockFetch = async () => ({
      ok: false,
      status: mockStatus,
      statusText: mockStatusText,
      text: async () => 'Error details from OpenRouter',
    });

    const mw = createAscensionApiMiddleware({
      rootDir: testRoot,
      getEnv: () => ({ OPENROUTER_API_KEY: 'sk-or-test-mock-key' }),
      fetchImpl: mockFetch as any,
    });

    // 401
    mockStatus = 401;
    let req = new MockRequest('POST', '/api/ascension/generate-image');
    let res = new MockResponse();
    let done = new Promise((resolve) => res.on('finish', resolve));
    mw(req as any, res as any);
    req.sendBody({ prompt: 'Test 401' });
    await done;
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain('401 Unauthorized');

    // 402
    mockStatus = 402;
    req = new MockRequest('POST', '/api/ascension/generate-image');
    res = new MockResponse();
    done = new Promise((resolve) => res.on('finish', resolve));
    mw(req as any, res as any);
    req.sendBody({ prompt: 'Test 402' });
    await done;
    expect(res.statusCode).toBe(402);
    expect(res.json().error).toContain('402 Payment Required');

    // 404
    mockStatus = 404;
    req = new MockRequest('POST', '/api/ascension/generate-image');
    res = new MockResponse();
    done = new Promise((resolve) => res.on('finish', resolve));
    mw(req as any, res as any);
    req.sendBody({ prompt: 'Test 404' });
    await done;
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain('404 Not Found');

    // 429
    mockStatus = 429;
    req = new MockRequest('POST', '/api/ascension/generate-image');
    res = new MockResponse();
    done = new Promise((resolve) => res.on('finish', resolve));
    mw(req as any, res as any);
    req.sendBody({ prompt: 'Test 429' });
    await done;
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toContain('429 Too Many Requests');
  });

  it('POST /api/ascension/generate-image respects Kill Switch (pause and permanent)', async () => {
    setKillSwitchState('pause');
    const pausedMiddleware = createAscensionApiMiddleware({
      rootDir: testRoot,
      getEnv: () => ({ OPENROUTER_API_KEY: 'sk-or-test-mock-key' }),
    });

    const req = new MockRequest('POST', '/api/ascension/generate-image');
    const res = new MockResponse();
    const done = new Promise((resolve) => res.on('finish', resolve));

    pausedMiddleware(req as any, res as any);
    req.sendBody({ prompt: 'A cool visual' });
    await done;

    expect(res.statusCode).toBe(403);
    setKillSwitchState('resume');
  });
});
