import { describe, it, expect, vi } from 'vitest';
import { isWhisperModelLoaded } from '../clientWhisper';

describe('clientWhisper utility', () => {
  it('reports initial model status as unloaded', () => {
    expect(isWhisperModelLoaded()).toBe(false);
  });
});
