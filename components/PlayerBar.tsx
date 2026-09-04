import React, { useState } from 'react';
import {
  Play,
  Pause,
  X,
  Music,
  RotateCcw,
  RotateCw,
  Volume2,
  Volume1,
  VolumeX,
  Download,
  Gauge
} from 'lucide-react';
import { usePlayer } from '../contexts/PlayerContext';

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const SPEED_OPTIONS = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

const PlayerBar: React.FC = () => {
  const {
    current,
    isPlaying,
    currentTime,
    duration,
    playbackRate,
    volume,
    isMuted,
    togglePlay,
    seek,
    skip,
    setPlaybackRate,
    setVolume,
    toggleMute,
    close
  } = usePlayer();

  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);

  if (!current) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 md:left-64 z-40 bg-slate-950/95 backdrop-blur-md border-t border-slate-800/80 px-4 py-2.5 shadow-2xl transition-all">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-3">
        
        {/* Left: Track Info */}
        <div className="flex items-center gap-3 min-w-0 w-full md:w-1/4">
          <div className="flex-shrink-0 w-9 h-9 flex items-center justify-center bg-indigo-600/20 border border-indigo-500/30 rounded-xl text-indigo-400 shadow-inner">
            <Music size={15} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-white truncate" title={current.title}>
              {current.title}
            </p>
            <p className="text-[11px] text-slate-400 truncate flex items-center gap-1.5 mt-0.5">
              <span>{formatTime(currentTime)}</span>
              <span className="text-slate-600">/</span>
              <span>{formatTime(duration)}</span>
              {current.durationLabel && (
                <>
                  <span className="text-slate-600">•</span>
                  <span className="text-indigo-300/80">{current.durationLabel}</span>
                </>
              )}
            </p>
          </div>
        </div>

        {/* Center: Controls & Scrubber */}
        <div className="flex-1 w-full md:max-w-2xl flex flex-col items-center gap-1.5">
          {/* Controls row */}
          <div className="flex items-center gap-3">
            {/* Skip Back 15s */}
            <button
              onClick={() => skip(-15)}
              className="group relative p-2 text-slate-400 hover:text-white hover:bg-slate-800/70 rounded-full transition-all cursor-pointer"
              title="Skip back 15 seconds (Left Arrow)"
              aria-label="Skip back 15 seconds"
            >
              <RotateCcw size={16} />
              <span className="absolute -bottom-1 -right-0.5 text-[8px] font-bold text-slate-400 group-hover:text-indigo-300">
                15
              </span>
            </button>

            {/* Play / Pause */}
            <button
              onClick={togglePlay}
              className="w-10 h-10 flex items-center justify-center bg-indigo-600 hover:bg-indigo-500 rounded-full text-white shadow-lg shadow-indigo-600/30 transition-all hover:scale-105 cursor-pointer"
              aria-label={isPlaying ? 'Pause' : 'Play (Space)'}
              title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            >
              {isPlaying ? <Pause size={18} /> : <Play size={18} className="translate-x-0.5" />}
            </button>

            {/* Skip Ahead 15s */}
            <button
              onClick={() => skip(15)}
              className="group relative p-2 text-slate-400 hover:text-white hover:bg-slate-800/70 rounded-full transition-all cursor-pointer"
              title="Skip ahead 15 seconds (Right Arrow)"
              aria-label="Skip ahead 15 seconds"
            >
              <RotateCw size={16} />
              <span className="absolute -bottom-1 -right-0.5 text-[8px] font-bold text-slate-400 group-hover:text-indigo-300">
                15
              </span>
            </button>

            {/* Playback Speed Selector */}
            <div className="relative ml-2">
              <button
                onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                className="px-2 py-1 text-[11px] font-semibold bg-slate-900 hover:bg-slate-800 text-indigo-300 border border-slate-800 hover:border-slate-700 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                title="Playback Speed"
              >
                <Gauge size={12} />
                <span>{playbackRate}x</span>
              </button>

              {showSpeedMenu && (
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-slate-900 border border-slate-800 rounded-xl p-1 shadow-2xl flex flex-col gap-0.5 z-50 min-w-[75px]">
                  {SPEED_OPTIONS.map(rate => (
                    <button
                      key={rate}
                      onClick={() => {
                        setPlaybackRate(rate);
                        setShowSpeedMenu(false);
                      }}
                      className={`px-3 py-1 text-xs rounded-lg text-center font-medium transition-colors cursor-pointer ${
                        playbackRate === rate
                          ? 'bg-indigo-600 text-white font-bold'
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      {rate}x
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Time Scrubber */}
          <div className="w-full flex items-center gap-2.5">
            <span className="text-[10px] text-slate-500 w-12 text-right tabular-nums flex-shrink-0">
              {formatTime(currentTime)}
            </span>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step="any"
              value={Math.min(currentTime, duration || 0)}
              onChange={e => seek(Number(e.target.value))}
              className="flex-1 h-1.5 accent-indigo-500 hover:accent-indigo-400 bg-slate-800 rounded-lg cursor-pointer transition-all"
              aria-label="Seek time"
            />
            <span className="text-[10px] text-slate-500 w-12 tabular-nums flex-shrink-0">
              {formatTime(duration)}
            </span>
          </div>
        </div>

        {/* Right: Volume & Actions */}
        <div className="flex items-center justify-end gap-2 w-full md:w-1/4">
          {/* Volume Control */}
          <div
            className="relative flex items-center gap-1.5"
            onMouseEnter={() => setShowVolumeSlider(true)}
            onMouseLeave={() => setShowVolumeSlider(false)}
          >
            <button
              onClick={toggleMute}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-900 rounded-lg transition-colors cursor-pointer"
              title={isMuted ? 'Unmute (M)' : 'Mute (M)'}
              aria-label="Toggle mute"
            >
              {isMuted || volume === 0 ? (
                <VolumeX size={16} className="text-red-400" />
              ) : volume < 0.5 ? (
                <Volume1 size={16} />
              ) : (
                <Volume2 size={16} />
              )}
            </button>

            {/* Volume slider */}
            <div
              className={`transition-all duration-200 flex items-center ${
                showVolumeSlider ? 'opacity-100 w-16' : 'opacity-0 w-0 pointer-events-none'
              }`}
            >
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={e => setVolume(parseFloat(e.target.value))}
                className="w-16 h-1 accent-indigo-500 bg-slate-800 rounded-lg cursor-pointer"
                aria-label="Volume slider"
              />
            </div>
          </div>

          {/* Download Audio */}
          {current.audioUrl && (
            <a
              href={current.audioUrl}
              download
              className="p-2 text-slate-400 hover:text-emerald-400 hover:bg-slate-900 rounded-lg transition-colors cursor-pointer"
              title="Download Audio File"
              aria-label="Download audio"
            >
              <Download size={16} />
            </a>
          )}

          {/* Close Player */}
          <button
            onClick={close}
            className="p-2 text-slate-500 hover:text-slate-300 hover:bg-slate-900 rounded-lg transition-colors cursor-pointer"
            aria-label="Close player"
            title="Close Player"
          >
            <X size={16} />
          </button>
        </div>

      </div>
    </div>
  );
};

export default PlayerBar;
