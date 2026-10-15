import React, { useRef, useMemo, useState, useEffect, useCallback } from 'react';
import { RotateCcw, Volume2, Scissors } from 'lucide-react';
import { MontageClipItem } from '../contexts/MontageContext';

interface Props {
  clip: MontageClipItem;
  isPlaying?: boolean;
  playheadProgress?: number; // 0.0 to 1.0 within the active [startSec, endSec] window
  onTrimStart: (newStartSec: number) => void;
  onTrimEnd: (newEndSec: number) => void;
  onResetTrim?: () => void;
  onSeekPreview?: (timeSec: number) => void;
}

export const VisualWaveformTrim: React.FC<Props> = ({
  clip,
  isPlaying = false,
  playheadProgress = 0,
  onTrimStart,
  onTrimEnd,
  onResetTrim,
  onSeekPreview,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [activeHandle, setActiveHandle] = useState<'start' | 'end' | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);

  // Compute the visible timeline bounds around this clip
  const origStart = clip.origStartSec ?? clip.startSec;
  const origEnd = clip.origEndSec ?? clip.endSec;
  const padding = Math.max(1.0, (origEnd - origStart) * 0.15);
  const spanStart = Math.max(0, Math.min(clip.startSec, origStart) - padding);
  const spanEnd = Math.max(clip.endSec, origEnd) + padding;
  const spanDuration = Math.max(0.5, spanEnd - spanStart);

  // Generate deterministic realistic pseudo-waveform bars
  const approxDur = Math.max(1, Math.round((clip.origEndSec ?? clip.endSec) - (clip.origStartSec ?? clip.startSec)));
  const bars = useMemo(() => {
    const numBars = 54;
    const seedStr = `${clip.id}_${clip.quoteId || ''}_${approxDur}`;
    let hash = 0;
    for (let i = 0; i < seedStr.length; i++) {
      hash = (hash << 5) - hash + seedStr.charCodeAt(i);
      hash |= 0;
    }
    const result: number[] = [];
    for (let i = 0; i < numBars; i++) {
      const pseudo = Math.abs(Math.sin((hash + i * 37) * 0.15));
      const naturalSpeechEnvelope = Math.sin((i / numBars) * Math.PI); // vocal arch
      const heightPct = Math.max(15, Math.min(95, Math.round((pseudo * 0.7 + naturalSpeechEnvelope * 0.3) * 100)));
      result.push(heightPct);
    }
    return result;
  }, [clip.id, clip.quoteId, approxDur]);

  // Compute percentage positions for in-point and out-point
  const inPct = Math.max(0, Math.min(100, ((clip.startSec - spanStart) / spanDuration) * 100));
  const outPct = Math.max(0, Math.min(100, ((clip.endSec - spanStart) / spanDuration) * 100));
  const activeWidthPct = Math.max(1, outPct - inPct);

  // Active playhead needle position
  const needlePct = inPct + Math.max(0, Math.min(1, playheadProgress)) * activeWidthPct;

  // Handle Dragging
  const handlePointerDown = (handle: 'start' | 'end', e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setActiveHandle(handle);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!activeHandle || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const xPct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetTime = spanStart + xPct * spanDuration;

    if (activeHandle === 'start') {
      const boundedStart = Math.max(0, Math.min(clip.endSec - 0.2, targetTime));
      onTrimStart(parseFloat(boundedStart.toFixed(2)));
    } else if (activeHandle === 'end') {
      const boundedEnd = Math.max(clip.startSec + 0.2, targetTime);
      onTrimEnd(parseFloat(boundedEnd.toFixed(2)));
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (activeHandle) {
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
      setActiveHandle(null);
    }
  };

  const handleContainerClick = (e: React.MouseEvent) => {
    if (!containerRef.current || activeHandle) return;
    const rect = containerRef.current.getBoundingClientRect();
    const xPct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const clickTime = spanStart + xPct * spanDuration;
    if (clickTime >= clip.startSec && clickTime <= clip.endSec) {
      onSeekPreview?.(clickTime);
    }
  };

  const isTrimmed =
    (clip.origStartSec !== undefined && Math.abs(clip.startSec - clip.origStartSec) >= 0.05) ||
    (clip.origEndSec !== undefined && Math.abs(clip.endSec - clip.origEndSec) >= 0.05);

  const effectiveDur = Math.max(0.1, clip.endSec - clip.startSec);

  return (
    <div className="space-y-1.5 select-none pt-2 border-t border-slate-800/80">
      {/* Waveform Scrubber Box */}
      <div
        ref={containerRef}
        onClick={handleContainerClick}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="relative h-14 bg-slate-950/90 border border-slate-800/90 rounded-xl overflow-hidden cursor-crosshair group shadow-inner"
      >
        {/* Mask for trimmed-away leading audio */}
        <div
          className="absolute top-0 bottom-0 left-0 bg-slate-950/80 border-r border-indigo-500/40 z-10 pointer-events-none"
          style={{ width: `${inPct}%` }}
        >
          <div className="absolute inset-0 bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:6px_6px] opacity-40" />
        </div>

        {/* Mask for trimmed-away trailing audio */}
        <div
          className="absolute top-0 bottom-0 right-0 bg-slate-950/80 border-l border-indigo-500/40 z-10 pointer-events-none"
          style={{ width: `${100 - outPct}%` }}
        >
          <div className="absolute inset-0 bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:6px_6px] opacity-40" />
        </div>

        {/* Highlighted Active Audio Window */}
        <div
          className={`absolute top-0 bottom-0 z-0 transition-colors pointer-events-none ${
            isPlaying ? 'bg-emerald-500/10' : 'bg-indigo-500/10'
          }`}
          style={{ left: `${inPct}%`, width: `${activeWidthPct}%` }}
        />

        {/* Waveform Bars Container */}
        <div className="absolute inset-0 flex items-center justify-between px-2 gap-0.5">
          {bars.map((height, i) => {
            const barPct = (i / bars.length) * 100;
            const isInside = barPct >= inPct && barPct <= outPct;
            return (
              <div
                key={i}
                className="flex-1 flex items-center justify-center h-full"
              >
                <div
                  className={`w-full rounded-full transition-all duration-150 ${
                    isInside
                      ? isPlaying
                        ? 'bg-gradient-to-t from-emerald-500 to-teal-300 shadow-[0_0_4px_rgba(52,211,153,0.5)]'
                        : 'bg-gradient-to-t from-indigo-500 to-cyan-300'
                      : 'bg-slate-700/40'
                  }`}
                  style={{ height: `${height}%` }}
                />
              </div>
            );
          })}
        </div>

        {/* Real-Time Playing Needle Playhead */}
        {isPlaying && (
          <div
            className="absolute top-0 bottom-0 z-30 pointer-events-none flex flex-col items-center transition-[left] duration-75"
            style={{ left: `${needlePct}%` }}
          >
            <div className="w-2.5 h-2.5 bg-emerald-400 rotate-45 -mt-1 shadow-[0_0_8px_#34d399]" />
            <div className="w-0.5 h-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
          </div>
        )}

        {/* Left In-Point Trim Handle */}
        <div
          onPointerDown={e => handlePointerDown('start', e)}
          className="absolute top-0 bottom-0 w-3 -ml-1.5 z-20 cursor-ew-resize flex items-center justify-center group/handle"
          style={{ left: `${inPct}%` }}
          title={`In-Point: ${clip.startSec.toFixed(1)}s (drag to adjust)`}
        >
          <div className="w-1.5 h-7 bg-indigo-400 group-hover/handle:bg-white rounded-full shadow-lg border border-slate-900 transition-transform group-hover/handle:scale-125" />
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 opacity-0 group-hover/handle:opacity-100 bg-slate-900 border border-indigo-400 text-indigo-200 text-[9px] font-mono font-bold px-1 rounded pointer-events-none whitespace-nowrap">
            In: {clip.startSec.toFixed(1)}s
          </div>
        </div>

        {/* Right Out-Point Trim Handle */}
        <div
          onPointerDown={e => handlePointerDown('end', e)}
          className="absolute top-0 bottom-0 w-3 -ml-1.5 z-20 cursor-ew-resize flex items-center justify-center group/handle"
          style={{ left: `${outPct}%` }}
          title={`Out-Point: ${clip.endSec.toFixed(1)}s (drag to adjust)`}
        >
          <div className="w-1.5 h-7 bg-indigo-400 group-hover/handle:bg-white rounded-full shadow-lg border border-slate-900 transition-transform group-hover/handle:scale-125" />
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 opacity-0 group-hover/handle:opacity-100 bg-slate-900 border border-indigo-400 text-indigo-200 text-[9px] font-mono font-bold px-1 rounded pointer-events-none whitespace-nowrap">
            Out: {clip.endSec.toFixed(1)}s
          </div>
        </div>
      </div>

      {/* Micro-Trim Labels & Boundary Readout */}
      <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-slate-300">
            <span className="text-[10px] text-slate-500 uppercase font-bold">In:</span>
            <strong className="text-white">{clip.startSec.toFixed(2)}s</strong>
          </span>
          <span className="flex items-center gap-1 text-slate-300">
            <span className="text-[10px] text-slate-500 uppercase font-bold">Out:</span>
            <strong className="text-white">{clip.endSec.toFixed(2)}s</strong>
          </span>
          <span className="text-indigo-400 font-bold">
            Len: {effectiveDur.toFixed(2)}s
          </span>
        </div>

        <div className="flex items-center gap-2">
          {isTrimmed && (
            <>
              <span className="text-amber-300 text-[10px]">
                trimmed {(Math.max(0, (clip.origEndSec ?? clip.endSec) - (clip.origStartSec ?? clip.startSec) - effectiveDur)).toFixed(1)}s
              </span>
              {onResetTrim && (
                <button
                  onClick={onResetTrim}
                  className="inline-flex items-center gap-1 text-[10px] text-slate-400 hover:text-white underline font-normal cursor-pointer"
                  title="Restore original bounds"
                >
                  <RotateCcw size={10} />
                  <span>Reset</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
