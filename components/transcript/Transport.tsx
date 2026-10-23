import React, { useState } from 'react';
import { Clock, Headphones, Pause, Play } from 'lucide-react';
import { formatSeconds } from '../../utils/transcriptData';

type NumSetter = (v: number | ((prev: number) => number)) => void;

export interface TransportProps {
  canPlay: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  onToggle: () => void;
  onSkip: (seconds: number) => void;
  timeOffsetSec: number;
  audioSeekOffsetSec: number;
  onTimeOffset: NumSetter;
  onAudioSeekOffset: NumSetter;
  activeLabel?: string;
}

const skipBtn = 'px-2.5 py-1 rounded-md text-[11px] font-mono font-semibold text-slate-300 hover:text-white hover:bg-line/60 cursor-pointer';
const nudge = 'px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold bg-card text-slate-300 hover:text-white cursor-pointer';

export const Transport: React.FC<TransportProps> = (p) => {
  const [showSync, setShowSync] = useState(false);
  const dirty = p.timeOffsetSec !== 0 || p.audioSeekOffsetSec !== 0;

  return (
    <div className="bg-bg border-b border-line flex-shrink-0">
      <div className="px-4 md:px-6 py-2 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <span className="font-mono text-xs text-slate-300 tabular-nums">{formatSeconds(p.currentTime)}</span>

        <div className="flex items-center gap-1 bg-row border border-line rounded-xl px-1.5 py-1">
          <button onClick={() => p.onSkip(-15)} disabled={!p.canPlay} className={skipBtn} title="Back 15s">-15s</button>
          <button
            onClick={p.onToggle}
            disabled={!p.canPlay}
            title={p.isPlaying ? 'Pause' : 'Play'}
            aria-label={p.isPlaying ? 'Pause' : 'Play'}
            className="w-9 h-9 rounded-full bg-a1 hover:brightness-110 disabled:opacity-40 text-white flex items-center justify-center cursor-pointer"
          >
            {p.isPlaying ? <Pause size={15} /> : <Play size={15} className="translate-x-px" />}
          </button>
          <button onClick={() => p.onSkip(15)} disabled={!p.canPlay} className={skipBtn} title="Forward 15s">+15s</button>
          <button
            onClick={() => setShowSync(s => !s)}
            title="Sync offsets"
            aria-pressed={showSync}
            className={`ml-1 p-1.5 rounded-md cursor-pointer ${showSync || dirty ? 'text-a0 bg-a1/15' : 'text-slate-400 hover:text-white'}`}
          >
            <Clock size={14} />
          </button>
        </div>

        <span className="font-mono text-xs text-slate-400 tabular-nums text-right">
          {p.duration > 0 ? formatSeconds(p.duration) : ''}
        </span>
      </div>

      {showSync && (
        <div className="px-4 md:px-6 pb-2.5 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 bg-row border border-line rounded-lg px-2.5 py-1" title="Compensate when audio plays ahead of or behind the text">
            <Headphones size={12} className={p.audioSeekOffsetSec !== 0 ? 'text-a0' : 'text-slate-400'} />
            <input
              type="number" step="0.5" value={p.audioSeekOffsetSec}
              onChange={e => { const n = Number.parseFloat(e.target.value); p.onAudioSeekOffset(Number.isFinite(n) ? n : 0); }}
              className="w-14 px-1 py-0.5 text-center text-xs font-mono bg-bg border border-line rounded text-white focus:outline-none focus:border-a1"
              aria-label="Audio seek offset in seconds"
            />
            <span className="text-[11px] font-mono text-slate-500">s</span>
            <button className={nudge} onClick={() => p.onAudioSeekOffset(0)}>0</button>
            <button className={nudge} onClick={() => p.onAudioSeekOffset(15)}>+15</button>
            <button className={nudge} onClick={() => p.onAudioSeekOffset(v => Number((v - 1).toFixed(1)))}>-1</button>
            <button className={nudge} onClick={() => p.onAudioSeekOffset(v => Number((v + 1).toFixed(1)))}>+1</button>
          </div>

          <div className="flex items-center gap-1.5 bg-row border border-line rounded-lg px-2.5 py-1" title="Shift the transcript against the audio">
            <Clock size={12} className={p.timeOffsetSec !== 0 ? 'text-a0' : 'text-slate-400'} />
            <input
              type="number" step="0.1" value={p.timeOffsetSec}
              onChange={e => { const n = Number.parseFloat(e.target.value); p.onTimeOffset(Number.isFinite(n) ? n : 0); }}
              className="w-16 px-1 py-0.5 text-center text-xs font-mono bg-bg border border-line rounded text-white focus:outline-none focus:border-a1"
              aria-label="Transcript sync offset in seconds"
            />
            <span className="text-[11px] font-mono text-slate-500">s</span>
            <button className={nudge} onClick={() => p.onTimeOffset(v => Number((v - 1).toFixed(3)))}>-1</button>
            <button className={nudge} onClick={() => p.onTimeOffset(v => Number((v - 0.1).toFixed(3)))}>-0.1</button>
            <button className={nudge} onClick={() => p.onTimeOffset(v => Number((v + 0.1).toFixed(3)))}>+0.1</button>
            <button className={nudge} onClick={() => p.onTimeOffset(v => Number((v + 1).toFixed(3)))}>+1</button>
            {p.timeOffsetSec !== 0 && <button className={`${nudge} !text-amber`} onClick={() => p.onTimeOffset(0)}>Reset</button>}
          </div>

          {p.isPlaying && p.activeLabel && (
            <span className="text-[11px] font-mono text-slate-400" title="Currently highlighted segment">{p.activeLabel}</span>
          )}
        </div>
      )}
    </div>
  );
};
