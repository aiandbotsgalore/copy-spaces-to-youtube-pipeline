import React, { useEffect, useMemo, useRef } from 'react';
import { Loader, Search, SlidersHorizontal, X } from 'lucide-react';
import type { GlobalSearchResult } from '../../utils/transcriptData';
import { formatSeconds } from '../../utils/transcriptData';

export interface GlobalSearchOverlayProps {
  query: string;
  onQuery: (q: string) => void;
  results: GlobalSearchResult[];
  totalMatches: number;
  loading: boolean;
  dateLabel: (publishedAt: string) => string;
  highlight: (text: string, query: string) => React.ReactNode;
  onPick: (res: GlobalSearchResult) => void;
  onAdvanced: () => void;
  onClose: () => void;
}

const HITS_PER_EPISODE = 3;

/** Search every episode at once; hits grouped by episode, click to open it at that moment. */
export const GlobalSearchOverlay: React.FC<GlobalSearchOverlayProps> = (p) => {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') p.onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [p.onClose]);

  const groups = useMemo(() => {
    const map = new Map<string, { tag: string; title: string; published: string; hits: GlobalSearchResult[] }>();
    for (const r of p.results) {
      const g = map.get(r.release_tag);
      if (g) g.hits.push(r);
      else map.set(r.release_tag, { tag: r.release_tag, title: r.title, published: r.published_at, hits: [r] });
    }
    return Array.from(map.values());
  }, [p.results]);

  const hasQuery = p.query.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[8vh]" onClick={p.onClose} role="dialog" aria-modal="true" aria-label="Search all transcripts">
      <div onClick={e => e.stopPropagation()} className="w-full max-w-2xl max-h-[78vh] flex flex-col rounded-xl border border-line bg-card shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-line">
          <Search size={16} className="text-slate-400 flex-shrink-0" />
          <input
            ref={inputRef}
            value={p.query}
            onChange={e => p.onQuery(e.target.value)}
            placeholder="Search every transcript…"
            aria-label="Search all transcripts"
            className="flex-1 min-w-0 bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none"
          />
          {p.loading && <Loader size={14} className="animate-spin text-slate-400" />}
          <button onClick={p.onClose} aria-label="Close search" className="text-slate-400 hover:text-white cursor-pointer"><X size={15} /></button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {!hasQuery && <p className="px-5 py-10 text-center text-xs text-slate-500">Type to search all episodes. Click a result to open it at that moment.</p>}
          {hasQuery && !p.loading && groups.length === 0 && <p className="px-5 py-10 text-center text-xs text-slate-500">No matches for “{p.query}”.</p>}
          {groups.map(g => (
            <section key={g.tag} className="border-b border-line last:border-b-0">
              <header className="flex items-center justify-between gap-3 px-4 pt-3 pb-1.5">
                <h4 className="text-xs font-semibold text-slate-100 truncate">{g.title}</h4>
                <span className="text-[11px] font-mono text-slate-500 whitespace-nowrap">{p.dateLabel(g.published)} · {g.hits.length} hit{g.hits.length === 1 ? '' : 's'}</span>
              </header>
              <ul className="pb-2">
                {g.hits.slice(0, HITS_PER_EPISODE).map(r => (
                  <li key={`${r.release_tag}-${r.segmentIndex}`}>
                    <button onClick={() => p.onPick(r)} className="w-full flex items-start gap-3 px-4 py-1.5 text-left hover:bg-row cursor-pointer">
                      <span className="font-mono text-[11px] text-a0 w-14 flex-shrink-0 pt-0.5">{formatSeconds(r.segment.start)}</span>
                      <span className="text-xs text-slate-300 leading-relaxed line-clamp-2">
                        <span className="text-slate-500">{r.segment.speaker}: </span>{p.highlight(r.segment.text, p.query)}
                      </span>
                    </button>
                  </li>
                ))}
                {g.hits.length > HITS_PER_EPISODE && (
                  <li className="px-4 pl-[4.75rem] pt-0.5 text-[11px] text-slate-500">+{g.hits.length - HITS_PER_EPISODE} more in this episode</li>
                )}
              </ul>
            </section>
          ))}
        </div>

        <div className="flex items-center justify-between px-4 py-2.5 border-t border-line text-[11px] text-slate-500">
          <span>{hasQuery ? `${p.totalMatches.toLocaleString()} match${p.totalMatches === 1 ? '' : 'es'} in ${groups.length} episode${groups.length === 1 ? '' : 's'} shown` : 'Esc to close'}</span>
          <button onClick={p.onAdvanced} className="flex items-center gap-1.5 text-slate-300 hover:text-white cursor-pointer">
            <SlidersHorizontal size={12} /> Advanced filters
          </button>
        </div>
      </div>
    </div>
  );
};
