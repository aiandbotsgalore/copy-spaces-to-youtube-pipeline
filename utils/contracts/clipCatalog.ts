import { z } from 'zod';
import { toPosixPath } from '../posixUtils';

/**
 * Universal Clip Item Schema
 * Bridges Python pipeline outputs (clips_catalog.json, *_clips.json, cue sheets)
 * with frontend Studios (ClipsPanel, MontageStudio, ScriptStudio).
 */
export const ClipItemSchema = z.object({
  id: z.string().optional(),
  title: z.preprocess(v => String(v || '').trim() || 'Untitled Moment', z.string()),
  category: z.preprocess(v => String(v || '').trim() || 'Highlights', z.string()),
  start_seconds: z.preprocess(v => {
    const num = Number(v);
    return Number.isFinite(num) ? Math.max(0, num) : 0;
  }, z.number().nonnegative()),
  end_seconds: z.preprocess(v => {
    const num = Number(v);
    return Number.isFinite(num) ? Math.max(0, num) : 0;
  }, z.number().nonnegative()),
  duration: z.preprocess(v => {
    if (v === undefined || v === null || v === '') return undefined;
    const num = Number(v);
    return Number.isFinite(num) && num > 0 ? num : undefined;
  }, z.number().positive().optional()),
  speakers: z.preprocess(v => {
    if (Array.isArray(v)) {
      return v.map(s => String(s).trim()).filter(Boolean);
    }
    if (typeof v === 'string' && v.trim()) {
      return v.split(',').map(s => s.trim()).filter(Boolean);
    }
    return [];
  }, z.array(z.string())),
  viral_score: z.preprocess(v => {
    const num = Number(v);
    return Number.isFinite(num) ? Math.min(10, Math.max(0, Math.round(num))) : 8;
  }, z.number().min(0).max(10)),
  reason: z.preprocess(v => String(v || '').trim(), z.string()),
  transcript_snippet: z.preprocess((v, ctx) => {
    if (typeof v === 'string' && v.trim()) return v.trim();
    // Fallback: check if 'quote' was passed (common in montage manifests)
    const rawObj = ctx as any;
    if (rawObj && typeof rawObj.quote === 'string' && rawObj.quote.trim()) {
      return rawObj.quote.trim();
    }
    return '';
  }, z.string()),
  episode: z.preprocess(v => (v ? String(v).trim() : undefined), z.string().optional()),
  file_path: z.preprocess(v => (v ? String(v).trim() : undefined), z.string().optional()),
  download_url: z.preprocess(v => (v ? String(v).trim() : undefined), z.string().optional()),
}).transform(clip => {
  // Ensure duration is always populated accurately
  const calculatedDuration = Math.max(0, clip.end_seconds - clip.start_seconds);
  return {
    ...clip,
    file_path: clip.file_path ? toPosixPath(clip.file_path) : undefined,
    download_url: clip.download_url ? toPosixPath(clip.download_url) : undefined,
    duration: clip.duration ?? (calculatedDuration > 0 ? calculatedDuration : undefined),
  };
});

export type ClipItem = z.infer<typeof ClipItemSchema>;

export const ClipCatalogSchema = z.array(ClipItemSchema);

/**
 * Parses and validates an individual clip, returning null if structurally unrecoverable.
 */
export function parseClipItem(raw: unknown): ClipItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const result = ClipItemSchema.safeParse(raw);
  if (result.success) {
    // Basic invariant check: end_seconds should strictly exceed start_seconds if both exist
    if (result.data.end_seconds > result.data.start_seconds) {
      return result.data;
    }
  }
  return null;
}

/**
 * Safely parses an entire array of clips from JSON (e.g. clips_catalog.json).
 * Skips corrupt items instead of failing the entire catalog load.
 */
export function parseClipCatalog(raw: unknown): ClipItem[] {
  if (!Array.isArray(raw)) return [];
  const valid: ClipItem[] = [];
  for (const item of raw) {
    const parsed = parseClipItem(item);
    if (parsed) valid.push(parsed);
  }
  return valid;
}
