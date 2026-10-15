/**
 * Resolves an LLM "keptText" excerpt into real start/end seconds.
 * The LLM never supplies timestamps (transcripts are segment-level; it cannot know word boundaries).
 *   1. locate the excerpt in the transcript (rejects anything that is not a contiguous excerpt)
 *   2. estimate times proportionally within the ORIGINAL window
 *   3. snap to a transcript segment boundary, else to the nearest real silence in the audio
 *   4. clamp: never extend, keep >= 1.5 s, remove at most 35% automatically
 */
import type { ClipLike } from './directorTypes';
import { findExcerpt } from './directorValidate';
import { MAX_AUTO_TRIM_FRACTION, MIN_EFFECTIVE_AFTER_TRIM_SEC } from './directorProfile';

export interface ChannelData {
  data: Float32Array;
  sampleRate: number;
}

export interface TrimDeps {
  getChannel?: (url: string) => Promise<ChannelData | null>;
  /** Boundaries (seconds, in the same coordinates as clip.startSec/endSec) of transcript segments. */
  getSegmentBoundaries?: (clip: ClipLike) => Promise<number[] | null>;
}

export type TrimResult =
  | { ok: true; startSec: number; endSec: number; basis: 'segment' | 'silence' | 'estimated'; keptText: string; noop: boolean }
  | { ok: false; reason: string };

const r2 = (n: number) => Math.round(n * 100) / 100;

export function snapToBoundary(boundaries: number[], t: number, radius = 0.6): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  for (const b of boundaries) {
    const d = Math.abs(b - t);
    if (d <= radius && d < bestD) {
      best = b;
      bestD = d;
    }
  }
  return best;
}

/**
 * Find the centre of the silent stretch (>= 80 ms, well below speech level) nearest to `targetSec`
 * within +/- `radiusSec`. Returns null when the window contains no real silence.
 */
export function snapToSilence(data: Float32Array, sampleRate: number, targetSec: number, radiusSec = 0.35): number | null {
  const frame = Math.max(1, Math.round(sampleRate * 0.01));
  const totalFrames = Math.floor(data.length / frame);
  if (totalFrames < 10) return null;

  // Global speech level over the entire clip.
  let sumSq = 0;
  for (let i = 0; i < data.length; i++) sumSq += data[i] * data[i];
  const globalRms = Math.sqrt(sumSq / Math.max(1, data.length));
  if (globalRms < 1e-5) return null;

  const first = Math.max(0, Math.floor(((targetSec - radiusSec) * sampleRate) / frame));
  const last = Math.min(totalFrames - 1, Math.ceil(((targetSec + radiusSec) * sampleRate) / frame));
  if (last - first < 8) return null;

  const rms: number[] = [];
  for (let f = first; f <= last; f++) {
    let s = 0;
    const base = f * frame;
    for (let i = 0; i < frame; i++) {
      const v = data[base + i];
      s += v * v;
    }
    rms.push(Math.sqrt(s / frame));
  }
  const sorted = [...rms].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)];
  const threshold = Math.min(floor * 2 + 1e-4, globalRms * 0.25);
  if (floor > threshold) return null;

  const targetFrame = (targetSec * sampleRate) / frame;
  let bestCenter: number | null = null;
  let bestDist = Infinity;
  let runStart = -1;
  const considerRun = (startIdx: number, endIdx: number) => {
    if (endIdx - startIdx + 1 < 8) return;
    const center = first + (startIdx + endIdx + 1) / 2;
    const dist = Math.abs(center - targetFrame);
    if (dist < bestDist) {
      bestDist = dist;
      bestCenter = center;
    }
  };
  for (let i = 0; i < rms.length; i++) {
    if (rms[i] <= threshold) {
      if (runStart < 0) runStart = i;
    } else if (runStart >= 0) {
      considerRun(runStart, i - 1);
      runStart = -1;
    }
  }
  if (runStart >= 0) considerRun(runStart, rms.length - 1);
  return bestCenter === null ? null : (bestCenter * frame) / sampleRate;
}

export async function resolveTrim(clip: ClipLike, keptText: string, deps: TrimDeps = {}): Promise<TrimResult> {
  const ws = clip.origStartSec ?? clip.startSec;
  const we = clip.origEndSec ?? clip.endSec;
  const dur = we - ws;
  if (!(dur > 0)) return { ok: false, reason: 'Clip has no valid original window.' };

  const ex = findExcerpt(clip.quote || '', keptText);
  if (!ex) return { ok: false, reason: 'Excerpt is not a contiguous part of the transcript.' };

  const fa = ex.start / ex.length;
  const fb = ex.end / ex.length;
  const trimStart = fa > 0.01;
  const trimEnd = fb < 0.99;
  if (!trimStart && !trimEnd) {
    return { ok: true, startSec: r2(ws), endSec: r2(we), basis: 'estimated', keptText, noop: true };
  }

  let newStart = trimStart ? ws + dur * fa : ws;
  let newEnd = trimEnd ? ws + dur * fb : we;
  let basis: 'segment' | 'silence' | 'estimated' = 'estimated';

  const boundaries = deps.getSegmentBoundaries ? await deps.getSegmentBoundaries(clip) : null;
  if (boundaries && boundaries.length) {
    let snapped = false;
    if (trimStart) {
      const s = snapToBoundary(boundaries, newStart);
      if (s !== null) {
        newStart = s;
        snapped = true;
      }
    }
    if (trimEnd) {
      const e = snapToBoundary(boundaries, newEnd);
      if (e !== null) {
        newEnd = e;
        snapped = true;
      }
    }
    if (snapped) basis = 'segment';
  } else if (deps.getChannel && clip.audioUrl) {
    const ch = await deps.getChannel(clip.audioUrl);
    if (ch) {
      let snapped = false;
      if (trimStart) {
        const s = snapToSilence(ch.data, ch.sampleRate, newStart);
        if (s !== null) {
          newStart = s;
          snapped = true;
        }
      }
      if (trimEnd) {
        const e = snapToSilence(ch.data, ch.sampleRate, newEnd);
        if (e !== null) {
          newEnd = e;
          snapped = true;
        }
      }
      if (snapped) basis = 'silence';
    }
  }

  newStart = Math.max(ws, newStart);
  newEnd = Math.min(we, newEnd);
  const eff = newEnd - newStart;
  if (eff < MIN_EFFECTIVE_AFTER_TRIM_SEC) {
    return { ok: false, reason: `Trim would leave only ${eff.toFixed(1)}s (minimum ${MIN_EFFECTIVE_AFTER_TRIM_SEC}s).` };
  }
  const removed = 1 - eff / dur;
  if (removed > MAX_AUTO_TRIM_FRACTION + 1e-9) {
    return { ok: false, reason: `Trim would remove ${(removed * 100).toFixed(0)}% of the clip (automatic limit ${MAX_AUTO_TRIM_FRACTION * 100}%).` };
  }
  return { ok: true, startSec: r2(newStart), endSec: r2(newEnd), basis, keptText, noop: false };
}
