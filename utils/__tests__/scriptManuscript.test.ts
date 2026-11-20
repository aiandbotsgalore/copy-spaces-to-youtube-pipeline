/**
 * Manuscript states (working master, locked passages, recording manuscript) and the PaperTrail bridge client.
 * The bridge is never started for real here: a fake child process stands in for papertrail_bridge.py.
 */
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { createPaperTrailBridge, groupPassagesByRecording, type PaperTrailBridge } from '../../server/paperTrailBridge';
import { createScriptStudioMiddleware } from '../../server/scriptStudioMiddleware';
import { lockVerbatimPassages, renderManuscript } from '../scriptManuscript';
import { parseUploadedScript } from '../scriptUpload';
import type { Block, Segment } from '../scriptTypes';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-manuscript-')); dirs.push(d); return d; };

const narr = (id: string, text: string, locked?: boolean): Block => ({ id, kind: 'narration', text, mode: 'polished', claims: [], ...(locked ? { locked: true } : {}) } as Block);
const seg = (blocks: Block[]): Segment[] => [{ id: 's1', title: 'Prologue', scenes: [{ id: 'sc1', title: 'Intro', purpose: '', blocks }] } as Segment];

describe('locking verbatim passages', () => {
  it('locks blocks that match a reference paragraph word for word, ignoring whitespace', () => {
    const segments = seg([narr('a', 'This is the  first line.'), narr('b', 'Something else.'), narr('c', 'The second\nline here.')]);
    const ref = 'This is the first line.\n\nThe second line here.\n';
    const { segments: out, report } = lockVerbatimPassages(segments, ref);
    const blocks = out[0].scenes[0].blocks;
    expect(blocks.map(b => !!b.locked)).toEqual([true, false, true]);
    expect(report).toEqual({ paragraphs: 2, matched: 2, newlyLocked: 2, missing: [] });
    expect(segments[0].scenes[0].blocks[0].locked).toBeUndefined(); // input untouched
  });

  it('reports reference paragraphs that no block matches, and never locks a near match', () => {
    const segments = seg([narr('a', 'This is the first line!')]);
    const { segments: out, report } = lockVerbatimPassages(segments, 'This is the first line.');
    expect(out[0].scenes[0].blocks[0].locked).toBeUndefined();
    expect(report.matched).toBe(0);
    expect(report.missing).toEqual(['This is the first line.']);
  });

  it('locks a repeated paragraph only as many times as the reference has it', () => {
    const segments = seg([narr('a', 'Again.'), narr('b', 'Again.')]);
    const { segments: out } = lockVerbatimPassages(segments, 'Again.');
    expect(out[0].scenes[0].blocks.map(b => !!b.locked)).toEqual([true, false]);
  });

  it('leaves already locked blocks locked and does not count them as new', () => {
    const segments = seg([narr('a', 'Kept.', true)]);
    const { segments: out, report } = lockVerbatimPassages(segments, 'Kept.');
    expect(out[0].scenes[0].blocks[0].locked).toBe(true);
    expect(report.newlyLocked).toBe(0);
    expect(report.matched).toBe(1);
  });
});

describe('rendering a manuscript for research tools', () => {
  it('heads a working master as not approved and marks locked passages', () => {
    const text = renderManuscript(seg([narr('a', 'Locked words.', true), narr('b', 'Draft words.')]), { title: 'THE PAPER TRAIL', role: 'working', versionId: 'v1', designatedAt: 0, source: 'master.md' });
    expect(text).toContain('CURRENT WORKING MASTER. Not approved for recording as a whole');
    expect(text).toContain('[LOCKED] Locked words.');
    expect(text).toMatch(/\nDraft words\.\n/);
    expect(text).toContain('imported from master.md');
  });

  it('heads a recording manuscript as fully approved', () => {
    const text = renderManuscript(seg([narr('a', 'Words.')]), { title: 'T', role: 'recording', versionId: 'v2', designatedAt: 0 });
    expect(text).toContain('FULLY APPROVED RECORDING MANUSCRIPT');
  });
});

/* A fake papertrail_bridge.py: answers each JSON line through `reply`. */
function fakeProcess(reply: (msg: any, out: PassThrough) => void) {
  const spawned: { cmd: string; args: string[]; env: NodeJS.ProcessEnv }[] = [];
  let current: any = null;
  const spawnImpl = (cmd: string, args: string[], env: NodeJS.ProcessEnv) => {
    spawned.push({ cmd, args, env });
    const child: any = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => { child.emit('exit', null); };
    let buf = '';
    child.stdin.on('data', (d: Buffer) => {
      buf += d.toString();
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); reply(JSON.parse(line), child.stdout); }
    });
    current = child;
    return child;
  };
  return { spawnImpl, spawned, crash: (code = 1) => current?.emit('exit', code) };
}

describe('PaperTrail bridge client', () => {
  it('sends read operations over one persistent process and matches answers by request id', async () => {
    const f = fakeProcess((m, out) => out.write(JSON.stringify({ ok: true, _request_id: m._request_id, result: { op: m.operation, q: m.query } }) + '\n'));
    const bridge = createPaperTrailBridge({ spawnImpl: f.spawnImpl, manuscriptPath: () => '/x/working-master.md' });
    const [a, b] = await Promise.all([bridge.request('hybrid_search', { query: 'Sav' }), bridge.request('timeline', { query: 'eviction' })]);
    expect(a).toEqual({ ok: true, result: { op: 'hybrid_search', q: 'Sav' } });
    expect(b).toEqual({ ok: true, result: { op: 'timeline', q: 'eviction' } });
    expect(f.spawned).toHaveLength(1);
    expect(f.spawned[0].args[0]).toBe('-u');
    expect(f.spawned[0].env.PAPERTRAIL_MASTER_MANUSCRIPT).toBe('/x/working-master.md');
    expect(bridge.status()).toMatchObject({ running: true, requests: 2, failures: 0 });
  });

  it('refuses write operations such as memory_upsert without starting the process', async () => {
    const f = fakeProcess(() => { throw new Error('should not be called'); });
    const bridge = createPaperTrailBridge({ spawnImpl: f.spawnImpl });
    const r = await bridge.request('memory_upsert', { text: 'x' });
    expect(r.ok).toBe(false);
    expect(f.spawned).toHaveLength(0);
  });

  it('passes the bridge error through and survives stray non-JSON output', async () => {
    const f = fakeProcess((m, out) => { out.write('loading model...\n'); out.write(JSON.stringify({ ok: false, _request_id: m._request_id, error: 'no such passage' }) + '\n'); });
    const bridge = createPaperTrailBridge({ spawnImpl: f.spawnImpl });
    expect(await bridge.request('passage_text', { passage_id: 'p1' })).toEqual({ ok: false, reason: 'no such passage' });
  });

  it('gives up after the timeout and fails pending requests when the process stops', async () => {
    const f = fakeProcess(() => { /* never answers */ });
    const bridge = createPaperTrailBridge({ spawnImpl: f.spawnImpl, timeoutMs: 20 });
    const r = await bridge.request('search', { query: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/did not answer search/);

    const slow = createPaperTrailBridge({ spawnImpl: f.spawnImpl, timeoutMs: 5_000 });
    const pending = slow.request('search', { query: 'y' });
    f.crash(1);
    const r2 = await pending;
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toMatch(/stopped \(exit 1\)/);
    expect(slow.status().running).toBe(false);
    // Backs off instead of respawning a crashing bridge on every request.
    expect((await slow.request('search', { query: 'z' })).ok).toBe(false);
    expect(f.spawned).toHaveLength(2);
  });

  it('reports a missing bridge script as unavailable', async () => {
    const bridge = createPaperTrailBridge({ script: path.join(tmp(), 'missing_bridge.py') });
    const r = await bridge.request('status');
    expect(r.ok).toBe(false);
    expect(bridge.status().configured).toBe(false);
  });
});

describe('grouping bridge passages into recordings', () => {
  it('ranks recordings by passage rank, skips excluded ones and keeps documents apart', () => {
    const items = [
      { recording_id: '20260101_a', title: 'A', event_date: '2026-01-01T00:00:00', start_seconds: 10, speaker: 'Logan', text: 'one' },
      { recording_id: '20260202_b', title: 'B', start_seconds: 5, text: 'two' },
      { source_id: 'doc1', title: 'Court filing', text: 'three' },
      { recording_id: '20260101_a', start_seconds: 20, text: 'four' },
      { recording_id: '20260303_c', text: 'five' },
    ];
    const { hits, documents } = groupPassagesByRecording(items, { exclude: ['20260303_c'] });
    expect(hits.map(h => h.releaseTag)).toEqual(['20260101_a', '20260202_b']);
    expect(hits[0]).toMatchObject({ title: 'A', date: '2026-01-01', score: 1.25 });
    expect(hits[0].samples.map(s => s.text)).toEqual(['one', 'four']);
    expect(documents).toHaveLength(1);
  });
});

/* Middleware routes ------------------------------------------------------------------------------ */

function studio(bridgeAnswer?: (op: string, params: any) => any) {
  const root = tmp();
  const ep = path.join(root, 'public', 'transcripts', 'episodes');
  fs.mkdirSync(ep, { recursive: true });
  fs.writeFileSync(path.join(ep, '20260101_known.json'), JSON.stringify({ release_tag: '20260101_known', title: 'Known', segments: [{ start: 0, end: 5, speaker: 'Logan', text: 'Sav talked about the eviction.' }] }));
  fs.writeFileSync(path.join(ep, '20260202_other.json'), JSON.stringify({ release_tag: '20260202_other', title: 'Other', segments: [{ start: 0, end: 5, speaker: 'Logan', text: 'Nothing relevant here.' }] }));
  fs.writeFileSync(path.join(root, 'MASTER.md'), '# THE PAPER TRAIL\n\n## Prologue\n\n### Intro\n\nThis is the locked intro.\n\nThis line is still a draft.\n');
  fs.writeFileSync(path.join(root, 'INTRO.txt'), 'This is the locked intro.\n');
  const restarts: number[] = [];
  const bridge: PaperTrailBridge = {
    request: async (op: string, params: any = {}) => (bridgeAnswer ? { ok: true, result: bridgeAnswer(op, params) } : { ok: false, reason: 'not running' }) as any,
    restart: () => { restarts.push(1); },
    status: () => ({ configured: !!bridgeAnswer, running: false, script: 'fake', requests: 0, failures: 0 }),
  };
  const mw = createScriptStudioMiddleware({ root, getEnv: () => ({}), now: () => 1_700_000_000_000, paperTrailBridge: bridge });
  const call = async (method: string, url: string, body?: any) => {
    let statusCode = 200; let out = '';
    const req: any = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
    Object.assign(req, { method, url, socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost', 'content-type': 'application/json' } });
    const res: any = { setHeader: () => {}, end: (d?: any) => { if (d) out += d.toString(); }, write: (d?: any) => { if (d) out += d.toString(); },
      get statusCode() { return statusCode; }, set statusCode(v: number) { statusCode = v; } };
    await mw(req, res);
    return { status: statusCode, body: out ? JSON.parse(out) : null };
  };
  return { root, call, restarts };
}

describe('manuscript routes', () => {
  it('imports a manuscript as the working master, locks the verbatim intro, and does not approve it for recording', async () => {
    const s = studio();
    const r = await s.call('POST', '/manuscript/import', { file: 'MASTER.md', lockFile: 'INTRO.txt', releaseTags: ['20260101_known'] });
    expect(r.status).toBe(201);
    expect(r.body.lock).toMatchObject({ paragraphs: 1, matched: 1, newlyLocked: 1, missing: [] });
    const p = r.body.project;
    expect(p.manuscript.working).toMatchObject({ versionId: r.body.version.id, source: 'MASTER.md' });
    expect(p.manuscript.recording).toBeUndefined();
    const blocks = r.body.version.segments.flatMap((sg: any) => sg.scenes.flatMap((sc: any) => sc.blocks));
    expect(blocks.find((b: any) => b.text === 'This is the locked intro.')?.locked).toBe(true);
    expect(blocks.find((b: any) => b.text === 'This line is still a draft.')?.locked).toBeFalsy();
    const file = fs.readFileSync(r.body.manuscriptFile, 'utf8');
    expect(file).toContain('CURRENT WORKING MASTER');
    expect(file).toContain('[LOCKED] This is the locked intro.');
    expect(s.restarts).toHaveLength(1); // the bridge restarts once to pick up the new manuscript file

    const g = await s.call('GET', `/manuscript?projectId=${p.id}`);
    expect(g.body.working).toMatchObject({ lockedBlocks: 1, missing: false });
    expect(g.body.recording).toBeNull();
  });

  it('approves for recording only with explicit confirmation, and can withdraw it', async () => {
    const s = studio();
    const imp = await s.call('POST', '/manuscript/import', { file: 'MASTER.md', releaseTags: ['20260101_known'] });
    const pid = imp.body.project.id, vid = imp.body.version.id;
    const noConfirm = await s.call('POST', '/manuscript/designate', { projectId: pid, role: 'recording', versionId: vid });
    expect(noConfirm.status).toBe(400);
    const ok = await s.call('POST', '/manuscript/designate', { projectId: pid, role: 'recording', versionId: vid, confirm: true });
    expect(ok.body.project.manuscript.recording.versionId).toBe(vid);
    expect(fs.readFileSync(ok.body.manuscriptFile, 'utf8')).toContain('FULLY APPROVED RECORDING MANUSCRIPT');
    const cleared = await s.call('POST', '/manuscript/designate', { projectId: pid, role: 'recording', clear: true });
    expect(cleared.body.project.manuscript.recording).toBeUndefined();
    expect(cleared.body.project.manuscript.working.versionId).toBe(vid);
    expect((await s.call('POST', '/manuscript/designate', { projectId: pid, role: 'working', clear: true })).status).toBe(400);
  });

  it('only imports plain text files from the project folder', async () => {
    const s = studio();
    expect((await s.call('POST', '/manuscript/import', { file: '../secret.md' })).status).toBe(400);
    expect((await s.call('POST', '/manuscript/import', { file: 'sub/MASTER.md' })).status).toBe(400);
    expect((await s.call('POST', '/manuscript/import', { file: 'MASTER.json' })).status).toBe(400);
    expect((await s.call('POST', '/manuscript/import', { file: 'NOPE.md' })).status).toBe(404);
  });
});

describe('recording search through the bridge', () => {
  it('uses PaperTrail hybrid search when it answers, keeping recordings with Studio transcripts', async () => {
    const s = studio((op) => op === 'hybrid_search'
      ? { items: [{ recording_id: '20260101_known', title: 'Known', text: 'Sav and the eviction' }, { recording_id: '20991231_elsewhere', text: 'x' }, { source_id: 'd', text: 'doc' }] }
      : null);
    const prj = await s.call('POST', '/project', { releaseTag: '20260202_other' });
    const r = await s.call('GET', `/related?projectId=${prj.body.project.id}&q=Sav%20eviction`);
    expect(r.body.retrieval).toBe('papertrail-hybrid');
    expect(r.body.hits.map((h: any) => h.releaseTag)).toEqual(['20260101_known']);
    expect(r.body.note).toMatch(/1 matching recording\(s\) have no Studio transcript yet/);
    expect(r.body.note).toMatch(/1 matching document passage/);
  });

  it('falls back to keyword search and says why when the bridge is unavailable', async () => {
    const s = studio();
    const prj = await s.call('POST', '/project', { releaseTag: '20260202_other' });
    const r = await s.call('GET', `/related?projectId=${prj.body.project.id}&q=Sav%20eviction`);
    expect(r.body.retrieval).toBe('keyword');
    expect(r.body.note).toMatch(/PaperTrail bridge unavailable \(not running\)/);
    expect(r.body.hits.map((h: any) => h.releaseTag)).toEqual(['20260101_known']);
  });
});

describe('reading THE PAPER TRAIL manuscript format', () => {
  const sample = [
    '### ACT I — SCENE 1: A PLACE TO TELL YOUR STORY',
    '',
    '**SONIC FOUNDATION:** Dry room tone.',
    '',
    'That was the world where I first met Angela.',
    '',
    '`[beat]`',
    '',
    '`[CLIP #115-A | AQ-0115 | *Blame Mellow Demon* (20260218_1YpKkgYPjkmKj), Feb 18, 2026, 4321.3s]`',
    '',
    '**ANGELA**  ',
    '"Okay. So I don\'t want a trigger warning."',
    '',
    '`[SFX: Clip fades cleanly.]`',
    '',
    '**LOGAN**  ',
    'There was a lot to take in.',
    '',
    '`[CLIP #009-M & #010-M | AQ-0241 & AQ-0242 | *SPACE # 1000* (20260217_1mrGmBoEYMdJy), Feb 17, 2026, 31776.0s]`',
    '',
    '**ANGELA:** "I can introduce you to the people."',
    '**LOGAN:** "But you gotta stop telling people."  ',
    '**SPEAKER 1:** `[laughing]` "Murder Logan too."',
    '',
    '**LOGAN**',
    'Later, she said something else.',
    '',
    '[ARCHIVE — ANGELA | *Hook Line Sinker*, September 8, 2026 | Approximately 35:05 — confirm original audio]',
    '',
    '**ANGELA**',
    '"I stopped telling you about it."',
    '',
    '[CUT.]',
    '',
    '[PERFORMED READING — SAV\'S WRITTEN MESSAGE TO ANGELA]',
    '',
    '**SAV — WRITTEN**',
    '"I fell for the guy dude."',
    '',
    '`[WRITTEN-MESSAGE READING (not original audio): SAV — DM TO ANGELA, SEPT 15, 2026, 11:42 PM]`  ',
    '`[plain neutral delivery]`  ',
    '"Angela, you know that picture was proof."',
    '',
    '[NON-SPOKEN SOURCE HOLD — September 26 is the file tag.]',
    '',
    '**LOGAN (ARCHIVAL)**',
    '"Good."',
    '',
    '**LOGAN**',
    'Angela called it a long line of destruction.',
  ].join('\n');
  let n = 0;
  const blocks = parseUploadedScript(sample, { idGenerator: p => `${p}${n++}` }).flatMap(sg => sg.scenes.flatMap(sc => sc.blocks)) as any[];

  it('reads clip lines and the quoted words after them as archival tape, with their recording', () => {
    const clips = blocks.filter(b => b.kind === 'clip');
    expect(clips.map(c => c.clipNumber)).toEqual(['115-A', '009-M & 010-M', 'archive Hook Line Sinker 35:05']);
    expect(clips[0]).toMatchObject({ clipId: 'clip_115_a', speaker: 'Angela', keptText: "Okay. So I don't want a trigger warning.", releaseTag: '20260218_1YpKkgYPjkmKj', time: '4321.3s', spaceTitle: 'Blame Mellow Demon' });
    expect(clips[0].rationale).toContain('AQ-0115');
  });

  it('keeps an exchange as one clip, with Logan heard on tape and delivery notes removed', () => {
    const ex = blocks.find(b => b.clipNumber === '009-M & 010-M');
    expect(ex.speaker).toBe('Angela, Logan, Speaker 1');
    expect(ex.keptText).toBe('Angela: I can introduce you to the people.\nLogan: But you gotta stop telling people.\nSpeaker 1: Murder Logan too.');
  });

  it('treats **LOGAN** as Logan narrating and never speaks the label', () => {
    const narration = blocks.filter(b => b.kind === 'narration' && b.type !== 'QUOTE_READ').map(b => b.text);
    expect(narration).toEqual(['That was the world where I first met Angela.', 'There was a lot to take in.', 'Later, she said something else.', 'Angela called it a long line of destruction.']);
  });

  it('marks written messages read aloud, and tape with no clip line, as other people\'s words', () => {
    const reads = blocks.filter(b => b.type === 'QUOTE_READ');
    expect(reads.map(r => [r.quoteSpeaker, r.text])).toEqual([['Sav', 'I fell for the guy dude.'], ['Sav', 'Angela, you know that picture was proof.'], ['Logan (Archival)', 'Good.']]);
    expect(reads.every(r => r.readEvidence)).toBe(true);
    expect(reads[1].quoteMeta).toMatch(/^WRITTEN-MESSAGE READING/);
    expect(reads[2].quoteMeta).toMatch(/without a clip line/);
  });

  it('keeps cues and non-spoken notes out of the narration', () => {
    expect(blocks.some(b => b.kind === 'cue' && b.cueType === 'beat')).toBe(true);
    expect(blocks.find(b => b.kind === 'cue' && b.cueType === 'sfx')?.text).toBe('Clip fades cleanly.');
    const notes = blocks.filter(b => b.kind === 'cue' && b.cueType === 'production_note').map(b => b.text);
    expect(notes).toEqual(expect.arrayContaining(['Sonic Foundation: Dry room tone.', 'CUT.', 'plain neutral delivery', 'NON-SPOKEN SOURCE HOLD — September 26 is the file tag.']));
  });

  it('files imported clips under the recording each clip line names', async () => {
    const s = studio();
    fs.writeFileSync(path.join(s.root, 'PT.md'), sample);
    const r = await s.call('POST', '/manuscript/import', { file: 'PT.md', releaseTags: ['20260101_known'] });
    const bin = r.body.project.clips;
    expect(bin.find((c: any) => c.clipId === 'clip_115_a')?.releaseTag).toBe('20260218_1YpKkgYPjkmKj');
    expect(bin.find((c: any) => c.clipId.startsWith('clip_archive'))?.releaseTag).toBe('20260101_known'); // no tag named: the project's recording
  });
});
