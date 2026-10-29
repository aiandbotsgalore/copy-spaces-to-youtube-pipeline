/**
 * View logic for the Evidence Library and Board (browser side, pure). Filters, facet counts, how quote
 * audio is labelled, and what can be listened to. Corpus cut points are always labelled as supplied by
 * the corpus, never as independently checked.
 */
import type { AqLink, AudioBoundary, EvidenceBoard } from './scriptTypes';

/** One AQ quote as /api/script/library returns it (server/quoteLibrary.ts AqEntry). */
export interface ViewEntry {
  ref: string; aqId: string; releaseTag: string;
  corpus: Readonly<Record<string, unknown> & { quote_id: string; exact_quote: string; speaker: string }>;
  link: AqLink | null;
  clipFile?: { filename: string; url: string; from: 'master' | 'manifest' };
  warnings: string[];
}

export interface EntryFilters {
  releaseTag?: string; speaker?: string; category?: string; target?: string; query?: string;
  show?: 'all' | 'starred' | 'excluded' | 'not_excluded';
}

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));

export function filterEntries(entries: ViewEntry[], board: EvidenceBoard | null, f: EntryFilters): ViewEntry[] {
  const items = new Map((board?.items || []).map(i => [i.ref, i]));
  const q = (f.query || '').trim().toLowerCase();
  return entries.filter(e => {
    if (f.releaseTag && e.releaseTag !== f.releaseTag) return false;
    if (f.speaker && str(e.corpus.speaker) !== f.speaker) return false;
    if (f.category && str(e.corpus.category) !== f.category) return false;
    if (f.target && str(e.corpus.target) !== f.target) return false;
    const item = items.get(e.ref);
    if (f.show === 'starred' && !item?.starred) return false;
    if (f.show === 'excluded' && !item?.excluded) return false;
    if (f.show === 'not_excluded' && item?.excluded) return false;
    if (q) {
      const hay = [e.aqId, e.corpus.exact_quote, e.link?.text.transcriptSpan, e.corpus.why_it_matters, e.corpus.notes, item?.note].map(str).join('\n').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function facetValues(entries: ViewEntry[], key: (e: ViewEntry) => string): { value: string; count: number }[] {
  const m = new Map<string, number>();
  for (const e of entries) { const v = key(e); if (v) m.set(v, (m.get(v) || 0) + 1); }
  return [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export interface AudioLabel { kind: 'corpus_cut' | 'manual' | 'aligned' | 'needs_review' | 'none'; short: string; detail: string; usable: boolean }

export function audioLabel(a: AudioBoundary): AudioLabel {
  const usable = (a.status === 'verified' || a.status === 'aligned') && a.startSec !== undefined && a.endSec !== undefined;
  if (a.status === 'verified' && a.source === 'corpus_cut') return { kind: 'corpus_cut', short: 'Corpus cut', detail: 'Cut points supplied by the AQ corpus. Not independently checked against the audio by this app.', usable };
  if (a.status === 'verified') return { kind: 'manual', short: 'Verified by you', detail: 'You listened and approved these boundaries.', usable };
  if (a.status === 'aligned') return { kind: 'aligned', short: 'Aligned', detail: `Word alignment in code${a.matchedPct !== undefined ? ` (${Math.round(a.matchedPct * 100)}% of words matched)` : ''}.`, usable };
  if (a.status === 'needs_review') return { kind: 'needs_review', short: 'Needs review', detail: a.reason || 'Alignment was uncertain. Not usable until you review it.', usable: false };
  return { kind: 'none', short: 'No verified audio', detail: a.reason || 'No audio boundaries yet.', usable: false };
}

export interface ListenOption { kind: 'audio' | 'wav' | 'window'; label: string; url: string }

export function listenOptions(e: ViewEntry): ListenOption[] {
  const out: ListenOption[] = [];
  const ref = encodeURIComponent(e.ref);
  if (e.link) {
    const l = audioLabel(e.link.audio);
    if (l.usable) out.push({ kind: 'audio', label: l.kind === 'corpus_cut' ? 'Play corpus cut' : l.kind === 'manual' ? 'Play verified audio' : 'Play aligned audio', url: `/api/script/library/audio?ref=${ref}` });
  }
  if (e.clipFile) out.push({ kind: 'wav', label: 'Play pre cut WAV', url: e.clipFile.url });
  if (e.link && e.link.segStart !== undefined && e.link.segEnd !== undefined) out.push({ kind: 'window', label: 'Play transcript window', url: `/api/script/library/audio?ref=${ref}&mode=window` });
  return out;
}
