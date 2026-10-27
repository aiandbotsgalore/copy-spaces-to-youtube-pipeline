import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createVoxSynthesizeHandler, type VoxDeps } from '../../server/voxSynthesize';

let server: http.Server | null = null;
let root = '';
afterEach(async () => {
  if (server) await new Promise<void>(r => server!.close(() => r()));
  server = null;
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

async function serve(deps: Partial<VoxDeps>) {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vox-test-'));
  const h = createVoxSynthesizeHandler({ rootDir: root, getEnv: () => ({}), now: () => 1000, ...deps });
  server = http.createServer((req, res) => h(req, res));
  await new Promise<void>(r => server!.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return (body: unknown) => fetch(base, { method: 'POST', body: JSON.stringify(body) });
}

describe('/api/vox/synthesize', () => {
  it('returns the newly written take with its probed duration', async () => {
    const post = await serve({
      runHfSynth: ({ outFullPath }) => fs.writeFileSync(outFullPath, 'mp3'),
      probeDuration: () => 4.2,
    });
    const r = await post({ speaker: 'Logan', text: 'Hello there' });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.audioUrl).toBe('/output/vox/take_1000.mp3');
    expect(j.duration).toBe(4.2);
    expect(j.durationEstimated).toBe(false);
    expect(fs.existsSync(path.join(root, 'public/output/vox/take_1000.mp3'))).toBe(true);
  });

  it('fails with the real error when synthesis fails, with no substitute voice or canned take', async () => {
    const post = await serve({
      runHfSynth: () => {
        throw Object.assign(new Error('Command failed'), { stderr: 'Space is busy' });
      },
    });
    const r = await post({ speaker: 'Logan', text: 'Ladies and gentlemen, dessa block' });
    expect(r.status).toBe(502);
    const j = await r.json();
    expect(j.error).toBe('Vox unavailable');
    expect(j.details.join(' ')).toContain('Space is busy');
    expect(j.audioUrl).toBeUndefined();
  });

  it('marks the duration as estimated when ffprobe cannot read it', async () => {
    const post = await serve({ runHfSynth: ({ outFullPath }) => fs.writeFileSync(outFullPath, 'x'), probeDuration: () => null });
    const j = await (await post({ text: 'one two three four five six' })).json();
    expect(j.durationEstimated).toBe(true);
    expect(j.duration).toBeGreaterThan(0);
  });

  it('rejects empty text', async () => {
    const post = await serve({ runHfSynth: () => { throw new Error('should not run'); } });
    expect((await post({ text: '  ' })).status).toBe(400);
  });
});
