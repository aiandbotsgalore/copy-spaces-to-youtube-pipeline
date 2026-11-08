import type { ClipItem } from './contracts/clipCatalog';

export interface ClipMetadataSegment {
  start?: unknown;
  end?: unknown;
  speaker?: unknown;
  text?: unknown;
}

const PLACEHOLDER_REASON = /^(?:AI selected highlight moment from\s+|.+ is a \d+-second highlight beginning at \d+:\d+\.)/i;
const PLACEHOLDER_SNIPPET = /^Highlight moment from\s+/i;

export function hasPlaceholderClipMetadata(clip: Pick<ClipItem, 'reason' | 'transcript_snippet'>): boolean {
  return PLACEHOLDER_REASON.test(String(clip.reason || '').trim())
    || PLACEHOLDER_SNIPPET.test(String(clip.transcript_snippet || '').trim());
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatSeconds(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function clipQuote(clip: Pick<ClipItem, 'start_seconds' | 'end_seconds' | 'duration'>, segments: ClipMetadataSegment[]): string {
  const start = finiteNumber(clip.start_seconds) ?? 0;
  const duration = finiteNumber(clip.duration) ?? 60;
  const endValue = finiteNumber(clip.end_seconds);
  const end = endValue !== null && endValue > start ? endValue : start + duration;

  const usable = (segments || [])
    .map((segment, index) => {
      const segmentStart = finiteNumber(segment.start);
      if (segmentStart === null) return null;
      const segmentEnd = finiteNumber(segment.end) ?? segmentStart;
      const text = String(segment.text ?? '').replace(/\s+/g, ' ').trim();
      if (!text) return null;
      return {
        index,
        start: segmentStart,
        end: Math.max(segmentStart, segmentEnd),
        speaker: String(segment.speaker ?? '').trim(),
        text,
      };
    })
    .filter((segment): segment is { index: number; start: number; end: number; speaker: string; text: string } => Boolean(segment));

  let selected = usable.filter(segment => segment.start < end && segment.end >= start);
  if (!selected.length) {
    selected = usable
      .filter(segment => segment.start >= start - 10 && segment.start <= end + 10)
      .slice(0, 8);
  }
  if (!selected.length && usable.length) {
    const nearest = usable.reduce((best, segment) =>
      Math.abs(segment.start - start) < Math.abs(best.start - start) ? segment : best
    );
    // Do not attach an unrelated line from a very short or mismatched source
    // episode to a clip that sits minutes away from it.
    if (Math.abs(nearest.start - start) <= 30) selected = [nearest];
  }

  const lines: string[] = [];
  let length = 0;
  for (const segment of selected.sort((a, b) => a.start - b.start)) {
    const prefix = segment.speaker ? `${segment.speaker}: ` : '';
    const remaining = 360 - length - (lines.length ? 1 : 0);
    if (remaining <= prefix.length + 12) break;
    const text = segment.text.length > remaining - prefix.length
      ? `${segment.text.slice(0, Math.max(0, remaining - prefix.length - 1)).trimEnd()}…`
      : segment.text;
    lines.push(`${prefix}${text}`);
    length += lines[lines.length - 1].length + (lines.length > 1 ? 1 : 0);
    if (length >= 350) break;
  }
  return lines.join(' ');
}

/**
 * Replaces the old release-title placeholder with metadata grounded in the clip
 * title and the transcript turns that overlap the clip's time window.
 */
export function enrichPlaceholderClipMetadata(
  clip: ClipItem,
  segments: ClipMetadataSegment[] = [],
): ClipItem {
  if (!hasPlaceholderClipMetadata(clip)) return clip;

  const title = String(clip.title || 'Untitled moment').trim() || 'Untitled moment';
  const start = finiteNumber(clip.start_seconds) ?? 0;
  const end = finiteNumber(clip.end_seconds);
  const duration = finiteNumber(clip.duration) ?? (end !== null && end > start ? end - start : 60);
  const quote = clipQuote(clip, segments);

  return {
    ...clip,
    reason: quote
      ? `${title} captures a ${Math.round(duration)}-second exchange: ${quote}`
      : `${title} is a ${Math.round(duration)}-second highlight beginning at ${formatSeconds(start)}.`,
    transcript_snippet: quote || `${title} (${formatSeconds(start)}–${formatSeconds(start + duration)})`,
  };
}

export function enrichPlaceholderClips(
  clips: ClipItem[],
  segmentsByReleaseTag: Map<string, ClipMetadataSegment[]>,
  releaseTagForClip: (clip: ClipItem) => string,
): ClipItem[] {
  return clips.map(clip => enrichPlaceholderClipMetadata(clip, segmentsByReleaseTag.get(releaseTagForClip(clip)) || []));
}
