/**
 * Compiles a Script Studio version into Montage Studio timeline items (step 17) and the render manifest
 * (step 18). Pure: no audio is decoded here.
 *
 *  - clip blocks   -> startSec = inSec, endSec = outSec (clip-relative) on the clip's own file. A transcript cut
 *                     lives inside the full recording; with `clipAudioUrl` it plays from a server-side cut of
 *                     just that window (clip time 0 = start of the file), otherwise from the recording at
 *                     offset + inSec. The manifest keeps the recording URL and episode times as provenance.
 *  - narration     -> the block's Vox take as an item (0 to the take's probed duration)
 *  - pause blocks  -> gapAfterSec of the item before them (pauses in a row add up)
 *  - music blocks  -> labeled markers only, listed with their position; nothing is mixed or sourced
 *
 * An item without audio (narration with no current take, a clip with no audio file) blocks the compile,
 * with the block named.
 */
import type { MontageClipItem } from '../contexts/MontageContext';
import { hasValidTake } from './scriptAudio';
import type { Block, MusicCue, ScriptProject, ScriptVersion, StudioClip } from './scriptTypes';

export interface MusicMarker { blockId: string; cue: MusicCue; note: string; beforeItem: number; segmentTitle: string; sceneTitle: string }
export interface CompileBlocked { blockId: string; sceneTitle: string; reason: string }
export interface CompiledItem {
  item: MontageClipItem; blockId: string; kind: 'clip' | 'narration'; clipId?: string; text: string; segmentTitle: string; sceneTitle: string;
  /** The original audio and window (episode times for a transcript cut). */
  source: { url: string; startSec: number; endSec: number };
}

export interface CompileResult {
  ok: boolean;
  items: CompiledItem[];
  markers: MusicMarker[];
  blocked: CompileBlocked[];
  /** Pause seconds before the first item; a Montage timeline has no lead-in, so they are not applied. */
  leadingPauseSec: number;
}

export const NARRATOR_LABEL = 'Logan (narration, Vox)';

export function compileScript(project: ScriptProject, version: ScriptVersion, opts: { clipAudioUrl?: (clipId: string) => string } = {}): CompileResult {
  const clips = new Map<string, StudioClip>(project.clips.map(c => [c.clipId, c]));
  const items: CompiledItem[] = [];
  const markers: MusicMarker[] = [];
  const blocked: CompileBlocked[] = [];
  let leadingPauseSec = 0;

  for (const seg of version.segments) for (const sc of seg.scenes) for (const b of sc.blocks as Block[]) {
    if (b.kind === 'pause') {
      const last = items[items.length - 1];
      if (last) last.item.gapAfterSec = Math.round(((last.item.gapAfterSec || 0) + Math.max(0, b.sec)) * 1000) / 1000;
      else leadingPauseSec += Math.max(0, b.sec);
      continue;
    }
    if (b.kind === 'music') {
      markers.push({ blockId: b.id, cue: b.cue, note: b.note, beforeItem: items.length, segmentTitle: seg.title, sceneTitle: sc.title });
      continue;
    }
    if (b.kind === 'narration') {
      if (!b.text.trim()) continue;
      if (!hasValidTake(b)) {
        blocked.push({ blockId: b.id, sceneTitle: sc.title, reason: b.takeUrl ? 'Its Vox take is for older wording; preview the audio again.' : 'No Vox take yet; preview the audio first.' });
        continue;
      }
      items.push({
        blockId: b.id, kind: 'narration', text: b.text, segmentTitle: seg.title, sceneTitle: sc.title, source: { url: b.takeUrl, startSec: 0, endSec: b.takeSec },
        item: {
          id: `ss_${b.id}`, title: `Narration: ${b.text.slice(0, 60)}`, quote: b.text, speaker: NARRATOR_LABEL,
          sourceTitle: project.title, audioUrl: b.takeUrl, startSec: 0, endSec: b.takeSec, origStartSec: 0, origEndSec: b.takeSec,
          sourceDurationSec: b.takeSec, windowVerified: true, gapAfterSec: 0, category: 'narration',
          directorNote: `Script Studio: ${sc.title}`,
        },
      });
      continue;
    }
    const clip = clips.get(b.clipId);
    if (!clip) { blocked.push({ blockId: b.id, sceneTitle: sc.title, reason: `Clip ${b.clipId} is no longer in the project.` }); continue; }
    if (!clip.audioUrl) { blocked.push({ blockId: b.id, sceneTitle: sc.title, reason: `Clip "${clip.title}" has no audio file.` }); continue; }
    if (!(b.inSec >= 0 && b.outSec > b.inSec && b.outSec <= clip.durationSec + 1e-6)) {
      blocked.push({ blockId: b.id, sceneTitle: sc.title, reason: `Clip "${clip.title}": ${b.inSec}s to ${b.outSec}s is outside 0 to ${clip.durationSec}s.` });
      continue;
    }
    const off = clip.audioOffsetSec || 0;
    const cut = off > 0 && opts.clipAudioUrl ? opts.clipAudioUrl(clip.clipId) : null;
    const base = cut ? 0 : off;
    items.push({
      blockId: b.id, kind: 'clip', clipId: clip.clipId, text: b.keptText, segmentTitle: seg.title, sceneTitle: sc.title,
      source: { url: clip.audioUrl, startSec: off + b.inSec, endSec: off + b.outSec },
      item: {
        id: `ss_${b.id}`, title: clip.title, quote: b.keptText, speaker: clip.speaker, sourceTitle: project.title,
        sourceTag: clip.releaseTag, audioUrl: cut || clip.audioUrl, startSec: base + b.inSec, endSec: base + b.outSec,
        origStartSec: base, origEndSec: base + clip.durationSec,
        sourceDurationSec: base === 0 ? clip.durationSec : undefined, windowVerified: true, gapAfterSec: 0,
        trimBasis: b.trimBasis === 'full' ? undefined : b.trimBasis, keptText: b.keptText, category: b.fn,
        episodeStartSec: clip.episodeStartSec, directorNote: `Script Studio: ${sc.title}`,
      },
    });
  }
  return { ok: blocked.length === 0 && items.length > 0, items, markers, blocked, leadingPauseSec };
}

/* ------------------------------------------------------------------------------------------------ */
/* Render manifest                                                                                   */
/* ------------------------------------------------------------------------------------------------ */

export const RENDER_SETTINGS = { targetLufs: -16, peakDb: -1, fadeMs: 18 } as const;

export interface RenderManifest {
  kind: 'spacepipe-script-render';
  projectId: string; versionId: string; projectTitle: string; format: string | null; createdAt: number;
  settings: typeof RENDER_SETTINGS;
  /** Measured on the rendered audio: BS.1770 integrated loudness and the highest sample. */
  measured: { integratedLufs: number; samplePeakDb: number } | null;
  totalSec: number;
  items: {
    position: number; blockId: string; kind: 'clip' | 'narration'; clipId?: string; speaker: string; text: string;
    audioUrl: string; sourceStartSec: number; sourceEndSec: number; originalAudioUrl: string; originalStartSec: number; originalEndSec: number;
    timelineStartSec: number; timelineEndSec: number; gapAfterSec: number; segmentTitle: string; sceneTitle: string;
  }[];
  musicMarkers: { blockId: string; cue: MusicCue; note: string; timelineSec: number; segmentTitle: string; sceneTitle: string }[];
  note: string;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Timeline positions from the compiled items. `renderedSec[i]`, when given, is the length actually
 * rendered for item i (a slice can come out a few ms shorter than planned at a file's end).
 */
export function buildManifest(project: ScriptProject, version: ScriptVersion, compiled: CompileResult, createdAt: number, renderedSec?: number[], measured?: RenderManifest['measured']): RenderManifest {
  let t = 0;
  const starts: number[] = [];
  const items = compiled.items.map((ci, i) => {
    const len = renderedSec?.[i] ?? (ci.item.endSec - ci.item.startSec);
    const start = t;
    starts.push(start);
    const gap = i < compiled.items.length - 1 ? ci.item.gapAfterSec || 0 : 0;
    t = start + len + gap;
    return {
      position: i + 1, blockId: ci.blockId, kind: ci.kind, clipId: ci.clipId, speaker: ci.item.speaker, text: ci.text,
      audioUrl: ci.item.audioUrl || '', sourceStartSec: r3(ci.item.startSec), sourceEndSec: r3(ci.item.endSec),
      originalAudioUrl: ci.source.url, originalStartSec: r3(ci.source.startSec), originalEndSec: r3(ci.source.endSec),
      timelineStartSec: r3(start), timelineEndSec: r3(start + len), gapAfterSec: r3(gap), segmentTitle: ci.segmentTitle, sceneTitle: ci.sceneTitle,
    };
  });
  return {
    kind: 'spacepipe-script-render', projectId: project.id, versionId: version.id, projectTitle: project.title, format: project.format,
    createdAt, settings: RENDER_SETTINGS, measured: measured ?? null, totalSec: r3(t), items,
    musicMarkers: compiled.markers.map(m => ({ blockId: m.blockId, cue: m.cue, note: m.note, timelineSec: r3(m.beforeItem < starts.length ? starts[m.beforeItem] : t), segmentTitle: m.segmentTitle, sceneTitle: m.sceneTitle })),
    note: 'Music markers are positions only. Nothing was mixed in; music is handled outside the app.',
  };
}
