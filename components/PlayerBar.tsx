import React from 'react';
import { Play, Pause, X, Music } from 'lucide-react';
import { usePlayer } from '../contexts/PlayerContext';

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const PlayerBar: React.FC = () => {
  const { current, isPlaying, currentTime, duration, togglePlay, seek, close } = usePlayer();

  if (!current) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 md:left-64 z-40 bg-slate-950/95 backdrop-blur border-t border-slate-800 px-4 py-2.5 flex items-center gap-3">
      <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-indigo-500/15 rounded-full">
        <Music size={14} className="text-indigo-400" />
      </div>

      <button
        onClick={togglePlay}
        className="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-indigo-600 hover:bg-indigo-500 rounded-full text-white transition-colors"
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? <Pause size={14} /> : <Play size={14} className="translate-x-0.5" />}
      </button>

      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-white truncate">{current.title}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[10px] text-slate-500 w-8 flex-shrink-0">{formatTime(currentTime)}</span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            value={Math.min(currentTime, duration || 0)}
            onChange={e => seek(Number(e.target.value))}
            className="flex-1 h-1 accent-indigo-500 cursor-pointer"
          />
          <span className="text-[10px] text-slate-500 w-8 flex-shrink-0">{formatTime(duration)}</span>
        </div>
      </div>

      <button
        onClick={close}
        className="flex-shrink-0 p-1.5 text-slate-500 hover:text-slate-300 hover:bg-slate-900 rounded-lg transition-colors"
        aria-label="Close player"
      >
        <X size={14} />
      </button>
    </div>
  );
};

export default PlayerBar;
