import { describe, it, expect } from 'vitest';
import {
  TRANSCRIPT_LAYOUT_KEY, DEFAULT_TRANSCRIPT_LAYOUT, restoreTranscriptLayout, layoutForPreset,
} from '../useTranscriptLayout';

describe('approved Midnight Console transcript layout', () => {
  it('uses the approved storage key and safe defaults', () => {
    expect(TRANSCRIPT_LAYOUT_KEY).toBe('spacepipe:transcripts:approved-layout:v1');
    expect(restoreTranscriptLayout(null)).toEqual(DEFAULT_TRANSCRIPT_LAYOUT);
    expect(restoreTranscriptLayout('{broken')).toEqual(DEFAULT_TRANSCRIPT_LAYOUT);
    expect(restoreTranscriptLayout('null')).toEqual(DEFAULT_TRANSCRIPT_LAYOUT);
    expect(restoreTranscriptLayout('[]')).toEqual(DEFAULT_TRANSCRIPT_LAYOUT);
  });

  it('restores hidden panels, panel widths, inspector tab and collapsed modules', () => {
    const stored = {
      ...DEFAULT_TRANSCRIPT_LAYOUT,
      episodeOpen: false,
      inspectorOpen: true,
      episodeWidth: 342,
      inspectorWidth: 379,
      inspectorTab: 'clips',
      sections: { details: false, actions: true, tags: false },
    };
    expect(restoreTranscriptLayout(JSON.stringify(stored))).toEqual(stored);
  });

  it('rejects malformed widths, tabs and module fields', () => {
    const state = restoreTranscriptLayout(JSON.stringify({
      episodeWidth: -500, inspectorWidth: 10000,
      inspectorTab: 'invalid', sections: { details: 'no' },
    }));
    expect(state.episodeWidth).toBe(220);
    expect(state.inspectorWidth).toBe(460);
    expect(state.inspectorTab).toBe('details');
    expect(state.sections).toEqual({ details: true, actions: true, tags: true });
    expect(state.episodeOpen).toBe(true);
    expect(state.inspectorOpen).toBe(true);
  });

  it('applies all five presets without losing resize preferences or the inspector tab', () => {
    const resized = { ...DEFAULT_TRANSCRIPT_LAYOUT, episodeWidth: 337, inspectorWidth: 345, inspectorTab: 'speakers' as const };

    expect(layoutForPreset('full', resized)).toMatchObject({ episodeOpen: true, inspectorOpen: true });
    expect(layoutForPreset('compact', resized)).toMatchObject({ episodeOpen: true, inspectorOpen: true });
    expect(layoutForPreset('no-episodes', resized)).toMatchObject({ episodeOpen: false, inspectorOpen: true });
    expect(layoutForPreset('no-inspector', resized)).toMatchObject({ episodeOpen: true, inspectorOpen: false });
    expect(layoutForPreset('minimal', resized)).toMatchObject({ episodeOpen: false, inspectorOpen: false });

    for (const preset of ['full', 'compact', 'no-episodes', 'no-inspector', 'minimal'] as const) {
      expect(layoutForPreset(preset, resized)).toMatchObject({
        episodeWidth: 337, inspectorWidth: 345, inspectorTab: 'speakers',
      });
    }
  });
});
