import { describe, it, expect } from 'vitest';
import {
  TRANSCRIPT_LAYOUT_KEY, DEFAULT_TRANSCRIPT_LAYOUT, clampPanelWidth,
  restoreTranscriptLayout, layoutForPreset, normalizeTag,
} from '../transcriptLayout';

describe('approved transcript workbench layout', () => {
  it('uses a versioned storage key and safe defaults', () => {
    expect(TRANSCRIPT_LAYOUT_KEY).toContain('_v2');
    expect(restoreTranscriptLayout(null)).toEqual(DEFAULT_TRANSCRIPT_LAYOUT);
    expect(restoreTranscriptLayout('{broken')).toEqual(DEFAULT_TRANSCRIPT_LAYOUT);
  });
  it('restores independently hidden panels and collapsed modules', () => {
    const input = {
      ...DEFAULT_TRANSCRIPT_LAYOUT,
      episodesVisible: false, inspectorVisible: true,
      episodeWidth: 342, inspectorWidth: 379,
      sectionOpen: { details: false, actions: true, tags: false },
      inspectorTab: 'clips',
    };
    expect(restoreTranscriptLayout(JSON.stringify(input))).toEqual(input);
  });
  it('rejects malformed widths, tabs and module fields', () => {
    const state = restoreTranscriptLayout(JSON.stringify({
      episodeWidth: -500, inspectorWidth: 10000,
      inspectorTab: 'invalid', sectionOpen: { details: 'no' },
    }));
    expect(state.episodeWidth).toBe(220);
    expect(state.inspectorWidth).toBe(440);
    expect(state.inspectorTab).toBe('details');
    expect(state.sectionOpen).toEqual({ details: true, actions: true, tags: true });
  });
  it('supports five presets without losing resize preferences', () => {
    const custom = { ...DEFAULT_TRANSCRIPT_LAYOUT, episodeWidth: 337, inspectorWidth: 345 };
    expect(layoutForPreset('focus', custom)).toMatchObject({
      episodesVisible: false, inspectorVisible: false, episodeWidth: 337, inspectorWidth: 345,
    });
    expect(layoutForPreset('episodes-hidden', custom).inspectorVisible).toBe(true);
    expect(layoutForPreset('inspector-hidden', custom).episodesVisible).toBe(true);
    expect(layoutForPreset('compact', custom).episodeWidth).toBe(252);
    expect(layoutForPreset('full', custom)).toMatchObject({ episodesVisible: true, inspectorVisible: true, episodeWidth: 296 });
  });
  it('normalizes saved tags and constrains panel dimensions', () => {
    expect(normalizeTag('  UFO   disclosure  ')).toBe('UFO disclosure');
    expect(clampPanelWidth(NaN)).toBe(220);
  });
});
