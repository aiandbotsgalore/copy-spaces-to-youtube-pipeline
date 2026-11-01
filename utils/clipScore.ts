/** Normalize clip ratings to the documented 0..10 scale. */
export function normalizeViralScore(raw: unknown, fallback = 8): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  const scaled = Math.abs(value) > 10 ? value / 10 : value;
  return Math.min(10, Math.max(0, Math.round(scaled * 10) / 10));
}

export function normalizeClipSpeakers(raw: unknown): string[] {
  const values = Array.isArray(raw)
    ? raw.map(value => String(value ?? '').trim()).filter(Boolean)
    : typeof raw === 'string'
      ? raw.split(/[,;&|/]+/).map(value => value.trim()).filter(Boolean)
      : [];
  if (values.length >= 3 && values.every(value => value.length <= 1)) {
    const joined = values.join('').replace(/\s+/g, ' ').trim();
    return joined ? [joined] : [];
  }
  return [...new Set(values)];
}
