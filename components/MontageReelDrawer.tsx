import React, { useEffect, useRef, useState } from 'react';
import {
  Film, Play, Pause, ChevronUp, ChevronDown, Trash2, ArrowUp, ArrowDown,
  Download, FileText, Sparkles, Layers, Clock, ShieldAlert, Check,
  X, SkipForward, SkipBack, Loader2, Volume2, Wand2, Undo2
} from 'lucide-react';
import { useMontage, MontageClipItem, DIRECTOR_LAST_PROMPT_KEY } from '../contexts/MontageContext';
import { buildSequencePlan } from '../utils/sequencePlan';
import { SORT_MAX_CLIPS, SORT_MIN_CLIPS, applySortOrder, buildSortItems, orderChangesTimeline } from '../utils/aiSort';
import { callSortClips } from '../utils/directorClient';
import { categoryDotClass } from '../utils/uiTokens';

export const MontageReelDrawer: React.FC<{ isHidden?: boolean }> = ({ isHidden = false }) => {
  const {
    clips,
    isDrawerOpen,
    openDrawer,
    closeDrawer,
    toggleDrawer,
    removeClip,
    moveClip,
    clearClips,
    gapSeconds,
    setGapSeconds,
    normalizeAudio,
    setNormalizeAudio,
    antiClickFades,
    setAntiClickFades,
    sortByEscalation,
    replaceClips,
    undo,
    canUndo,
    isAuditioning,
    currentAuditionIndex,
    startAudition,
    stopAudition,
    skipAudition,
    exportStitchedWav,
    exportManifestJson,
    exportAudacityLabels,
    isExporting,
    exportProgress,
  } = useMontage();

  // AI Sort (reorders only; never adds, removes or edits clips; locked clips stay put; undoable)
  const [isSorting, setIsSorting] = useState(false);
  const [sortMsg, setSortMsg] = useState<{ kind: 'ok' | 'info' | 'err'; text: string; canUndo?: boolean } | null>(null);
  const sortAbortRef = useRef<AbortController | null>(null);
  const clipsRef = useRef(clips);
  clipsRef.current = clips;
  useEffect(() => () => sortAbortRef.current?.abort(), []);

  const runAiSort = async () => {
    if (isSorting) {
      sortAbortRef.current?.abort();
      return;
    }
    const movable = clips.filter(c => !c.locked);
    if (clips.length > SORT_MAX_CLIPS) {
      setSortMsg({ kind: 'err', text: `AI Sort handles up to ${SORT_MAX_CLIPS} clips (you have ${clips.length}).` });
      return;
    }
    if (movable.length < SORT_MIN_CLIPS) {
      setSortMsg({ kind: 'err', text: `AI Sort needs at least ${SORT_MIN_CLIPS} unlocked clips.` });
      return;
    }
    let theme = '';
    try {
      theme = (localStorage.getItem(DIRECTOR_LAST_PROMPT_KEY) || '').trim();
    } catch {}
    const { items, refToId } = buildSortItems(movable);
    const ctl = new AbortController();
    sortAbortRef.current = ctl;
    setIsSorting(true);
    setSortMsg(null);
    try {
      const res = await callSortClips({ items, theme: theme || undefined }, ctl.signal);
      if (res.ok === false) {
        setSortMsg(res.code === 'ABORTED' ? { kind: 'info', text: 'AI Sort cancelled.' } : { kind: 'err', text: res.message });
        return;
      }
      const idOrder = res.order.map(r => refToId[r]).filter((id): id is string => !!id);
      const latest = clipsRef.current; // clips may have changed while the model was thinking
      if (!orderChangesTimeline(latest, idOrder)) {
        setSortMsg({ kind: 'info', text: 'The reel is already in the order the AI would pick.' });
        return;
      }
      replaceClips(applySortOrder(latest, idOrder));
      setSortMsg({ kind: 'ok', text: res.rationale || 'Reel re-ordered by AI.', canUndo: true });
    } finally {
      setIsSorting(false);
      if (sortAbortRef.current === ctl) sortAbortRef.current = null;
    }
  };

  if (isHidden || (clips.length === 0 && !isDrawerOpen)) {
    return null;
  }

  // Calculate total runtime
  const reelPlan = buildSequencePlan<MontageClipItem>(clips, gapSeconds);
  const totalRuntimeSec = reelPlan.totalSec;
  const runtimeMins = Math.floor(totalRuntimeSec / 60);
  const runtimeSecs = Math.round(totalRuntimeSec % 60);

  // Floating trigger when collapsed
  if (!isDrawerOpen) {
    return (
      <div className="fixed bottom-20 right-6 z-40 animate-bounce-subtle">
        <button
          onClick={openDrawer}
          className="flex items-center gap-2.5 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg shadow-xl border border-indigo-400/30 text-xs font-bold transition-all hover:scale-105 active:scale-95 cursor-pointer"
        >
          <Film size={16} />
          <span>Montage Reel ({clips.length})</span>
          <span className="px-1.5 py-0.5 rounded-md bg-black/30 font-mono text-[11px]">
            {runtimeMins}m {runtimeSecs}s
          </span>
          <ChevronUp size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-slate-950/95 backdrop-blur-xl border-t border-indigo-500/30 shadow-2xl transition-all duration-300">
      {/* Header bar */}
      <div className="px-6 py-3 border-b border-slate-800/80 flex items-center justify-between gap-4 flex-wrap bg-slate-900/40">
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-indigo-500/20 text-indigo-400 rounded-xl border border-indigo-500/30">
            <Film size={16} />
          </div>
          <div>
            <h3 className="font-bold text-white text-sm flex items-center gap-2">
              <span>Montage Reel & Sequencer</span>
              <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-300 rounded-full text-[11px] font-mono">
                {clips.length} clip{clips.length !== 1 ? 's' : ''}
              </span>
              <span className="text-slate-400 text-xs font-mono font-normal">
                • Total Runtime: <strong className="text-slate-200">{runtimeMins}m {runtimeSecs}s</strong>
              </span>
            </h3>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Gap pacing selector */}
          <div className="flex items-center gap-1.5 bg-slate-900/90 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-300">
            <Clock size={12} className="text-indigo-400" />
            <span className="text-[11px] text-slate-400">Pacing Gap:</span>
            <select
              value={gapSeconds}
              onChange={e => setGapSeconds(parseFloat(e.target.value))}
              className="bg-transparent text-white font-semibold focus:outline-none cursor-pointer text-xs"
            >
              <option value="0.1" className="bg-slate-900">0.1s (Hard cut)</option>
              <option value="0.3" className="bg-slate-900">0.3s (Rapid fire)</option>
              <option value="0.5" className="bg-slate-900">0.5s (Standard)</option>
              <option value="1.0" className="bg-slate-900">1.0s (Breath)</option>
              <option value="1.5" className="bg-slate-900">1.5s (Dramatic)</option>
            </select>
          </div>

          {/* AI Sort: the model picks the best running order */}
          <button
            onClick={runAiSort}
            disabled={!isSorting && clips.length < SORT_MIN_CLIPS}
            className={`flex items-center gap-1 px-3 py-1 rounded-xl text-xs font-semibold border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
              isSorting
                ? 'bg-amber-950/50 border-amber-500/40 text-amber-300 hover:bg-amber-900/60'
                : 'bg-transparent hover:bg-slate-800 text-slate-200 border-slate-700'
            }`}
            title={isSorting ? 'Cancel AI Sort' : 'Let the AI put the clips in the best running order (locked clips stay put, undo restores the old order)'}
          >
            {isSorting ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
            <span>{isSorting ? 'Sorting… (cancel)' : 'AI Sort'}</span>
          </button>

          {/* Auto-sort by escalation */}
          <button
            onClick={sortByEscalation}
            className="flex items-center gap-1 px-3 py-1 bg-transparent hover:bg-slate-800 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
            title="Automatically order drops from mild insults to severe threats and allegations"
          >
            <Sparkles size={12} />
            <span>Sort by Escalation</span>
          </button>

          {/* Clear montage */}
          <button
            onClick={clearClips}
            className="px-2.5 py-1 hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 border border-transparent hover:border-rose-500/30 rounded-lg text-xs transition-colors cursor-pointer"
            title="Clear all clips from montage"
          >
            <Trash2 size={13} />
          </button>

          {/* Collapse button */}
          <button
            onClick={closeDrawer}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            title="Minimize drawer"
          >
            <ChevronDown size={18} />
          </button>
        </div>
      </div>

      {sortMsg && (
        <div
          role="status"
          className={`px-6 py-1.5 border-b border-slate-800/80 flex items-center gap-2 text-xs ${
            sortMsg.kind === 'err'
              ? 'bg-rose-950/40 text-rose-300'
              : sortMsg.kind === 'ok'
                ? 'bg-indigo-950/30 text-indigo-200'
                : 'bg-slate-900/60 text-slate-300'
          }`}
        >
          {sortMsg.kind === 'ok' && <Wand2 size={12} className="shrink-0 text-indigo-400" />}
          <span className="flex-1 min-w-0 truncate" title={sortMsg.text}>
            {sortMsg.kind === 'ok' ? 'AI Sort: ' : ''}
            {sortMsg.text}
          </span>
          {sortMsg.kind === 'ok' && sortMsg.canUndo && canUndo && (
            <button
              onClick={() => {
                undo();
                setSortMsg({ kind: 'info', text: 'Previous order restored.' });
              }}
              className="flex items-center gap-1 px-2 py-0.5 rounded-lg border border-indigo-500/30 hover:bg-indigo-900/50 text-indigo-200 cursor-pointer"
            >
              <Undo2 size={11} />
              <span>Undo</span>
            </button>
          )}
          <button onClick={() => setSortMsg(null)} className="p-0.5 rounded hover:bg-slate-800 text-slate-400 cursor-pointer" title="Dismiss">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Audition Player & Export Toolbar */}
      <div className="px-6 py-2.5 bg-slate-900/60 border-b border-slate-800/80 flex items-center justify-between gap-4 flex-wrap text-xs">
        {/* Playback Audition Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={isAuditioning ? stopAudition : startAudition}
            disabled={clips.length === 0}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg font-bold transition-all shadow-md cursor-pointer ${
              isAuditioning
                ? 'bg-amber-500 text-slate-950'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700'
            }`}
          >
            {isAuditioning ? <Pause size={13} /> : <Play size={13} />}
            <span>{isAuditioning ? 'Pause Audition' : 'Audition Reel (Play All)'}</span>
          </button>

          {isAuditioning && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => skipAudition(Math.max(0, currentAuditionIndex - 1))}
                disabled={currentAuditionIndex === 0}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-300 disabled:opacity-30 cursor-pointer"
                title="Previous clip"
              >
                <SkipBack size={13} />
              </button>
              <span className="font-mono text-emerald-400 font-bold px-1.5 text-xs">
                Playing #{currentAuditionIndex + 1}/{clips.length}
              </span>
              <button
                onClick={() => skipAudition(Math.min(clips.length - 1, currentAuditionIndex + 1))}
                disabled={currentAuditionIndex >= clips.length - 1}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-300 disabled:opacity-30 cursor-pointer"
                title="Next clip"
              >
                <SkipForward size={13} />
              </button>
            </div>
          )}
        </div>

        {/* Audio Mastering Options */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setNormalizeAudio(!normalizeAudio)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
              normalizeAudio
                ? 'bg-indigo-950/70 border-indigo-500/60 text-indigo-300 shadow-sm'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
            title="Normalize audio peak volume to -1.0 dBFS across all clips to level whisper vs loud mic disparities"
          >
            <span className={`w-1.5 h-1.5 rounded-full ${normalizeAudio ? 'bg-indigo-400 animate-pulse' : 'bg-slate-600'}`} />
            <span>Normalize (-1dB)</span>
          </button>

          <button
            type="button"
            onClick={() => setAntiClickFades(!antiClickFades)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
              antiClickFades
                ? 'bg-emerald-950/70 border-emerald-500/60 text-emerald-300 shadow-sm'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
            title="Apply 12ms cosine micro-fades to eliminate digital clicks and pops at slice boundaries"
          >
            <span className={`w-1.5 h-1.5 rounded-full ${antiClickFades ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
            <span>Anti-Click Fades</span>
          </button>
        </div>

        {/* Master Export Options */}
        <div className="flex items-center gap-2">
          {isExporting ? (
            <div className="flex items-center gap-2 text-indigo-400 font-medium text-xs">
              <Loader2 size={14} className="animate-spin" />
              <span>{exportProgress}</span>
            </div>
          ) : (
            <>
              <button
                onClick={exportStitchedWav}
                disabled={clips.length === 0}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold shadow-md cursor-pointer transition-all active:scale-95 disabled:opacity-40"
                title="Download seamless stitched master audio file as lossless WAV"
              >
                <Download size={13} />
                <span>Export Stitched WAV</span>
              </button>
              <button
                onClick={exportAudacityLabels}
                disabled={clips.length === 0}
                className="flex items-center gap-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg border border-slate-700 transition-colors cursor-pointer"
                title="Export track markers for Audacity / DAW"
              >
                <FileText size={12} className="text-amber-400" />
                <span>Audacity Labels</span>
              </button>
              <button
                onClick={exportManifestJson}
                disabled={clips.length === 0}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg border border-slate-700 transition-colors cursor-pointer"
                title="Export JSON manifest"
              >
                <span>JSON</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Clip Sequence List (Horizontal Reel) */}
      <div className="p-4 overflow-x-auto max-h-56 scrollbar-thin">
        {clips.length === 0 ? (
          <div className="py-8 text-center text-slate-400 text-xs">
            <p>Your montage reel is empty.</p>
            <p className="mt-1">Click <strong>"+ Add to Montage"</strong> on any transcript turn or audio clip above to start assembling your sequence.</p>
          </div>
        ) : (
          <div className="flex items-stretch gap-3 min-w-max pb-2">
            {clips.map((clip, idx) => {
              const isPlayingThis = isAuditioning && currentAuditionIndex === idx;
              const clipDur = reelPlan.items[idx]?.effDur ?? Math.max(0.2, clip.endSec - clip.startSec);

              return (
                <div
                  key={clip.id}
                  className={`w-72 p-3 rounded-xl border transition-all flex flex-col justify-between relative ${
                    isPlayingThis
                      ? 'bg-slate-900 border-indigo-500 ring-2 ring-indigo-500/40'
                      : 'bg-slate-900/90 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div>
                    {/* Header: Rank, Category, Severity */}
                    <div className="flex items-center justify-between gap-1 mb-2">
                      <div className="flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded-md bg-slate-800 text-slate-200 font-mono text-[11px] font-bold flex items-center justify-center border border-slate-700">
                          {idx + 1}
                        </span>
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-800 text-slate-300">
                          <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${categoryDotClass(clip.category)}`} aria-hidden="true" />
                          {clip.category || 'Quote'}
                        </span>
                        {clip.severity && (
                          <span className="text-[11px] font-mono text-amber-400 font-bold">
                            ★{clip.severity}
                          </span>
                        )}
                      </div>

                      {/* Reorder and Delete controls */}
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => moveClip(clip.id, 'up')}
                          disabled={idx === 0}
                          className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white disabled:opacity-20 cursor-pointer"
                          title="Move earlier"
                        >
                          <ArrowUp size={11} />
                        </button>
                        <button
                          onClick={() => moveClip(clip.id, 'down')}
                          disabled={idx === clips.length - 1}
                          className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white disabled:opacity-20 cursor-pointer"
                          title="Move later"
                        >
                          <ArrowDown size={11} />
                        </button>
                        <button
                          onClick={() => removeClip(clip.id)}
                          className="p-1 rounded hover:bg-rose-950/60 text-slate-400 hover:text-rose-400 cursor-pointer transition-colors"
                          title="Remove clip"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>

                    {/* Quote preview */}
                    <p className="text-xs text-slate-200 font-medium italic line-clamp-3 leading-relaxed mb-2">
                      "{clip.quote}"
                    </p>
                  </div>

                  {/* Footer: Speaker and Duration */}
                  <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400 font-mono">
                    <span className="text-slate-300 font-sans font-semibold truncate max-w-[150px]">
                      {clip.speaker}
                    </span>
                    <span>{clipDur.toFixed(1)}s</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
