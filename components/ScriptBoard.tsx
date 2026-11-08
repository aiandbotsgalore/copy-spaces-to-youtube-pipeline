/**
 * The project's Evidence Board: the quotes Logan starred (grouped by recording) and the ones he excluded,
 * with his notes. Quote data comes from the shared library; the board stores only references.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { BookOpen, Check, ChevronDown, ChevronRight, Compass, Loader2, Sparkles, Star } from 'lucide-react';
import { QuoteRow, type LibraryState } from './QuoteLibrary';
import { audioLabel, type ListenOption, type ViewEntry } from '../utils/quoteView';
import { scriptApi } from '../utils/scriptClient';

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));

interface DiscoveryHit {
  releaseTag: string;
  title: string;
  date: string | null;
  score: number;
  terms: Record<string, number>;
  samples: { start: number; speaker: string; text: string }[];
  libraryQuotesCount: number;
  aqQuotesCount: number;
  readCount: number;
  boardStatus?: 'candidate' | 'read' | 'skipped';
}

export default function ScriptBoard({ lib, projectId, question, onOpenLibrary, onListen, playingUrl }: {
  lib: LibraryState; projectId?: string | null; question: string; onOpenLibrary: () => void; onListen: (e: ViewEntry, o: ListenOption) => void; playingUrl: string | null;
}) {
  const [showExcluded, setShowExcluded] = useState(false);
  const [showDiscovery, setShowDiscovery] = useState(false);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [discoveryHits, setDiscoveryHits] = useState<DiscoveryHit[] | null>(null);
  const [readingTag, setReadingTag] = useState<string | null>(null);
  const [readMessages, setReadMessages] = useState<Record<string, string>>({});

  const handleDiscover = useCallback(async () => {
    if (!projectId) return;
    setDiscoveryLoading(true);
    try {
      const res = await scriptApi.discover(projectId, question);
      setDiscoveryHits(res.hits);
      setShowDiscovery(true);
    } catch (e: any) {
      console.error('Discovery failed:', e);
    } finally {
      setDiscoveryLoading(false);
    }
  }, [projectId, question]);

  const handleReadRecording = useCallback(async (tag: string) => {
    if (!projectId) return;
    setReadingTag(tag);
    try {
      const { result } = await scriptApi.readRecording(projectId, tag, question);
      const msg = result.fromCache
        ? 'Already read for this question (loaded from cache)'
        : `Extracted ${result.newQuotes.length} new quotes, merged ${result.mergedRefs.length} existing`;
      setReadMessages(prev => ({ ...prev, [tag]: msg }));
      // Reload library to show new quotes and updated board
      await lib.reload();
      // Update discovery hit count locally
      setDiscoveryHits(prev => prev && prev.map(h => (h.releaseTag === tag ? { ...h, readCount: h.readCount + 1, libraryQuotesCount: h.libraryQuotesCount + result.newQuotes.length, boardStatus: 'read' } : h)));
    } catch (e: any) {
      setReadMessages(prev => ({ ...prev, [tag]: `Read failed: ${e?.message || e}` }));
    } finally {
      setReadingTag(null);
    }
  }, [projectId, question, lib]);

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
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="text-sm text-slate-200 font-medium">Evidence Board</div>
          <div className="text-xs text-slate-400">{question ? <>Question: <span className="text-slate-200">{question}</span></> : 'No question set for this project yet (the thesis is used).'}</div>
          <div className="text-[11px] text-slate-500">
            {starred.length} starred · {excluded.length} excluded · {usable} of the starred have usable audio · {confirmed} speakers confirmed by listening
          </div>
        </div>
        {projectId && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (!discoveryHits && !showDiscovery) void handleDiscover();
                else setShowDiscovery(!showDiscovery);
              }}
              disabled={discoveryLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-indigo-500/40 bg-indigo-950/40 text-indigo-300 hover:bg-indigo-900/50 hover:text-white transition-colors disabled:opacity-50"
            >
              {discoveryLoading ? <Loader2 size={13} className="animate-spin" /> : <Compass size={13} />}
              {showDiscovery ? 'Hide Discovery' : 'Discover Recordings'}
            </button>
            <button
              onClick={onOpenLibrary}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
            >
              <BookOpen size={13} /> Open Library
            </button>
          </div>
        )}
      </div>

      {showDiscovery && (
        <div className="rounded-lg border border-indigo-900/50 bg-[#0c1322] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-indigo-400">
              <Sparkles size={13} /> Ranked Recordings for Question
            </div>
            <button
              onClick={handleDiscover}
              disabled={discoveryLoading}
              className="text-[11px] text-slate-400 hover:text-white underline"
            >
              Refresh search
            </button>
          </div>

          {discoveryHits && discoveryHits.length > 0 ? (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {discoveryHits.map(hit => (
                <div key={hit.releaseTag} className="rounded border border-slate-800/80 bg-[#131b2e] p-3 text-xs space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-slate-200">{hit.title.replace(/_/g, ' ')}</div>
                      <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
                        <span>{hit.date || hit.releaseTag}</span>
                        <span>·</span>
                        <span className="text-indigo-400 font-mono">Score {hit.score}</span>
                        <span>·</span>
                        <span className="text-slate-400">{hit.libraryQuotesCount} library quotes</span>
                        {hit.aqQuotesCount > 0 && <span className="text-violet-400 font-medium">({hit.aqQuotesCount} AQ)</span>}
                        {hit.boardStatus === 'read' && <span className="text-emerald-400 flex items-center gap-0.5"><Check size={10} /> Read</span>}
                      </div>
                    </div>
                    <button
                      onClick={() => void handleReadRecording(hit.releaseTag)}
                      disabled={readingTag === hit.releaseTag}
                      className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium border border-indigo-600 bg-indigo-600/80 text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
                    >
                      {readingTag === hit.releaseTag ? <><Loader2 size={11} className="animate-spin" /> Reading...</> : 'Read Recording'}
                    </button>
                  </div>
                  {hit.samples.length > 0 && (
                    <div className="text-[11px] text-slate-400 border-l-2 border-indigo-500/40 pl-2 space-y-1">
                      {hit.samples.slice(0, 2).map((s, idx) => (
                        <div key={idx} className="line-clamp-2">
                          <span className="text-slate-500">{s.speaker}:</span> {s.text}
                        </div>
                      ))}
                    </div>
                  )}
                  {readMessages[hit.releaseTag] && (
                    <div className="text-[11px] text-emerald-400 font-mono bg-emerald-950/30 border border-emerald-900/40 rounded px-2 py-0.5">
                      {readMessages[hit.releaseTag]}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-slate-400 py-2">
              {discoveryLoading ? 'Ranking recordings against thesis terms...' : 'No candidate recordings found matching question terms.'}
            </div>
          )}
        </div>
      )}

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
