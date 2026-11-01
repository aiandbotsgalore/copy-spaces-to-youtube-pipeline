import { describe, expect, it } from 'vitest';
import { annotateJunkSuspects } from './junkSuspect';

describe('annotateJunkSuspects', () => {
  it('flags duplicated review candidates without removing them', () => {
    const clips: any[] = Array.from({ length: 5 }, (_, i) => ({
      title: `Candidate ${i}`,
      category: 'Highlights',
      start_seconds: 10,
      end_seconds: 70,
      speakers: ['Speaker 1'],
      viral_score: 8,
      reason: 'generated',
      transcript_snippet: 'same repeated snippet',
      episode: 'Test Space',
    }));
    const result = annotateJunkSuspects(clips as any);
    expect(result).toHaveLength(5);
    expect(result.every(item => item.junk_suspect)).toBe(true);
    expect(result[0].junk_reason).toContain('normalized-text duplicates');
  });
});
