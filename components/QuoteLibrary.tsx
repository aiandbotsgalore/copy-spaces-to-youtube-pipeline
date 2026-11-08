/**
 * Evidence Library: every AQ corpus quote with its corpus record (all fields as they are), where it was
 * located in the transcript, whether the wording is exact, and its audio status. Star, exclude and note
 * act on the current project's board; speaker confirmation applies to every project.
 *
 * Corpus cut points are labelled "Corpus cut": supplied by the corpus, not independently checked.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Ban, Check, CheckCircle2, ChevronDown, ChevronRight, FileAudio, Loader2, Pause, Play, Search, Sliders, Sparkles, Star, StickyNote, UserCheck, Volume2 } from 'lucide-react';
import { scriptApi, type LibrarySync } from '../utils/scriptClient';
import { audioLabel, facetValues, filterEntries, listenOptions, type EntryFilters, type ListenOption, type ViewEntry } from '../utils/quoteView';
import type { AudioBoundary, BoardItem, EvidenceBoard } from '../utils/scriptTypes';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
const chip = 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border';
const btnTiny = 'inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] border border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white transition-colors disabled:opacity-40';
const hms = (s: number) => { const t = Math.max(0, Math.floor(s)); const h = Math.floor(t / 3600); const m = Math.floor((t % 3600) / 60); const ss = String(t % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`; };
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));

export type ItemPatch = { starred?: boolean; excluded?: boolean; note?: string };

/** Loads the library (importing the AQ corpus on first use) and the project's board. */
export function useLibrary(projectId: string | null, enabled: boolean) {
  const [entries, setEntries] = useState<ViewEntry[] | null>(null);
  const [board, setBoard] = useState<EvidenceBoard | null>(null);
  const [sync, setSync] = useState<LibrarySync | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const reload = useCallback(async () => {
    setLoading(true); setError(null);
    try { const r = await scriptApi.library(projectId); setEntries(r.entries); setBoard(r.board); setSync(r.sync); }
    catch (e) { setError(e); } finally { setLoading(false); }
  }, [projectId]);
  useEffect(() => { if (enabled) void reload(); }, [enabled, reload]);

  const setItem = useCallback(async (ref: string, patch: ItemPatch) => {
    if (!projectId) return;
    try { setBoard((await scriptApi.boardItem(projectId, ref, patch)).board); } catch (e) { setError(e); }
  }, [projectId]);
  const confirmSpeaker = useCallback(async (ref: string, name: string | null) => {
    try {
      const { link } = await scriptApi.confirmSpeaker(ref, name);
      setEntries(prev => prev && prev.map(e => (e.ref === ref ? { ...e, link } : e)));
    } catch (e) { setError(e); }
  }, []);
  const updateAudio = useCallback((ref: string, audio: AudioBoundary) => {
    setEntries(prev => prev && prev.map(e => (e.ref === ref && e.link ? { ...e, link: { ...e.link, audio } } : e)));
  }, []);
  return { entries, board, sync, loading, error, reload, setItem, confirmSpeaker, updateAudio };
}
export type LibraryState = ReturnType<typeof useLibrary>;

function TextBadge({ e }: { e: ViewEntry }) {
  const s = e.link?.text.status;
  if (s === 'exact') return <span className={cx(chip, 'border-emerald-800/60 bg-emerald-950/30 text-emerald-300')} title="The corpus wording is the transcript's exact wording."><Check size={10} /> Exact wording</span>;
  if (s === 'differs') return <span className={cx(chip, 'border-sky-800/60 bg-sky-950/30 text-sky-300')} title={e.link?.text.note}>Wording differs</span>;
  return <span className={cx(chip, 'border-amber-800/60 bg-amber-950/30 text-amber-300')} title={e.link?.text.note}>Not located</span>;
}

function AudioBadge({ e }: { e: ViewEntry }) {
  if (!e.link) return null;
  const l = audioLabel(e.link.audio);
  const a = e.link.audio;
  const tone = l.kind === 'manual' ? 'border-emerald-800/60 bg-emerald-950/30 text-emerald-300'
    : l.kind === 'corpus_cut' ? 'border-violet-800/60 bg-violet-950/30 text-violet-300'
    : l.kind === 'aligned' ? 'border-teal-800/60 bg-teal-950/30 text-teal-300'
    : l.kind === 'needs_review' ? 'border-amber-800/60 bg-amber-950/30 text-amber-300' : 'border-slate-700 bg-slate-900 text-slate-400';
  const range = l.usable ? ` ${hms(a.startSec!)} to ${hms(a.endSec!)}` : '';
  return <span className={cx(chip, tone)} title={l.detail}>{l.short}{range}</span>;
}

export function QuoteRow({ entry: e, item, canEdit, onItem, onSpeaker, onListen, onUpdateAudio, playingUrl }: {
  entry: ViewEntry; item?: BoardItem; canEdit: boolean;
  onItem: (ref: string, patch: ItemPatch) => void; onSpeaker: (ref: string, name: string | null) => void;
  onListen: (e: ViewEntry, o: ListenOption) => void;
  onUpdateAudio?: (ref: string, audio: AudioBoundary) => void;
  playingUrl: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [aligning, setAligning] = useState(false);
  const [startSec, setStartSec] = useState<number | null>(null);
  const [endSec, setEndSec] = useState<number | null>(null);
  const [reviewMsg, setReviewMsg] = useState<string | null>(null);
  const [note, setNote] = useState(item?.note || '');
  const [speaker, setSpeaker] = useState(e.link?.speakerName || str(e.corpus.speaker).replace(/\s*\(.*\)$/, ''));
  useEffect(() => setNote(item?.note || ''), [item?.note]);
  const link = e.link;
  const options = listenOptions(e);

  const curStart = startSec ?? link?.audio.startSec ?? link?.audio.suggestedStartSec ?? link?.segStart ?? 0;
  const curEnd = endSec ?? link?.audio.endSec ?? link?.audio.suggestedEndSec ?? link?.segEnd ?? (curStart + 5);

  const handleAlign = async () => {
    setAligning(true);
    setReviewMsg(null);
    try {
      const res = await scriptApi.alignQuote(e.ref);
      if (res.ok) {
        onUpdateAudio?.(e.ref, res.audio);
        if (res.audio.status === 'aligned') {
          setReviewMsg(`✓ Aligned (${hms(res.audio.startSec!)} to ${hms(res.audio.endSec!)})`);
        } else {
          setReviewMsg(`Needs review: ${res.audio.reason}`);
          setShowReview(true);
        }
      }
    } catch (err: any) {
      setReviewMsg(`Alignment failed: ${err?.message || err}`);
    } finally {
      setAligning(false);
    }
  };

  const handleApprove = async () => {
    setReviewMsg(null);
    try {
      const res = await scriptApi.reviewAudio(e.ref, {
        action: 'approve',
        startSec: curStart,
        endSec: curEnd,
      });
      if (res.ok) {
        onUpdateAudio?.(e.ref, res.audio);
        setReviewMsg(`✓ Approved as verified audio (${hms(res.audio.startSec!)} to ${hms(res.audio.endSec!)})`);
      }
    } catch (err: any) {
      setReviewMsg(`Approval failed: ${err?.message || err}`);
    }
  };

  const handleNudge = (deltaS: number, deltaE: number) => {
    const nextS = Math.max(0, curStart + deltaS);
    const nextE = Math.max(nextS + 0.1, curEnd + deltaE);
    setStartSec(Math.round(nextS * 1000) / 1000);
    setEndSec(Math.round(nextE * 1000) / 1000);
  };
  return (
    <div className={cx('rounded-md border p-3 space-y-2 transition-colors', item?.excluded ? 'border-slate-800/60 bg-slate-950/40 opacity-60' : item?.starred ? 'border-amber-700/40 bg-amber-950/10' : 'border-slate-800 bg-slate-950/60')}>
      <div className="flex items-center gap-2 text-[11px] text-slate-500 flex-wrap">
        {canEdit && (
          <button onClick={() => onItem(e.ref, { starred: !item?.starred })} title={item?.starred ? 'Unstar for this project' : 'Star for this project'} className={item?.starred ? 'text-amber-400' : 'text-slate-500 hover:text-amber-300'}>
            <Star size={14} fill={item?.starred ? 'currentColor' : 'none'} />
          </button>
        )}
        <span className="font-mono text-slate-300">{e.aqId}</span>
        <span>{str(e.corpus.date)}</span>
        <span className="truncate max-w-[18rem]" title={`${str(e.corpus.episode_title)} (${e.releaseTag})`}>{str(e.corpus.episode_title).replace(/_/g, ' ')}</span>
        {link && link.segStart !== undefined && <span className="font-mono">{hms(link.segStart)}</span>}
        <div className="flex-1" />
        <span title="Speaker according to the corpus">{str(e.corpus.speaker)}</span>
        {link?.speakerConfirmed
          ? <span className={cx(chip, 'border-emerald-800/60 bg-emerald-950/30 text-emerald-300')} title="Confirmed by listening"><UserCheck size={10} /> {link.speakerName}</span>
          : <span className={cx(chip, 'border-slate-700 text-slate-400')} title={`Transcript labels: ${link?.speakerLabels.join(', ') || 'none'}. Labels are suggestions, never proof.`}>Speaker not confirmed</span>}
      </div>

      <blockquote className="text-sm text-slate-100 leading-relaxed border-l-2 border-indigo-500/50 pl-3">{e.corpus.exact_quote}</blockquote>
      {link?.text.status === 'differs' && link.text.transcriptSpan && (
        <div className="text-[11px] text-slate-400 pl-3"><span className="text-slate-500">Transcript wording{link.speakerLabels.length ? ` (${link.speakerLabels.join(', ')})` : ''}: </span>{link.text.transcriptSpan}</div>
      )}
      {link?.text.status === 'unlocated' && <div className="text-[11px] text-amber-300/90 pl-3">{link.text.note}</div>}
      {e.warnings.map(w => <div key={w} className="text-[11px] text-amber-300 flex items-start gap-1 pl-3"><AlertTriangle size={11} className="mt-0.5 shrink-0" /> {w}</div>)}

      <div className="flex items-center gap-1.5 flex-wrap">
        <TextBadge e={e} />
        <AudioBadge e={e} />
        {e.clipFile && <span className={cx(chip, 'border-slate-700 text-slate-300')} title={`${e.clipFile.filename} (from the ${e.clipFile.from === 'master' ? 'master file' : 'clip manifest'}). A pre cut file; its boundaries are not independently checked.`}><FileAudio size={10} /> WAV</span>}
        {str(e.corpus.category) && <span className={cx(chip, 'border-slate-800 text-slate-400')}>{str(e.corpus.category)}</span>}
        {str(e.corpus.target) && <span className={cx(chip, 'border-slate-800 text-slate-400')}>Target: {str(e.corpus.target)}</span>}
        {str(e.corpus.recommendation) && <span className={cx(chip, 'border-slate-800 text-slate-500')}>{str(e.corpus.recommendation)}</span>}
        {item?.note && <span className={cx(chip, 'border-indigo-800/60 text-indigo-300')} title={item.note}><StickyNote size={10} /> Note</span>}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {options.map(o => (
          <button key={o.kind} className={btnTiny} onClick={() => onListen(e, o)} title={o.kind === 'window' ? 'The located transcript window, for listening while reviewing. Not the quote\'s audio.' : undefined}>
            {playingUrl === o.url ? <Pause size={11} /> : <Play size={11} />} {o.label}
          </button>
        ))}
        {link && (
          <>
            <button className={btnTiny} disabled={aligning} onClick={handleAlign} title="Run faster-whisper word alignment on this quote">
              {aligning ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} Align audio
            </button>
            <button className={cx(btnTiny, showReview && 'border-indigo-600 text-indigo-200')} onClick={() => setShowReview(!showReview)} title="Inspect boundaries, listen, nudge and approve">
              <Sliders size={11} /> Review boundaries
            </button>
          </>
        )}
        {canEdit && (
          <button className={cx(btnTiny, item?.excluded && 'border-rose-800 text-rose-300')} onClick={() => onItem(e.ref, { excluded: !item?.excluded })} title="Exclude from this project">
            <Ban size={11} /> {item?.excluded ? 'Excluded' : 'Exclude'}
          </button>
        )}
        <div className="flex-1" />
        <button className="text-[11px] text-slate-400 hover:text-white inline-flex items-center gap-1" onClick={() => setOpen(!open)}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Note, speaker and corpus fields
        </button>
      </div>

      {showReview && (
        <div className="rounded-md border border-indigo-900/40 bg-slate-900/90 p-3 space-y-2.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-200 flex items-center gap-1.5"><Sliders size={13} className="text-indigo-400" /> Audio Boundary Review</span>
            <AudioBadge e={e} />
          </div>
          {link?.audio.reason && (
            <div className="text-[11px] text-amber-300 bg-amber-950/30 border border-amber-900/40 rounded px-2 py-1">
              {link.audio.reason}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-slate-300">
            <div className="space-y-1">
              <div className="text-[11px] text-slate-400">Start Boundary</div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-bold text-slate-100">{hms(curStart)}</span>
                <span className="font-mono text-[11px] text-slate-500">({curStart.toFixed(2)}s)</span>
                <button className={btnTiny} onClick={() => handleNudge(-0.25, 0)}>-0.25s</button>
                <button className={btnTiny} onClick={() => handleNudge(0.25, 0)}>+0.25s</button>
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-[11px] text-slate-400">End Boundary (duration: {(curEnd - curStart).toFixed(2)}s)</div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-bold text-slate-100">{hms(curEnd)}</span>
                <span className="font-mono text-[11px] text-slate-500">({curEnd.toFixed(2)}s)</span>
                <button className={btnTiny} onClick={() => handleNudge(0, -0.25)}>-0.25s</button>
                <button className={btnTiny} onClick={() => handleNudge(0, 0.25)}>+0.25s</button>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1 flex-wrap">
            <button
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium border border-emerald-600 bg-emerald-950/50 text-emerald-300 hover:bg-emerald-900 hover:text-white transition-colors"
              onClick={handleApprove}
            >
              <CheckCircle2 size={13} /> Approve Boundaries
            </button>
            <button
              className={btnTiny}
              disabled={aligning}
              onClick={handleAlign}
            >
              {aligning ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} Re-run alignment
            </button>
            {reviewMsg && (
              <span className="text-[11px] font-mono text-indigo-300">{reviewMsg}</span>
            )}
          </div>
        </div>
      )}

      {open && (
        <div className="space-y-3 pt-2 border-t border-slate-800/80">
          {canEdit && (
            <label className="block text-[11px] text-slate-400">Note for this project
              <textarea className="mt-1 w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-xs text-slate-100" rows={2} value={note}
                onChange={ev => setNote(ev.target.value)} onBlur={() => { if (note !== (item?.note || '')) onItem(e.ref, { note }); }} placeholder="Why this quote matters here, context cautions..." />
            </label>
          )}
          <div className="text-[11px] text-slate-400 space-y-1">
            <div>Confirm the speaker after listening. This applies to every project. Transcript labels: {link?.speakerLabels.join(', ') || 'none'}.</div>
            <div className="flex items-center gap-1.5">
              <input className="bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-xs text-slate-100 w-48" value={speaker} onChange={ev => setSpeaker(ev.target.value)} placeholder="Speaker name" />
              <button className={btnTiny} disabled={!speaker.trim()} onClick={() => onSpeaker(e.ref, speaker)}><UserCheck size={11} /> Confirm</button>
              {link?.speakerConfirmed && <button className={btnTiny} onClick={() => onSpeaker(e.ref, null)}>Clear</button>}
            </div>
          </div>
          <details>
            <summary className="text-[11px] text-slate-400 cursor-pointer">All {Object.keys(e.corpus).length} corpus fields (read only)</summary>
            <table className="mt-1 w-full text-[11px]">
              <tbody>
                {Object.entries(e.corpus).map(([k, v]) => (
                  <tr key={k} className="border-t border-slate-800/60 align-top">
                    <td className="py-0.5 pr-2 font-mono text-slate-500 whitespace-nowrap">{k}</td>
                    <td className="py-0.5 text-slate-300 break-words">{typeof v === 'string' ? v : JSON.stringify(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      )}
    </div>
  );
}

const PAGE = 60;

export default function QuoteLibrary({ lib, projectId, onListen, playingUrl }: { lib: LibraryState; projectId: string; onListen: (e: ViewEntry, o: ListenOption) => void; playingUrl: string | null }) {
  const [f, setF] = useState<EntryFilters>({ show: 'all' });
  const [limit, setLimit] = useState(PAGE);
  const entries = lib.entries || [];
  const items = useMemo(() => new Map((lib.board?.items || []).map(i => [i.ref, i])), [lib.board]);
  const shown = useMemo(() => filterEntries(entries, lib.board, f), [entries, lib.board, f]);
  const recordings = useMemo(() => facetValues(entries, e => e.releaseTag), [entries]);
  const titles = useMemo(() => new Map(entries.map(e => [e.releaseTag, `${str(e.corpus.date)} ${str(e.corpus.episode_title).replace(/_/g, ' ')}`])), [entries]);
  const speakers = useMemo(() => facetValues(entries, e => str(e.corpus.speaker)), [entries]);
  const categories = useMemo(() => facetValues(entries, e => str(e.corpus.category)), [entries]);
  const targets = useMemo(() => facetValues(entries, e => str(e.corpus.target)), [entries]);
  const cutCount = entries.filter(e => e.link?.audio.source === 'corpus_cut').length;
  const set = (patch: EntryFilters) => { setF(prev => ({ ...prev, ...patch })); setLimit(PAGE); };
  const sel = 'bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-xs text-slate-200 max-w-[14rem]';

  if (!lib.entries) {
    return <div className="p-6 text-sm text-slate-400 flex items-center gap-2">{lib.loading ? <><Loader2 size={14} className="animate-spin" /> Importing the AQ corpus into the evidence library (first time takes a few seconds)...</> : lib.error ? `Could not load the library: ${String((lib.error as any)?.message || lib.error)}` : null}</div>;
  }
  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
      <div className="space-y-1">
        <div className="text-sm text-slate-200 font-medium">Evidence Library</div>
        {lib.sync && (
          <div className="text-[11px] text-slate-500">
            {lib.sync.quotes} AQ quotes · {lib.sync.located} located in their transcripts ({lib.sync.exact} exact wording, {lib.sync.differs} wording differs) · {lib.sync.unlocated} not located · {cutCount} with corpus cut points (not independently checked)
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap sticky top-0 z-10 bg-slate-950/95 backdrop-blur py-2">
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
          <input className="bg-slate-900 border border-slate-700 rounded pl-6 pr-2 py-1 text-xs text-slate-100 w-56" placeholder="Search wording, notes, AQ id" value={f.query || ''} onChange={ev => set({ query: ev.target.value })} />
        </div>
        <select className={sel} value={f.releaseTag || ''} onChange={ev => set({ releaseTag: ev.target.value || undefined })}>
          <option value="">All recordings ({recordings.length})</option>
          {recordings.map(r => <option key={r.value} value={r.value}>{titles.get(r.value)} ({r.count})</option>)}
        </select>
        <select className={sel} value={f.speaker || ''} onChange={ev => set({ speaker: ev.target.value || undefined })}>
          <option value="">All speakers</option>
          {speakers.map(r => <option key={r.value} value={r.value}>{r.value} ({r.count})</option>)}
        </select>
        <select className={sel} value={f.category || ''} onChange={ev => set({ category: ev.target.value || undefined })}>
          <option value="">All categories</option>
          {categories.map(r => <option key={r.value} value={r.value}>{r.value} ({r.count})</option>)}
        </select>
        <select className={sel} value={f.target || ''} onChange={ev => set({ target: ev.target.value || undefined })}>
          <option value="">All targets</option>
          {targets.map(r => <option key={r.value} value={r.value}>{r.value} ({r.count})</option>)}
        </select>
        <select className={sel} value={f.show || 'all'} onChange={ev => set({ show: ev.target.value as EntryFilters['show'] })}>
          <option value="all">All quotes</option>
          <option value="starred">Starred in this project</option>
          <option value="not_excluded">Hide excluded</option>
          <option value="excluded">Excluded in this project</option>
        </select>
        <span className="text-[11px] text-slate-500">Showing {Math.min(limit, shown.length)} of {shown.length}{shown.length !== entries.length ? ` (${entries.length} total)` : ''}</span>
      </div>
      {lib.error ? <div className="text-[11px] text-rose-300">{String((lib.error as any)?.message || lib.error)}</div> : null}
      <div className="space-y-2.5">
        {shown.slice(0, limit).map(e => (
          <QuoteRow key={e.ref} entry={e} item={items.get(e.ref)} canEdit={!!projectId} onItem={lib.setItem} onSpeaker={lib.confirmSpeaker} onListen={onListen} onUpdateAudio={lib.updateAudio} playingUrl={playingUrl} />
        ))}
        {shown.length > limit && <button className={btnTiny} onClick={() => setLimit(limit + PAGE)}>Show {Math.min(PAGE, shown.length - limit)} more</button>}
        {!shown.length && <div className="text-xs text-slate-500 italic">No quotes match these filters.</div>}
      </div>
    </div>
  );
}
