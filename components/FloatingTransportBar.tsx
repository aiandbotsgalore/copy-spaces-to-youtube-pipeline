import React, { useState } from 'react';
import {
  Play, Pause, SkipBack, SkipForward, Square, RotateCcw,
  Volume2, Clock, Keyboard, Sparkles, Sliders, ChevronUp, ChevronDown
} from 'lucide-react';
import { formatClock } from '../utils/sequencePlan';

interface Props {
  isPlaying: boolean;
  currentIndex: number;
  totalClips: number;
  currentClipTitle?: string;
  currentClipSpeaker?: string;
  elapsedSec: number;
  totalSec: number;
  onTogglePlay: () => void;
  onAuditionSolo: () => void;
  onPrev: () => void;
  onNext: () => void;
  onReset: () => void;
  normalizeAudio: boolean;
}

export const FloatingTransportBar: React.FC<Props> = ({
  isPlaying,
  currentIndex,
  totalClips,
  currentClipTitle,
  currentClipSpeaker,
  elapsedSec,
  totalSec,
  onTogglePlay,
  onAuditionSolo,
  onPrev,
  onNext,
  onReset,
  normalizeAudio,
}) => {
  const [showShortcuts, setShowShortcuts] = useState(false);

  const formattedElapsed = formatClock(elapsedSec);
  const formattedTotal = formatClock(totalSec);
  const remainingSec = Math.max(0, totalSec - elapsedSec);
  const formattedRemaining = formatClock(remainingSec);

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 max-w-xl w-[94%] sm:w-auto shadow-2xl animate-in fade-in slide-in-from-bottom-3 duration-200">
      <div className="bg-slate-900/95 backdrop-blur-xl border border-indigo-500/30 rounded-2xl p-2.5 px-4 shadow-[0_10px_35px_rgba(0,0,0,0.7)] flex items-center justify-between gap-3 text-xs">
        {/* Playback Controls */}
        <div className="flex items-center gap-1.5">
          {/* Reset / Rewind to 0:00 */}
          <button
            onClick={onReset}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            title="Rewind to start (Home)"
          >
            <RotateCcw size={14} />
          </button>

          {/* J - Previous Clip / Shuttle Back */}
          <button
            onClick={onPrev}
            disabled={currentIndex <= 0}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-25 transition-colors cursor-pointer"
            title="Previous Clip / Shuttle Back (J)"
          >
            <SkipBack size={15} />
          </button>

          {/* Space - Master Play / Pause Reel */}
          <button
            onClick={onTogglePlay}
            disabled={totalClips === 0}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl font-black text-xs shadow-md transition-all active:scale-95 cursor-pointer disabled:opacity-30 ${
              isPlaying
                ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-[0_0_15px_rgba(245,158,11,0.5)]'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.4)]'
            }`}
            title="Play/Pause Reel (Spacebar)"
          >
            {isPlaying ? <Pause size={15} /> : <Play size={15} />}
            <span>{isPlaying ? 'PAUSE' : 'PLAY REEL'}</span>
          </button>

          {/* L - Next Clip / Shuttle Forward */}
          <button
            onClick={onNext}
            disabled={currentIndex >= totalClips - 1}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-25 transition-colors cursor-pointer"
            title="Next Clip / Shuttle Forward (L)"
          >
            <SkipForward size={15} />
          </button>

          {/* Shift+Space - Audition Clip Solo */}
          <button
            onClick={onAuditionSolo}
            disabled={totalClips === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-[11px] border border-slate-700/80 transition-all cursor-pointer disabled:opacity-30"
            title="Audition Current Clip Solo (Shift+Space)"
          >
            <Volume2 size={13} className="text-indigo-400" />
            <span className="hidden sm:inline">Solo</span>
          </button>
        </div>

        <div className="h-6 w-px bg-slate-800" />

        {/* Live Sequence Timecode & Clip Info */}
        <div className="flex flex-col min-w-[140px]">
          <div className="flex items-center gap-1.5 font-mono text-white text-xs font-bold">
            <span className="text-emerald-400">{formattedElapsed}</span>
            <span className="text-slate-500 font-normal">/ {formattedTotal}</span>
            <span className="text-[10px] text-slate-400 font-normal">(-{formattedRemaining})</span>
          </div>
          <div className="text-[11px] text-slate-400 truncate max-w-[200px]">
            {totalClips > 0 ? (
              <span>
                <strong className="text-indigo-300">#{currentIndex + 1}/{totalClips}</strong>
                {currentClipSpeaker ? ` • ${currentClipSpeaker}` : ''}
              </span>
            ) : (
              <span>Empty Sequence</span>
            )}
          </div>
        </div>

        {/* Shortcuts Cheat Sheet Trigger */}
        <div className="relative">
          <button
            onClick={() => setShowShortcuts(!showShortcuts)}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            title="Keyboard shortcuts (Space, Shift+Space, J/K/L)"
          >
            <Keyboard size={15} />
          </button>

          {showShortcuts && (
            <div className="absolute bottom-full right-0 mb-3 w-64 bg-slate-900 border border-slate-700 rounded-xl p-3 shadow-2xl text-slate-300 text-[11px] space-y-1.5 z-50">
              <div className="font-bold text-white text-xs border-b border-slate-800 pb-1 mb-1 flex items-center justify-between">
                <span>Tactile Hotkeys</span>
                <span className="text-[10px] text-slate-400 font-mono">Montage Studio</span>
              </div>
              <div className="flex justify-between">
                <span className="font-mono text-indigo-300 font-bold bg-slate-800 px-1.5 py-0.5 rounded">Space</span>
                <span>Play / Pause Reel</span>
              </div>
              <div className="flex justify-between">
                <span className="font-mono text-indigo-300 font-bold bg-slate-800 px-1.5 py-0.5 rounded">Shift + Space</span>
                <span>Audition Current Clip</span>
              </div>
              <div className="flex justify-between">
                <span className="font-mono text-indigo-300 font-bold bg-slate-800 px-1.5 py-0.5 rounded">J / K / L</span>
                <span>Shuttle: Prev / Pause / Next</span>
              </div>
              <div className="flex justify-between">
                <span className="font-mono text-indigo-300 font-bold bg-slate-800 px-1.5 py-0.5 rounded">← / →</span>
                <span>Navigate Timeline Clips</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
