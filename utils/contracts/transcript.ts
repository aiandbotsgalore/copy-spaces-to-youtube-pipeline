import { z } from 'zod';

/**
 * Normalizes timestamps to float seconds.
 * Safeguards against legacy millisecond outputs from Whisper/Kaggle workers.
 */
export function normalizeTimestampToSeconds(val: unknown, referenceScale?: 1 | 1000): number {
  if (val === undefined || val === null || val === '') return 0;
  const num = typeof val === 'number' ? val : parseFloat(String(val).replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(num)) return 0;

  // Explicit scale passed in
  if (referenceScale === 1000) return num / 1000;
  if (referenceScale === 1) return num;

  // Automatic heuristic check: audio spaces rarely exceed 24 hours (86,400s).
  // If a single timestamp is > 100,000, it's virtually guaranteed to be in milliseconds.
  if (num > 86400) {
    return num / 1000;
  }
  return num;
}

export const TranscriptWordSchema = z.object({
  word: z.preprocess(v => String(v || '').trim(), z.string()),
  start: z.preprocess(v => normalizeTimestampToSeconds(v), z.number().nonnegative()),
  end: z.preprocess(v => normalizeTimestampToSeconds(v), z.number().nonnegative()),
  confidence: z.preprocess(v => (v !== undefined ? Number(v) : undefined), z.number().optional()),
  speaker: z.preprocess(v => (v ? String(v).trim() : undefined), z.string().optional()),
});

export type TranscriptWord = z.infer<typeof TranscriptWordSchema>;

export const TranscriptSegmentSchema = z.object({
  start: z.preprocess(v => normalizeTimestampToSeconds(v), z.number().nonnegative()),
  end: z.preprocess(v => normalizeTimestampToSeconds(v), z.number().nonnegative()),
  speaker: z.preprocess(v => String(v || '').trim() || 'Speaker', z.string()),
  text: z.preprocess(v => String(v || '').trim(), z.string()),
  words: z.array(TranscriptWordSchema).optional(),
});

export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

export const EpisodeSummarySchema = z.object({
  release_id: z.preprocess(v => Number(v) || 0, z.number()),
  release_tag: z.preprocess(v => String(v || '').trim(), z.string()),
  title: z.preprocess(v => String(v || '').trim() || 'Untitled Space', z.string()),
  published_at: z.preprocess(v => String(v || '').trim(), z.string()),
  episode_date: z.preprocess(v => (v ? String(v).trim() : undefined), z.string().optional()),
  audio_url: z.preprocess(v => String(v || '').trim(), z.string()),
  segment_count: z.preprocess(v => Number(v) || 0, z.number().nonnegative()),
  body: z.preprocess(v => (v ? String(v) : undefined), z.string().optional()),
  duration_sec: z.preprocess(v => (v !== undefined ? Number(v) : undefined), z.number().optional()),
  host_handle: z.preprocess(v => (v ? String(v).trim() : undefined), z.string().optional()),
  speakers: z.preprocess(v => (Array.isArray(v) ? v.map(String) : []), z.array(z.string())),
});

export type EpisodeSummary = z.infer<typeof EpisodeSummarySchema>;

export const EpisodeSummaryListSchema = z.array(EpisodeSummarySchema);

export function parseEpisodeSummaries(raw: unknown): EpisodeSummary[] {
  if (!Array.isArray(raw)) return [];
  const list: EpisodeSummary[] = [];
  for (const item of raw) {
    const res = EpisodeSummarySchema.safeParse(item);
    if (res.success) list.push(res.data);
  }
  return list;
}

export function parseTranscriptSegments(raw: unknown): TranscriptSegment[] {
  if (!Array.isArray(raw)) return [];
  const segments: TranscriptSegment[] = [];
  for (const item of raw) {
    const res = TranscriptSegmentSchema.safeParse(item);
    if (res.success) segments.push(res.data);
  }
  return segments;
}
