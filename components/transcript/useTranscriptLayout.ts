import { useCallback, useEffect, useState } from 'react';

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
const KEY = 'spacepipe:transcripts:approved-layout:v1';
const DEFAULT: TranscriptLayout = {
  episodeOpen: true, inspectorOpen: true, episodeWidth: 285, inspectorWidth: 290,
  inspectorTab: 'details', sections: { details: true, actions: true, tags: true }
};
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
function read(): TranscriptLayout {
  if (typeof window === 'undefined') return DEFAULT;
  try {
    const parsed: Partial<TranscriptLayout> = JSON.parse(localStorage.getItem(KEY) || '{}');
    return {
      ...DEFAULT, ...parsed,
      episodeOpen: typeof parsed.episodeOpen === 'boolean' ? parsed.episodeOpen : true,
      inspectorOpen: typeof parsed.inspectorOpen === 'boolean' ? parsed.inspectorOpen : true,
      episodeWidth: clamp(Number(parsed.episodeWidth) || 285, 220, 440),
      inspectorWidth: clamp(Number(parsed.inspectorWidth) || 290, 240, 460),
      inspectorTab: ['details', 'speakers', 'chapters', 'clips'].includes(parsed.inspectorTab || '') ? parsed.inspectorTab! : 'details',
      sections: { ...DEFAULT.sections, ...(parsed.sections || {}) }
    };
  } catch { return DEFAULT; }
}
export function useTranscriptLayout() {
  const [layout, setLayout] = useState<TranscriptLayout>(read);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(layout)); } catch {} }, [layout]);
  const update = useCallback((patch: Partial<TranscriptLayout>) => setLayout(prev => ({ ...prev, ...patch })), []);
  const toggleSection = useCallback((key: SectionKey) => setLayout(prev => ({
    ...prev, sections: { ...prev.sections, [key]: !prev.sections[key] }
  })), []);
  const applyPreset = useCallback((preset: TranscriptLayoutPreset) => {
    if (preset === 'full' || preset === 'compact') update({ episodeOpen: true, inspectorOpen: true });
    if (preset === 'no-episodes') update({ episodeOpen: false, inspectorOpen: true });
    if (preset === 'no-inspector') update({ episodeOpen: true, inspectorOpen: false });
    if (preset === 'minimal') update({ episodeOpen: false, inspectorOpen: false });
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('spacepipe:transcript-layout', { detail: { preset } }));
  }, [update]);
  const reset = useCallback(() => setLayout(DEFAULT), []);
  return { layout, update, toggleSection, applyPreset, reset };
}
