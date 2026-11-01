import { describe, expect, it } from 'vitest';
import { normalizeViralScore } from './clipScore';

describe('normalizeViralScore', () => {
  it('converts mixed 0..100 and 0..10 values without changing rank order', () => {
    const input = [95, 9, 85, 8];
    const output = input.map(normalizeViralScore);
    expect(output).toEqual([9.5, 9, 8.5, 8]);
    expect([...output].sort((a, b) => b - a)).toEqual(output);
  });

  it('clamps invalid and out-of-range values safely', () => {
    expect(normalizeViralScore(150)).toBe(10);
    expect(normalizeViralScore(-2)).toBe(0);
    expect(normalizeViralScore('bad')).toBe(8);
  });
});
