/** Normalize clip ratings to the documented 0..10 scale. */
export function normalizeViralScore(raw: unknown, fallback = 8): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  const scaled = Math.abs(value) > 10 ? value / 10 : value;
  return Math.min(10, Math.max(0, Math.round(scaled * 10) / 10));
}

/**
 * Consolidates all variations of Logan (e.g. "Logan Black", "logan", etc.)
 * strictly into "Logan".
 */
export function canonicalizeSpeakerName(speaker: string): string {
  const trimmed = String(speaker ?? '').trim();
  if (!trimmed) return '';
  if (/^logan(\s+black)?$/i.test(trimmed) || /^logan\b/i.test(trimmed)) {
    return 'Logan';
  }
  return trimmed;
}

export function normalizeClipSpeakers(raw: unknown): string[] {
  let list = Array.isArray(raw)
    ? raw.map(value => String(value ?? ''))
    : typeof raw === 'string'
      ? [raw]
      : [];

  // Check if broken letter-by-letter array (e.g. ['L', 'o', 'g', 'a', 'n', ',', ' ', 'S', ...])
  if (list.length >= 3 && list.every(value => value.length <= 1)) {
    const joined = list.join('').replace(/\s+/g, ' ').trim();
    list = joined ? [joined] : [];
  } else {
    list = list.map(v => v.trim()).filter(Boolean);
  }

  // Split each entry on delimiters (commas, semicolons, slashes, etc.)
  const splitValues = list.flatMap(entry => entry.split(/[,;&|/]+/)).map(v => v.trim()).filter(Boolean);

  // Canonicalize every speaker name (consolidating all Logan variations to "Logan")
  const canonical = splitValues.map(v => canonicalizeSpeakerName(v)).filter(Boolean);

  return [...new Set(canonical)];
}
