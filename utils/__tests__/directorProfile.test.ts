import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DIRECTOR_MODEL,
  FALLBACK_DIRECTOR_MODEL,
  targetForCut,
  findBannedLanguage,
  buildSystemPrompt,
  ARCHETYPES,
} from '../directorProfile';

describe('director profile', () => {
  it('defaults to claude-sonnet-5.5 and never to a mini/flash model', () => {
    expect(DEFAULT_DIRECTOR_MODEL).toBe('claude-sonnet-5.5');
    for (const m of [DEFAULT_DIRECTOR_MODEL, FALLBACK_DIRECTOR_MODEL]) {
      expect(m.startsWith('claude-')).toBe(true);
      expect(/mini|flash|nano|lite/i.test(m)).toBe(false);
    }
  });

  it('clamps the Cold Open to 30-60 s and leaves other cuts alone', () => {
    expect(targetForCut('cut_c', 90)).toBe(60);
    expect(targetForCut('cut_c', 10)).toBe(30);
    expect(targetForCut('cut_c', 45)).toBe(45);
    expect(targetForCut('cut_a', 90)).toBe(90);
    expect(targetForCut('cut_b', NaN)).toBe(90);
  });

  it('flags loaded language in the Director voice', () => {
    expect(findBannedLanguage('Speaker is a liar')).toBe('liar');
    expect(findBannedLanguage('A shocking bombshell')).toBe('shocking');
    expect(findBannedLanguage('Scorched   earth campaign')).toBe('scorched earth');
    expect(findBannedLanguage('Speaker states the rule she applies to others')).toBeNull();
    expect(findBannedLanguage('Describes filing a police report')).toBeNull();
  });

  it('assembles a system prompt from the archetype data', () => {
    const p = buildSystemPrompt('cut_c', 'generate');
    expect(p).toContain(ARCHETYPES.cut_c.title);
    expect(p).toContain('OUTPUT (generate)');
    expect(buildSystemPrompt('cut_a', 'refine')).toContain('OUTPUT (refine)');
  });

  it('archetype titles stay descriptive (no trope labels)', () => {
    for (const a of Object.values(ARCHETYPES)) expect(findBannedLanguage(a.title)).toBeNull();
  });
});
