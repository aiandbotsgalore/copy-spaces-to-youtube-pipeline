import type { ClipItem } from './contracts/clipCatalog';

export interface JunkAssessment {
  junk_suspect: boolean;
  junk_score: number;
  junk_reason?: string;
}

const normalizeText = (value: unknown) => String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Flag repeated/generated-looking clips for review without hiding or deleting them. */
export function annotateJunkSuspects(clips: ClipItem[]): ClipItem[] {
  const textCounts = new Map<string, number>();
  const windowCounts = new Map<string, number>();
  for (const clip of clips) {
    const text = normalizeText(clip.transcript_snippet || clip.reason || clip.title);
    if (text) textCounts.set(text, (textCounts.get(text) || 0) + 1);
    const window = `${normalizeText(clip.episode)}|${clip.start_seconds}|${clip.end_seconds}`;
    windowCounts.set(window, (windowCounts.get(window) || 0) + 1);
  }
  return clips.map(clip => {
    const text = normalizeText(clip.transcript_snippet || clip.reason || clip.title);
    const window = `${normalizeText(clip.episode)}|${clip.start_seconds}|${clip.end_seconds}`;
    const duplicateText = Math.min(1, Math.max(0, ((textCounts.get(text) || 1) - 1) / 4));
    const duplicateWindow = Math.min(1, Math.max(0, ((windowCounts.get(window) || 1) - 1) / 3));
    const sourceMusic = normalizeText(clip.episode).includes('motivational music played 60x') ? 1 : 0;
    const score = Math.round(Math.min(1, duplicateText * 0.55 + duplicateWindow * 0.25 + sourceMusic * 0.2) * 100) / 100;
    const reasons = [
      duplicateText >= 0.5 ? 'normalized-text duplicates' : '',
      duplicateWindow >= 0.5 ? 'duplicate time window' : '',
      sourceMusic ? 'known music-loop source' : '',
    ].filter(Boolean);
    return { ...clip, junk_suspect: score >= 0.5, junk_score: score, junk_reason: reasons.length ? reasons.join('; ') : undefined };
  });
}
