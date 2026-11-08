import { describe, it, expect } from 'vitest';
import { parseGoogleQuery, evaluateTurnMatch, computeSegmentEnergy } from '../transcriptSearch';

describe('Transcript Search Energy & Pacing', () => {
  it('computes segment energy and speech rate correctly', () => {
    // Normal conversational turn: 11 words over 4 seconds = 2.75 WPS
    const normal = computeSegmentEnergy('Hello everyone welcome back to the space tonight we discuss it', 0, 4);
    expect(normal.pacingWps).toBe(2.75);
    expect(normal.energyScore).toBeGreaterThanOrEqual(0.3);
    expect(normal.energyScore).toBeLessThanOrEqual(0.65);

    // High energy rant: 12 words over 3.0 seconds with uppercase and exclamation marks
    const heated = computeSegmentEnergy('YOU ARE LYING TO MY FACE! THIS IS ABSOLUTELY CRAZY! STOP IT RIGHT NOW!', 0, 3.0);
    expect(heated.pacingWps).toBeGreaterThanOrEqual(3.8);
    expect(heated.energyScore).toBeGreaterThan(0.70);
  });

  it('parses energy:>0.8 and pace:fast modifiers from search queries', () => {
    const ast = parseGoogleQuery('Angela energy:>0.8 pace:fast "autonomous taxis"');

    expect(ast.mustTerms).toContain('angela');
    expect(ast.exactPhrases).toContain('autonomous taxis');
    expect(ast.minEnergy).toBe(0.8);
    expect(ast.minPacingWps).toBe(3.8);
    // Modifiers should not be in mustTerms
    expect(ast.mustTerms).not.toContain('energy:>0.8');
    expect(ast.mustTerms).not.toContain('pace:fast');
  });

  it('filters turns by energy threshold in evaluateTurnMatch', () => {
    const ast = parseGoogleQuery('election energy:>0.7');

    const lowEnergyTurn = 'The election happened in November and people voted quietly.';
    const highEnergyTurn = 'The ELECTION was a total SHAM! THEY STOLE EVERYTHING! UNBELIEVABLE!';

    // Low energy turn should fail energy:>0.7 check
    expect(evaluateTurnMatch(lowEnergyTurn, ast, { startSec: 0, endSec: 10 })).toBe(false);

    // High energy turn should pass
    expect(evaluateTurnMatch(highEnergyTurn, ast, { startSec: 0, endSec: 2.5 })).toBe(true);
  });
});
