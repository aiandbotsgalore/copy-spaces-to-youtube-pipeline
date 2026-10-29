import { useCallback, useEffect, useState } from 'react';
import { clampPanelWidth } from './transcriptLayout';

export type TranscriptLayoutPreset = 'full' | 'compact' | 'no-episodes' | 'no-inspector' | 'minimal';
export type TranscriptInspectorTab = 'details' | 'speakers' | 'chapters' | 'clips';
type SectionKey = 'details' | 'actions' | 'tags';
export interface TranscriptLayout {
  episodeOpen: boolean;
  inspectorOpen: boolean;
  episodeWidth: number;
  inspectorWidth: number;
  inspectorTab: TranscriptInspectorTab;
  sections: Record<SectionKey, boolean>;
}

export const TRANSCRIPT_LAYOUT_KEY = 'spacepipe:transcripts:approved-layout:v1';

export const DEFAULT_TRANSCRIPT_LAYOUT: TranscriptLayout = {
  episodeOpen: true, inspectorOpen: true, episodeWidth: 285, inspectorWidth: 290,
  inspectorTab: 'details', sections: { details: true, actions: true, tags: true }
};

const INSPECTOR_TABS: TranscriptInspectorTab[] = ['details', 'speakers', 'chapters', 'clips'];

const asBoolean = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);

const cloneDefaults = (): TranscriptLayout => ({
  ...DEFAULT_TRANSCRIPT_LAYOUT,
  sections: { ...DEFAULT_TRANSCRIPT_LAYOUT.sections },
});

/** Restores the approved layout, ignoring malformed or out-of-range persisted values. */
export function restoreTranscriptLayout(serialized: string | null): TranscriptLayout {
  if (!serialized) return cloneDefaults();
  try {
    const parsed: Partial<TranscriptLayout> = JSON.parse(serialized);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return cloneDefaults();
    return {
      ...DEFAULT_TRANSCRIPT_LAYOUT,
      episodeOpen: typeof parsed.episodeOpen === 'boolean' ? parsed.episodeOpen : true,
      inspectorOpen: typeof parsed.inspectorOpen === 'boolean' ? parsed.inspectorOpen : true,
      episodeWidth: clampPanelWidth(Number(parsed.episodeWidth) || 285, 220, 440),
      inspectorWidth: clampPanelWidth(Number(parsed.inspectorWidth) || 290, 240, 460),
      inspectorTab: INSPECTOR_TABS.includes(parsed.inspectorTab as TranscriptInspectorTab)
        ? parsed.inspectorTab as TranscriptInspectorTab
        : 'details',
      sections: {
        details: asBoolean(parsed.sections?.details, true),
        actions: asBoolean(parsed.sections?.actions, true),
        tags: asBoolean(parsed.sections?.tags, true),
      },
    };
  } catch {
    return cloneDefaults();
  }
}

/** Applies one of the five approved workspace presets without losing panel widths. */
export function layoutForPreset(preset: TranscriptLayoutPreset, previous: TranscriptLayout): TranscriptLayout {
  if (preset === 'full' || preset === 'compact') return { ...previous, episodeOpen: true, inspectorOpen: true };
  if (preset === 'no-episodes') return { ...previous, episodeOpen: false, inspectorOpen: true };
  if (preset === 'no-inspector') return { ...previous, episodeOpen: true, inspectorOpen: false };
  return { ...previous, episodeOpen: false, inspectorOpen: false };
}

function readStoredLayout(): TranscriptLayout {
  if (typeof window === 'undefined') return cloneDefaults();
  try { return restoreTranscriptLayout(localStorage.getItem(TRANSCRIPT_LAYOUT_KEY)); } catch { return cloneDefaults(); }
}

export function useTranscriptLayout() {
  const [layout, setLayout] = useState<TranscriptLayout>(readStoredLayout);
  useEffect(() => { try { localStorage.setItem(TRANSCRIPT_LAYOUT_KEY, JSON.stringify(layout)); } catch {} }, [layout]);
  const update = useCallback((patch: Partial<TranscriptLayout>) => setLayout(prev => ({ ...prev, ...patch })), []);
  const toggleSection = useCallback((key: SectionKey) => setLayout(prev => ({
    ...prev, sections: { ...prev.sections, [key]: !prev.sections[key] }
  })), []);
  const applyPreset = useCallback((preset: TranscriptLayoutPreset) => {
    setLayout(prev => layoutForPreset(preset, prev));
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('spacepipe:transcript-layout', { detail: { preset } }));
  }, []);
  const reset = useCallback(() => setLayout(cloneDefaults()), []);
  return { layout, update, toggleSection, applyPreset, reset };
}
