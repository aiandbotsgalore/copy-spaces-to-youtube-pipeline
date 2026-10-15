import React, { useRef, useState } from 'react';
import { Clock, RotateCcw, SlidersHorizontal, ArrowLeftRight } from 'lucide-react';

interface Props {
  gapSec: number;
  isCustom: boolean;
  defaultGapSec: number;
  onSetGap: (gapSec: number | undefined) => void;
}

export const SilenceGapBlock: React.FC<Props> = ({
  gapSec,
  isCustom,
  defaultGapSec,
  onSetGap,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);
  const startGapRef = useRef(gapSec);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    startXRef.current = e.clientX;
    startGapRef.current = gapSec;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const deltaX = e.clientX - startXRef.current;
    // 100px drag = 1.0s change
    const deltaSec = deltaX / 100;
    const newGap = Math.max(0, Math.min(3.0, Math.round((startGapRef.current + deltaSec) * 20) / 20));
    onSetGap(newGap);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDragging) {
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
      setIsDragging(false);
    }
  };

  const snapOptions = [0.1, 0.35, 0.5, 1.0];

  return (
    <div className="relative py-2 px-4 flex items-center justify-center gap-2 group select-none">
      {/* Dashed room tone line (left) */}
      <div className="flex-1 flex items-center gap-1 overflow-hidden opacity-30 group-hover:opacity-60 transition-opacity">
        <div className="h-px w-full bg-gradient-to-r from-transparent via-slate-600 to-indigo-500/50" />
        <span className="w-1.5 h-1.5 rounded-full bg-slate-600 flex-shrink-0" />
      </div>

      {/* Tactile Silence Drag Pill */}
      <div
        className={`flex items-center gap-2 px-3 py-1 rounded-xl border text-[11px] font-mono transition-all shadow-sm ${
          isCustom
            ? 'bg-indigo-950/70 border-indigo-500/50 text-indigo-200'
            : 'bg-slate-900/80 border-slate-800 text-slate-400 group-hover:border-slate-700'
        }`}
      >
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="flex items-center gap-1 cursor-ew-resize hover:text-white transition-colors"
          title="Drag horizontally to adjust spacing"
        >
          <ArrowLeftRight size={11} className={isDragging ? 'text-indigo-400 animate-pulse' : 'text-slate-500'} />
          <span className="font-bold">
            {gapSec.toFixed(2)}s silence
          </span>
        </div>

        {/* Quick Snap Pills */}
        <div className="hidden sm:flex items-center gap-1 border-l border-slate-800/80 pl-2">
          {snapOptions.map(snap => (
            <button
              key={snap}
              onClick={() => onSetGap(snap)}
              className={`px-1.5 py-0.2 rounded text-[10px] transition-colors cursor-pointer ${
                Math.abs(gapSec - snap) < 0.03
                  ? 'bg-indigo-600 text-white font-bold'
                  : 'bg-slate-950/60 hover:bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
              title={`Snap to ${snap}s`}
            >
              {snap}s
            </button>
          ))}
        </div>

        {/* Reset to Global Gap */}
        {isCustom && (
          <button
            onClick={() => onSetGap(undefined)}
            className="text-slate-400 hover:text-white transition-colors cursor-pointer ml-0.5"
            title={`Reset to global default (${defaultGapSec.toFixed(2)}s)`}
          >
            <RotateCcw size={10} />
          </button>
        )}
      </div>

      {/* Dashed room tone line (right) */}
      <div className="flex-1 flex items-center gap-1 overflow-hidden opacity-30 group-hover:opacity-60 transition-opacity">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-600 flex-shrink-0" />
        <div className="h-px w-full bg-gradient-to-l from-transparent via-slate-600 to-indigo-500/50" />
      </div>
    </div>
  );
};
