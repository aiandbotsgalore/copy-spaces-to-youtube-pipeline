import { describe, it, expect } from 'vitest';
import { prefilterPool, prepareCandidates, rankAndStratify, truncateText, describeNoCandidates } from '../directorCandidates';
import type { ClipLike } from '../directorTypes';

const HARD = 'defended him relentlessly';
const mk = (id: string, over: Partial<ClipLike> = {}): ClipLike => ({
  id,
  quote: `quote text for ${id}`,
  speaker: 'Angela',
  title: id,
  category: 'Direct Allegation',
  audioUrl: `clips/${id}.wav`,
  startSec: 0,
  endSec: 30,
  status: 'EXISTS',
  severity: 7,
  ...over,
});
const never = () => false;

describe('prefilterPool', () => {
  it('removes excluded, hard-phrase, blacklisted, unavailable and audio-less clips and counts reasons', () => {
    const pool = [
      mk('ok'),
      mk('ex', { isExcluded: true }),
      mk('hard', { quote: 'She Defended Him Relentlessly, always' }),
      mk('bl', { quoteId: 'AQ-0269' }),
      mk('na', { status: 'SOURCE_NOT_AVAILABLE' }),
      mk('noaudio', { audioUrl: undefined }),
    ];
    const { eligible, stats } = prefilterPool(pool, { isBlacklisted: k => k === 'AQ-0269', hardExcludePhrase: HARD });
    expect(eligible.map(c => c.id)).toEqual(['ok']);
    expect(stats).toMatchObject({ total: 6, excluded: 2, blacklisted: 1, unavailable: 1, noAudio: 1 });
  });
});

describe('prepareCandidates', () => {
  const opts = (probe: (u: string) => Promise<number | null>, extra: any = {}) => ({
    isBlacklisted: never,
    hardExcludePhrase: HARD,
    userPrompt: 'allegation',
    probe,
    ...extra,
  });

  it('uses REAL probed durations (never the 30 s placeholder) and reconciles windows', async () => {
    const pool = [mk('a', { windowPlaceholder: true }), mk('b', { startSec: 5625.6, endSec: 5694.2 })];
    const probe = async (u: string) => (u.includes('/a.') ? 12.34 : 68.6);
    const { candidates, byId } = await prepareCandidates(pool, opts(probe));
    const a = candidates.find(c => c.id === 'a')!;
    const b = candidates.find(c => c.id === 'b')!;
    expect(a.durationSec).toBe(12.3);
    expect(b.durationSec).toBe(68.6);
    expect(byId.a.endSec).toBe(12.34);
    expect(byId.b.startSec).toBe(0);
    expect(byId.b.episodeStartSec).toBe(5625.6);
  });

  it('drops clips whose duration cannot be probed and reports them', async () => {
    const pool = [mk('good'), mk('bad')];
    const { candidates, stats } = await prepareCandidates(pool, opts(async u => (u.includes('bad') ? null : 20)));
    expect(candidates.map(c => c.id)).toEqual(['good']);
    expect(stats.unprobed).toBe(1);
    expect(stats.kept).toBe(1);
  });

  it('returns candidates in stable id order regardless of ranking', async () => {
    const pool = ['d', 'b', 'a', 'c'].map(id => mk(id, { severity: id.charCodeAt(0) % 7 }));
    const { candidates } = await prepareCandidates(pool, opts(async () => 10));
    expect(candidates.map(c => c.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('honours the cap', async () => {
    const pool = Array.from({ length: 30 }, (_, i) => mk(`c${String(i).padStart(2, '0')}`));
    const { candidates } = await prepareCandidates(pool, opts(async () => 10, { cap: 10 }));
    expect(candidates).toHaveLength(10);
  });

  it('never lets excluded or blacklisted clips through', async () => {
    const pool = [mk('x', { isExcluded: true }), mk('y', { quoteId: 'AQ-0269' }), mk('z')];
    const { candidates } = await prepareCandidates(pool, opts(async () => 10, { isBlacklisted: (k: string) => k === 'AQ-0269' }));
    expect(candidates.map(c => c.id)).toEqual(['z']);
  });

  it('marks truncated text', async () => {
    const long = 'word '.repeat(200);
    const { candidates } = await prepareCandidates([mk('long', { quote: long })], opts(async () => 10));
    expect(candidates[0].textTruncated).toBe(true);
    expect(candidates[0].text.length).toBeLessThanOrEqual(280);
  });
});

describe('rankAndStratify', () => {
  it('ranks prompt matches first and caps any single category at 40% when diversity allows', () => {
    const cat = (name: string, n: number, quote: string) =>
      Array.from({ length: n }, (_, i) => mk(`${name.toLowerCase()}${i}`, { category: name, quote }));
    const pool = [...cat('A', 10, 'subpoena subpoena'), ...cat('B', 10, 'other'), ...cat('C', 10, 'other')];
    const out = rankAndStratify(pool, 'subpoena', 10);
    expect(out).toHaveLength(10);
    const counts: Record<string, number> = {};
    out.forEach(c => (counts[c.category as string] = (counts[c.category as string] || 0) + 1));
    expect(Math.max(...Object.values(counts))).toBeLessThanOrEqual(4); // 40% of 10
    expect(out.slice(0, 4).every(c => c.category === 'A')).toBe(true); // best matches lead
  });

  it('refills from overflow when there are not enough categories to honour the cap', () => {
    const pool = [
      ...Array.from({ length: 10 }, (_, i) => mk(`a${i}`, { category: 'A', quote: 'subpoena' })),
      ...Array.from({ length: 6 }, (_, i) => mk(`b${i}`, { category: 'B', quote: 'other' })),
    ];
    expect(rankAndStratify(pool, 'subpoena', 10)).toHaveLength(10);
  });
});

describe('helpers', () => {
  it('truncates at a word boundary', () => {
    const r = truncateText('alpha beta gamma delta', 12);
    expect(r.truncated).toBe(true);
    expect(r.text).toBe('alpha beta');
  });
  it('explains an empty result', () => {
    const msg = describeNoCandidates({ total: 12, excluded: 2, blacklisted: 1, unavailable: 1, noAudio: 3, unprobed: 5, kept: 0 });
    expect(msg).toContain('12 clips considered');
    expect(msg).toContain('5 with unknown duration');
  });
});
