import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createVoiceProfileAutoEnrollHandler } from '../../server/voiceProfileAutoEnroll';

let server: http.Server | null = null;
let root = '';

afterEach(async () => {
  if (server) await new Promise<void>(r => server!.close(() => r()));
  server = null;
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

async function serve() {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-enroll-test-'));
  const h = createVoiceProfileAutoEnrollHandler({ rootDir: root, getEnv: () => ({}) });
  server = http.createServer((req, res) => h(req, res));
  await new Promise<void>(r => server!.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return `http://127.0.0.1:${port}`;
}

describe('/api/voice-profiles/auto-enroll handler', () => {
  it('rejects GET requests with 405 Method Not Allowed', async () => {
    const base = await serve();
    const res = await fetch(base, { method: 'GET' });
    expect(res.status).toBe(405);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('Method Not Allowed');
  });

  it('rejects POST requests without speaker with 400 Bad Request', async () => {
    const base = await serve();
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: 'some/audio.mp3' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('speaker');
  });

  it('rejects POST requests without audio file or body with 400 Bad Request', async () => {
    const base = await serve();
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speaker: 'Mary' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('No audio file or URL provided');
  });
});
