/** Persisted, validated presentation state for the approved Transcript Workbench. */
export const TRANSCRIPT_LAYOUT_KEY = 'spacepipe_transcripts_layout_v2';

export type LayoutPreset = 'full' | 'compact' | 'episodes-hidden' | 'inspector-hidden' | 'focus' | 'custom';
export type InspectorTab = 'details' | 'speakers' | 'chapters' | 'clips';
export type WorkspaceTab = 'transcript' | 'speakers' | 'timeline' | 'chapters' | 'analysis';

export interface TranscriptLayout {
  preset: LayoutPreset;
  episodesVisible: boolean;
  inspectorVisible: boolean;
  episodeWidth: number;
  inspectorWidth: number;
  inspectorTab: InspectorTab;
  sectionOpen: { details: boolean; actions: boolean; tags: boolean };
  showTimestamps: boolean;
}

export const DEFAULT_TRANSCRIPT_LAYOUT: TranscriptLayout = {
  preset: 'full',
  episodesVisible: true,
  inspectorVisible: true,
  episodeWidth: 296,
  inspectorWidth: 300,
  inspectorTab: 'details',
  sectionOpen: { details: true, actions: true, tags: true },
  showTimestamps: true,
};

export function clampPanelWidth(width: number, min = 220, max = 440): number {
  return Number.isFinite(width) ? Math.round(Math.max(min, Math.min(max, width))) : min;
}

export function layoutForPreset(
  preset: Exclude<LayoutPreset, 'custom'>,
  previous: TranscriptLayout = DEFAULT_TRANSCRIPT_LAYOUT,
): TranscriptLayout {
  return {
    ...previous,
    preset,
    episodesVisible: preset !== 'episodes-hidden' && preset !== 'focus',
    inspectorVisible: preset !== 'inspector-hidden' && preset !== 'focus',
    episodeWidth: preset === 'compact' ? 252 : (preset === 'full' ? 296 : previous.episodeWidth),
    inspectorWidth: preset === 'full' ? 300 : previous.inspectorWidth,
  };
}

export function restoreTranscriptLayout(serialized: string | null): TranscriptLayout {
  if (!serialized) return { ...DEFAULT_TRANSCRIPT_LAYOUT, sectionOpen: { ...DEFAULT_TRANSCRIPT_LAYOUT.sectionOpen } };
  try {
    const value = JSON.parse(serialized) as Partial<TranscriptLayout>;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid layout');
    const tabs: InspectorTab[] = ['details', 'speakers', 'chapters', 'clips'];
    const presets: LayoutPreset[] = ['full', 'compact', 'episodes-hidden', 'inspector-hidden', 'focus', 'custom'];
    return {
      preset: presets.includes(value.preset as LayoutPreset) ? value.preset! : 'custom',
      episodesVisible: typeof value.episodesVisible === 'boolean' ? value.episodesVisible : true,
      inspectorVisible: typeof value.inspectorVisible === 'boolean' ? value.inspectorVisible : true,
      episodeWidth: clampPanelWidth(value.episodeWidth ?? 296),
      inspectorWidth: clampPanelWidth(value.inspectorWidth ?? 300, 240, 440),
      inspectorTab: tabs.includes(value.inspectorTab as InspectorTab) ? value.inspectorTab! : 'details',
      sectionOpen: {
        details: typeof value.sectionOpen?.details === 'boolean' ? value.sectionOpen.details : true,
        actions: typeof value.sectionOpen?.actions === 'boolean' ? value.sectionOpen.actions : true,
        tags: typeof value.sectionOpen?.tags === 'boolean' ? value.sectionOpen.tags : true,
      },
      showTimestamps: typeof value.showTimestamps === 'boolean' ? value.showTimestamps : true,
    };
  } catch {
    return { ...DEFAULT_TRANSCRIPT_LAYOUT, sectionOpen: { ...DEFAULT_TRANSCRIPT_LAYOUT.sectionOpen } };
  }
}

export function normalizeTag(text: string): string {
  return text.trim().replace(/\s+/g, ' ').slice(0, 36);
}
