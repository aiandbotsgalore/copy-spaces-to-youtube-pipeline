/**
 * Small shared UI helpers for the design system: one accent, status shown as a dot plus text,
 * categories as neutral tags with a signal dot.
 */

/** Tailwind background class for the small dot shown next to a clip category. */
export function categoryDotClass(category?: string): string {
  const c = (category || '').toLowerCase();
  if (/(allegation|threat|criminal|abuse)/.test(c)) return 'bg-rose-400';
  if (/(retaliat|disclos|insult|character|sexual)/.test(c)) return 'bg-amber-400';
  if (/(evidence|archive|record)/.test(c)) return 'bg-indigo-400';
  return 'bg-slate-500';
}
