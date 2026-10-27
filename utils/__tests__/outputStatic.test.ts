import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createOutputStatic } from '../../server/serveFile';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-out-'));
fs.mkdirSync(path.join(root, 'public', 'output', 'vox'), { recursive: true });
fs.writeFileSync(path.join(root, 'public', 'secret.txt'), 'outside output');
const mw = createOutputStatic(root);
const server = http.createServer((req, res) => {
  if (!req.url!.startsWith('/output')) { res.statusCode = 418; return res.end('fallthrough'); }
  req.url = req.url!.slice('/output'.length) || '/';
  mw(req, res, () => { res.statusCode = 404; res.end('next'); });
});
afterAll(() => server.close());

describe('createOutputStatic', () => {
  it('serves files written after start, with ranges, and nothing outside public/output', async () => {
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    fs.writeFileSync(path.join(root, 'public', 'output', 'vox', 'take_new.mp3'), Buffer.from('0123456789'));
    const full = await fetch(`${base}/output/vox/take_new.mp3`);
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toBe('audio/mpeg');
    expect(await full.text()).toBe('0123456789');
    const part = await fetch(`${base}/output/vox/take_new.mp3`, { headers: { Range: 'bytes=2-4' } });
    expect(part.status).toBe(206);
    expect(await part.text()).toBe('234');
    expect((await fetch(`${base}/output/vox/missing.mp3`)).status).toBe(404);
    expect((await fetch(`${base}/output/..%2Fsecret.txt`)).status).toBe(404);
    expect((await fetch(`${base}/output/vox/take_new.mp3`, { method: 'POST' })).status).toBe(404);
  });
});
