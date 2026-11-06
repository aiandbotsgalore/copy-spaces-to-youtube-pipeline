/**
 * Detects and repairs clip records whose reason/quote fields are still placeholders
 * (often the release title, or a "Highlight moment from <release>" stub from live scans).
 * When transcript segments are available, replaces those stubs with turns in the clip window.
 */

import type { ClipItem } from './contracts/clipCatalog';
import type { SearchIndexSegment } from './transcriptData';

const norm = (s: unknown) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const looksLikeReleaseTitle = (value: string, episode?: string): boolean => {
  const v = norm(value);
  if (!v) return true;
  const ep = norm(episode);
  if (ep && (v === ep || v.includes(ep) || ep.includes(v))) return true;
  // Live-scan stubs and near-empty filler.
  if (/^(ai selected )?highlight moment from /.test(v)) return true;
  if (/^(n\/?a|none|unknown|placeholder|tbd)$/.test(v)) return true;
  return false;
};

/** True when reason and/or transcript_snippet still look like release-title placeholders. */
export function hasPlaceholderClipMetadata(clip: ClipItem): boolean {
  const reason = String(clip.reason ?? '').trim();
  const snippet = String(clip.transcript_snippet ?? '').trim();
  return looksLikeReleaseTitle(reason, clip.episode) || looksLikeReleaseTitle(snippet, clip.episode);
}

function titleFallback(clip: ClipItem): { reason: string; transcript_snippet: string } {
  const title = String(clip.title ?? '').trim() || 'Untitled Moment';
  return {
    reason: `Highlight: ${title}`,
    transcript_snippet: title,
  };
}

function quoteFromSegments(
  clip: ClipItem,
  segments: SearchIndexSegment[],
): { reason: string; transcript_snippet: string; speakers?: string[] } | null {
  if (!segments.length) return null;
  const start = Number(clip.start_seconds) || 0;
  const endRaw = Number(clip.end_seconds);
  const end =
    Number.isFinite(endRaw) && endRaw > start
      ? endRaw
      : start + (Number(clip.duration) > 0 ? Number(clip.duration) : 60);

  const inWindow = segments.filter(seg => {
    const s = Number(seg.start);
    const e = seg.end == null ? s : Number(seg.end);
    if (!Number.isFinite(s)) return false;
    const segEnd = Number.isFinite(e) ? e : s;
    return segEnd >= start && s <= end;
  });
  if (!inWindow.length) return null;

  const lines = inWindow
    .map(seg => {
      const speaker = String(seg.speaker || '').trim();
      const text = String(seg.text || '').trim();
      if (!text) return '';
      return speaker ? `${speaker}: ${text}` : text;
    })
    .filter(Boolean);

  if (!lines.length) return null;

  const transcript_snippet = lines.join(' ').slice(0, 480);
  const title = String(clip.title ?? '').trim();
  const reason = title
    ? `From the transcript around "${title}"`
    : 'Grounded from transcript turns in this clip window';

  const speakers = Array.from(
    new Set(
      inWindow
        .map(seg => String(seg.speaker || '').trim())
        .filter(name => name && !/^(speaker|spk|unknown)(\s*\d+)?$/i.test(name)),
    ),
  );

  return {
    reason,
    transcript_snippet,
    ...(speakers.length ? { speakers } : {}),
  };
}

/**
 * Replace placeholder reason/quote fields. With no segments, grounds them on the clip title.
 * With segments, prefers dialogue from the clip's time window.
 */
export function enrichPlaceholderClipMetadata(
  clip: ClipItem,
  segments?: SearchIndexSegment[],
): ClipItem {
  if (!hasPlaceholderClipMetadata(clip)) return clip;

  const fromTranscript = segments?.length ? quoteFromSegments(clip, segments) : null;
  const fallback = titleFallback(clip);
  const next = fromTranscript ?? fallback;

  return {
    ...clip,
    reason: next.reason,
    transcript_snippet: next.transcript_snippet,
    ...(fromTranscript?.speakers?.length && (!clip.speakers || !clip.speakers.length)
      ? { speakers: fromTranscript.speakers }
      : {}),
  };
}
