/**
 * Turns validated Director output into timeline clips. Pure apart from the injected trim dependencies.
 * The LLM only ever supplies clip ids, an excerpt (keptText), a gap, a tension score and a note;
 * every second on the timeline is computed here from real, probed windows.
 */
import type { ClipLike, DirectorCutResponse, DirectorCurrentItem, DirectorProvenance } from './directorTypes';
import { resolveTrim } from './trimResolver';
import type { TrimDeps } from './trimResolver';
import { resolveGap } from './sequencePlan';
import { truncateText } from './directorCandidates';

const label = (c: ClipLike) => c.quoteId || c.title || c.id;

/** Apply a resolved trim result to a clip, remembering the pre-trim window so "Reset trim" works. */
export async function applyTrimToClip<T extends ClipLike>(
  clip: T,
  keptText: string,
  deps: TrimDeps
): Promise<{ clip: T; note?: string }> {
  const r = await resolveTrim(clip, keptText, deps);
  if (r.ok === false) return { clip, note: `Kept ${label(clip)} whole: ${r.reason}` };
  if (r.noop) return { clip };
  return {
    clip: {
      ...clip,
      origStartSec: clip.origStartSec ?? clip.startSec,
      origEndSec: clip.origEndSec ?? clip.endSec,
      startSec: r.startSec,
      endSec: r.endSec,
      trimBasis: r.basis,
      keptText: r.keptText,
    },
  };
}

export async function cutToClips<T extends ClipLike>(
  cut: DirectorCutResponse,
  byId: Record<string, T>,
  provenance: DirectorProvenance,
  deps: TrimDeps
): Promise<{ clips: T[]; notes: string[] }> {
  const clips: T[] = [];
  const notes: string[] = [];
  for (const pick of cut.picks) {
    const base = byId[pick.clipId];
    if (!base) {
      notes.push(`Dropped unknown clip ${pick.clipId}.`);
      continue;
    }
    let clip: T = {
      ...base,
      gapAfterSec: pick.gapAfterSec,
      tensionScore: pick.tensionScore,
      directorNote: pick.note,
      director: provenance,
      locked: false,
    };
    if (pick.keptText) {
      const res = await applyTrimToClip(clip, pick.keptText, deps);
      clip = res.clip;
      if (res.note) notes.push(res.note);
    }
    clips.push(clip);
  }
  return { clips, notes };
}

/** Resolve the trims that applyOps() queued (it cannot await audio). Locked clips are never touched. */
export async function resolvePendingTrims<T extends ClipLike>(
  clips: T[],
  pending: { clipId: string; keptText: string }[],
  deps: TrimDeps
): Promise<{ clips: T[]; notes: string[] }> {
  const out = [...clips];
  const notes: string[] = [];
  for (const p of pending) {
    const i = out.findIndex(c => c.id === p.clipId);
    if (i < 0 || out[i].locked) continue;
    const res = await applyTrimToClip(out[i], p.keptText, deps);
    out[i] = res.clip;
    if (res.note) notes.push(res.note);
  }
  return { clips: out, notes };
}

/** The timeline as the LLM sees it during refinement. */
export function toCurrentItems(clips: ClipLike[], defaultGapSec: number): DirectorCurrentItem[] {
  return clips.map((c, index) => {
    const { text, truncated } = truncateText(c.quote || c.title || '');
    return {
      index,
      clipId: c.id,
      text,
      textTruncated: truncated || undefined,
      startSec: Math.round(c.startSec * 100) / 100,
      endSec: Math.round(c.endSec * 100) / 100,
      durationSec: Math.round((c.endSec - c.startSec) * 10) / 10,
      gapAfterSec: resolveGap(c, defaultGapSec),
      tensionScore: c.tensionScore,
      note: c.directorNote,
      locked: !!c.locked,
    };
  });
}

/** Short stable hash for provenance (not security-relevant). */
export function hashPrompt(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
