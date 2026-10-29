/**
 * The project's Evidence Board: the quotes Logan starred (grouped by recording) and the ones he excluded,
 * with his notes. Quote data comes from the shared library; the board stores only references.
 */
import React, { useMemo, useState } from 'react';
import { BookOpen, ChevronDown, ChevronRight, Loader2, Star } from 'lucide-react';
import { QuoteRow, type LibraryState } from './QuoteLibrary';
import { audioLabel, type ListenOption, type ViewEntry } from '../utils/quoteView';

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));

export default function ScriptBoard({ lib, question, onOpenLibrary, onListen, playingUrl }: {
  lib: LibraryState; question: string; onOpenLibrary: () => void; onListen: (e: ViewEntry, o: ListenOption) => void; playingUrl: string | null;
}) {
  const [showExcluded, setShowExcluded] = useState(false);
  const byRef = useMemo(() => new Map((lib.entries || []).map(e => [e.ref, e])), [lib.entries]);
  const items = lib.board?.items || [];
  const starred = items.filter(i => i.starred && !i.excluded).map(i => ({ i, e: byRef.get(i.ref) })).filter((x): x is { i: typeof x.i; e: ViewEntry } => !!x.e);
  const excluded = items.filter(i => i.excluded).map(i => ({ i, e: byRef.get(i.ref) })).filter((x): x is { i: typeof x.i; e: ViewEntry } => !!x.e);
  const groups = useMemo(() => {
    const m = new Map<string, typeof starred>();
    for (const x of starred) m.set(x.e.releaseTag, [...(m.get(x.e.releaseTag) || []), x]);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [starred]);
  const usable = starred.filter(x => x.e.link && audioLabel(x.e.link.audio).usable).length;
  const confirmed = starred.filter(x => x.e.link?.speakerConfirmed).length;

  if (!lib.entries) return <div className="p-6 text-sm text-slate-400 flex items-center gap-2">{lib.loading ? <><Loader2 size={14} className="animate-spin" /> Loading the board...</> : lib.error ? `Could not load the board: ${String((lib.error as any)?.message || lib.error)}` : null}</div>;
  const row = (x: { i: typeof items[number]; e: ViewEntry }) => (
    <QuoteRow key={x.e.ref} entry={x.e} item={x.i} canEdit onItem={lib.setItem} onSpeaker={lib.confirmSpeaker} onListen={onListen} playingUrl={playingUrl} />
  );
  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
      <div className="space-y-1">
        <div className="text-sm text-slate-200 font-medium">Evidence Board</div>
        <div className="text-xs text-slate-400">{question ? <>Question: <span className="text-slate-200">{question}</span></> : 'No question set for this project yet (the thesis is used).'}</div>
        <div className="text-[11px] text-slate-500">
          {starred.length} starred · {excluded.length} excluded · {usable} of the starred have usable audio · {confirmed} speakers confirmed by listening
        </div>
      </div>
      {!starred.length && (
        <div className="rounded-md border border-dashed border-slate-700 p-6 text-center space-y-2">
          <div className="text-sm text-slate-300">No quotes starred for this project yet.</div>
          <button className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border bg-indigo-600 border-indigo-500 text-white hover:bg-indigo-500" onClick={onOpenLibrary}><BookOpen size={12} /> Open the Library</button>
        </div>
      )}
      {groups.map(([tag, list]) => (
        <section key={tag} className="space-y-2">
          <div className="text-[11px] uppercase tracking-wide text-slate-500 font-bold flex items-center gap-1.5">
            <Star size={11} className="text-amber-400" /> {str(list[0].e.corpus.date)} {str(list[0].e.corpus.episode_title).replace(/_/g, ' ')} ({list.length})
          </div>
          {list.map(row)}
        </section>
      ))}
      {excluded.length > 0 && (
        <section className="space-y-2 pt-2 border-t border-slate-800/80">
          <button className="text-[11px] uppercase tracking-wide text-slate-500 font-bold flex items-center gap-1" onClick={() => setShowExcluded(!showExcluded)}>
            {showExcluded ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Excluded ({excluded.length})
          </button>
          {showExcluded && excluded.map(row)}
        </section>
      )}
    </div>
  );
}
