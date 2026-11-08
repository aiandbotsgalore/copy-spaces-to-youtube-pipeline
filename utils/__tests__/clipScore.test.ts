import { describe, it, expect } from 'vitest';
import { canonicalizeSpeakerName, normalizeClipSpeakers, normalizeViralScore } from '../clipScore';

describe('clipScore speaker consolidation', () => {
  it('consolidates Logan variations strictly under "Logan"', () => {
    expect(canonicalizeSpeakerName('Logan')).toBe('Logan');
    expect(canonicalizeSpeakerName('Logan Black')).toBe('Logan');
    expect(canonicalizeSpeakerName('logan')).toBe('Logan');
    expect(canonicalizeSpeakerName('logan black')).toBe('Logan');
    expect(canonicalizeSpeakerName('  Logan Black  ')).toBe('Logan');
  });

  it('leaves other speaker names unchanged', () => {
    expect(canonicalizeSpeakerName('Angela')).toBe('Angela');
    expect(canonicalizeSpeakerName('Larry')).toBe('Larry');
    expect(canonicalizeSpeakerName('Dorgy Meta')).toBe('Dorgy Meta');
  });

  it('normalizes clip speakers array and splits comma-separated artifacts', () => {
    const raw = ['Logan,Speaker1,Speaker5'];
    const normalized = normalizeClipSpeakers(raw);
    expect(normalized).toEqual(['Logan', 'Speaker1', 'Speaker5']);
  });

  it('normalizes comma-separated Logan variations with other speakers', () => {
    const raw = ['Logan,Speaker5'];
    const normalized = normalizeClipSpeakers(raw);
    expect(normalized).toEqual(['Logan', 'Speaker5']);
  });

  it('consolidates "Logan Black" inside speakers array to "Logan"', () => {
    const raw = ['Lana', 'Logan Black', 'Dorgy Meta'];
    const normalized = normalizeClipSpeakers(raw);
    expect(normalized).toEqual(['Lana', 'Logan', 'Dorgy Meta']);
  });

  it('handles broken letter-by-letter arrays and splits on commas', () => {
    const raw = ['L', 'o', 'g', 'a', 'n', ',', ' ', 'S', 'p', 'e', 'a', 'k', 'e', 'r', ' ', '5'];
    const normalized = normalizeClipSpeakers(raw);
    expect(normalized).toEqual(['Logan', 'Speaker 5']);
  });

  it('deduplicates multiple Logan variations in the same clip', () => {
    const raw = ['Logan', 'Logan Black', 'logan'];
    const normalized = normalizeClipSpeakers(raw);
    expect(normalized).toEqual(['Logan']);
  });
});
