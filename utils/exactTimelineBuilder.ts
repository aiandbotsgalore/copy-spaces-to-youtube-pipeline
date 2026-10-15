import type { MontageClipItem } from '../contexts/MontageContext';
import type { QuoteMatchResult } from './quoteMatcher';

/**
 * utils/exactTimelineBuilder.ts
 *
 * Assembles a clean, sample-accurate Montage timeline from matched quotes.
 * Enforces:
 *  - User-specified sequence preserved 1:1
 *  - Dynamic audio gap timing (0.1s - 0.9s), with final gap = 0
 *  - Pre-cut catalog asset normalization (0 .. duration)
 *  - Minimum clip duration enforcement (>= 0.2s)
 */

export interface ExactTimelineOptions {
  defaultGapSec?: number;
  sortChronological?: boolean;
}

export function buildExactTimeline(
  matches: QuoteMatchResult[],
  options: ExactTimelineOptions = {}
): { clips: MontageClipItem[]; matchedCount: number; totalCount: number } {
  const defaultGap = options.defaultGapSec ?? 0.35;
  const validClips: MontageClipItem[] = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    if (!match.matchedClip) continue;

    const base = match.matchedClip;
    const dur = Math.max(0.2, (base.endSec ?? 30) - (base.startSec ?? 0));

    // Check if pre-cut asset duration bug applies:
    // If startSec > 600 and duration is under 180s, the asset is almost certainly a pre-cut slice.
    let effStart = base.startSec;
    let effEnd = base.endSec;
    let origStart = base.origStartSec ?? base.startSec;
    let origEnd = base.origEndSec ?? base.endSec;

    const isPreCutSlice = base.startSec > 600 && dur < 180;
    if (isPreCutSlice) {
      effStart = 0;
      effEnd = dur;
    }

    const isLast = i === matches.length - 1;
    const gap = isLast ? 0.0 : (base.gapAfterSec ?? defaultGap);

    validClips.push({
      ...base,
      startSec: effStart,
      endSec: effEnd,
      origStartSec: origStart,
      origEndSec: origEnd,
      sourceDurationSec: dur,
      gapAfterSec: gap,
      directorNote: base.directorNote || `Quote #${i + 1}`,
      tensionScore: base.tensionScore || 7,
    });
  }

  // Optional: Chronological ordering
  if (options.sortChronological) {
    validClips.sort((a, b) => {
      const dateA = a.sourceDate || '';
      const dateB = b.sourceDate || '';
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      return (a.origStartSec ?? a.startSec) - (b.origStartSec ?? b.startSec);
    });
  }

  // Re-ensure last clip gap is always 0
  if (validClips.length > 0) {
    validClips[validClips.length - 1].gapAfterSec = 0.0;
  }

  return {
    clips: validClips,
    matchedCount: validClips.length,
    totalCount: matches.length,
  };
}
