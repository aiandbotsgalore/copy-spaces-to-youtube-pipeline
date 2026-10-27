import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { chunkUtterances, parseTranscriptJson, readTranscript, speakerStats, utteranceLine, isSafeTag, toEvidenceRefs } from '../../server/scriptData';

const ROOT = path.join(__dirname, '..', '..');
const TAG = '20260826_1AxRnZYBVdrxl';

describe('transcript data', () => {
  const t = readTranscript(ROOT, TAG)!;
  it('reads a real transcript with stable utterance ids and a content hash', () => {
    expect(t.utterances[92]).toMatchObject({ id: 'u92', speaker: 'Oor', start: 1207.94 });
    expect(t.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(utteranceLine(t.utterances[92], { Oor: 'Oor P.' })).toMatch(/^\[u92 00:20:07 Oor P\.\] Yo, this thing/);
  });
  it('chunks in order, never splitting an utterance', () => {
    const chunks = chunkUtterances(t.utterances, {}, 5000);
    expect(chunks.length).toBeGreaterThan(3);
    const ids = chunks.flatMap(c => c.split('\n').map(l => /^\[(u\d+) /.exec(l)![1]));
    expect(ids).toEqual(t.utterances.map(u => u.id));
    for (const c of chunks.slice(0, -1)) expect(c.length).toBeLessThanOrEqual(5000 * 4 + 2000);
  });
  it('reports the unnamed speaker share', () => {
    const tt = parseTranscriptJson(JSON.stringify({ title: 'x', segments: [
      { start: 0, end: 30, speaker: 'SPEAKER_00', text: 'a' }, { start: 30, end: 40, speaker: 'Logan', text: 'b' },
    ] }), 'x');
    const s = speakerStats(tt.utterances, {});
    expect(s.unnamedShare).toBeCloseTo(0.75);
    expect(speakerStats(tt.utterances, { SPEAKER_00: 'Dana' }).unnamedShare).toBe(0);
  });
  it('fills claim times and speaker from utterance ids, and rejects unknown ids', () => {
    const r = toEvidenceRefs([{ utteranceIds: ['u92', 'u93'], verbatim: 'Delicious.' }], t, {});
    expect(r).toEqual({ ok: true, refs: [{ releaseTag: TAG, segStart: 1207.94, segEnd: 1242.38, speaker: 'Oor', verbatim: 'Delicious.' }] });
    expect(toEvidenceRefs([{ utteranceIds: ['u99999'], verbatim: 'x' }], t, {}).ok).toBe(false);
  });
  it('refuses path-like release tags', () => {
    expect(isSafeTag(TAG)).toBe(true);
    expect(isSafeTag('../secrets')).toBe(false);
  });
});
