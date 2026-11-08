/**
 * Single source of truth for timeline math.
 * Used by: Studio runtime/gauge, sequence player, WAV export, Audacity labels, TensionArc, validators.
 */

export const MIN_CLIP_SEC = 0.2;
export const MAX_GAP_SEC = 5;

export interface PlanClip {
  startSec: number;
  endSec: number;
  gapAfterSec?: number;
  audioUrl?: string;
}

export interface PlanItem<T extends PlanClip> {
  index: number;
  clip: T;
  effStart: number;
  effEnd: number;
  effDur: number;
  /** Silence inserted after this clip. 0 for the last clip. */
  gapAfter: number;
  timelineStart: number;
  timelineEnd: number;
}

export interface SequencePlan<T extends PlanClip> {
  items: PlanItem<T>[];
  /** clips + gaps */
  totalSec: number;
  clipsSec: number;
  gapsSec: number;
}

export function effectiveWindow(c: PlanClip): { start: number; end: number; dur: number } {
  const start = Math.max(0, Number.isFinite(c.startSec) ? c.startSec : 0);
  const rawEnd = Number.isFinite(c.endSec) ? c.endSec : start + MIN_CLIP_SEC;
  const end = Math.max(rawEnd, start + MIN_CLIP_SEC);
  return { start, end, dur: end - start };
}

export function resolveGap(clip: PlanClip, defaultGapSec: number): number {
  const g = clip.gapAfterSec ?? defaultGapSec;
  if (!Number.isFinite(g)) return 0;
  return Math.min(MAX_GAP_SEC, Math.max(0, g));
}

export function buildSequencePlan<T extends PlanClip>(clips: T[], defaultGapSec: number): SequencePlan<T> {
  const items: PlanItem<T>[] = [];
  let cursor = 0;
  let clipsSec = 0;
  let gapsSec = 0;
  clips.forEach((clip, index) => {
    const w = effectiveWindow(clip);
    const isLast = index === clips.length - 1;
    const gapAfter = isLast ? 0 : resolveGap(clip, defaultGapSec);
    const timelineStart = cursor;
    const timelineEnd = cursor + w.dur;
    items.push({ index, clip, effStart: w.start, effEnd: w.end, effDur: w.dur, gapAfter, timelineStart, timelineEnd });
    cursor = timelineEnd + gapAfter;
    clipsSec += w.dur;
    gapsSec += gapAfter;
  });
  return { items, totalSec: clipsSec + gapsSec, clipsSec, gapsSec };
}

export const isPlayable = (c: { audioUrl?: string }): boolean => !!c.audioUrl;

/**
 * Plan over only the clips that can actually be rendered, remembering each one's index in the full
 * timeline. Export/labels/audition all use this so gaps and label times match what is heard.
 */
export function buildPlayablePlan<T extends PlanClip>(
  clips: T[],
  defaultGapSec: number
): { plan: SequencePlan<T>; sourceIndex: number[] } {
  const sourceIndex: number[] = [];
  const playable: T[] = [];
  clips.forEach((c, i) => {
    if (isPlayable(c)) {
      playable.push(c);
      sourceIndex.push(i);
    }
  });
  return { plan: buildSequencePlan(playable, defaultGapSec), sourceIndex };
}

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export interface TensionScoredClip extends PlanClip {
  id: string;
  tensionScore?: number;
  severity?: number;
  quote?: string;
  speaker?: string;
}

/**
 * Arranges clips into a cinematic 4-Beat narrative tension arc:
 * Beat 1: The Hook (Initial high impact statement, tension 8-10)
 * Beat 2: The Context (Exposition / build-up, tension 4-6)
 * Beat 3: The Climax (Peak emotional intensity / rants, tension 9-10)
 * Beat 4: The Mic-Drop (Falling action / punchline outro, tension 6-7)
 */
export function sequenceBy4BeatTensionArc<T extends TensionScoredClip>(clips: T[]): T[] {
  if (clips.length <= 2) return [...clips];

  const getScore = (c: T): number => {
    if (typeof c.tensionScore === 'number') return c.tensionScore;
    if (typeof c.severity === 'number') return c.severity;
    return 5;
  };

  const pool = [...clips];
  pool.sort((a, b) => getScore(b) - getScore(a));

  const result: T[] = [];
  const used = new Set<string>();

  // 1. Climax is the absolute peak tension in the pool
  const climax = pool[0];
  used.add(climax.id);

  // 2. Hook is the opening grabber (high tension, distinct from climax)
  const hook = pool.find(c => !used.has(c.id) && getScore(c) >= 7.5) || pool.find(c => !used.has(c.id)) || climax;
  used.add(hook.id);
  result.push(hook);

  // 3. Outro is the closing resolution/punchline
  const outro = pool.find(c => !used.has(c.id) && getScore(c) >= 5 && getScore(c) <= 7.5) || pool.find(c => !used.has(c.id));
  if (outro) used.add(outro.id);

  // 4. Context / Build-up clips sorted ascending to escalate toward the climax
  const contextClips = pool.filter(c => !used.has(c.id));
  contextClips.sort((a, b) => getScore(a) - getScore(b));
  for (const c of contextClips) {
    result.push(c);
  }

  // Insert Climax before Outro
  if (climax.id !== hook.id) {
    result.push(climax);
  }

  // Insert Outro last
  if (outro && outro.id !== hook.id && outro.id !== climax.id) {
    result.push(outro);
  }

  return result;
}
