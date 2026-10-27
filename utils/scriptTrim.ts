/**
 * Clip-relative trimming for Script Studio: wraps resolveTrim so a clip's window is always 0..durationSec.
 * Segment boundaries come from the clip's own episode transcript (mapped to clip-relative time) when its
 * episode start is known; otherwise the trim is proportional and marked 'estimated'.
 */
import { resolveTrim, type TrimDeps } from './trimResolver';
import type { ClipLike } from './directorTypes';
import type { StudioClip } from './scriptTypes';
import type { TranscriptSeg, TrimFn } from './scriptGates';

export function clipBoundariesFromTranscript(clip: StudioClip, segments: TranscriptSeg[] | undefined): number[] | null {
  if (!segments || clip.episodeStartSec == null) return null;
  const s0 = clip.episodeStartSec;
  const s1 = s0 + clip.durationSec;
  const out = new Set<number>();
  for (const s of segments) {
    for (const t of [s.start, s.end]) if (t > s0 && t < s1) out.add(Math.round((t - s0) * 100) / 100);
  }
  return out.size ? [...out].sort((a, b) => a - b) : null;
}

export function makeClipTrim(getSegments: (releaseTag: string) => TranscriptSeg[] | undefined, extra: Pick<TrimDeps, 'getChannel'> = {}): TrimFn {
  return async (clip, keptText) => {
    const like: ClipLike = {
      id: clip.clipId, quote: clip.text, speaker: clip.speaker, audioUrl: clip.audioUrl,
      startSec: 0, endSec: clip.durationSec, origStartSec: 0, origEndSec: clip.durationSec,
    } as ClipLike;
    const boundaries = clipBoundariesFromTranscript(clip, getSegments(clip.releaseTag));
    const r = await resolveTrim(like, keptText, { getSegmentBoundaries: async () => boundaries, ...extra });
    if (r.ok === false) return r;
    return { ok: true, inSec: r.startSec, outSec: r.endSec, basis: r.noop ? 'full' : r.basis };
  };
}
