import React from 'react';
import { Clock, CheckCircle2, AlertTriangle, Sparkles } from 'lucide-react';
import { formatClock } from '../utils/sequencePlan';

interface Props {
  currentDurationSec: number;
  targetDurationSec: number;
  clipCount?: number;
  onSelectTarget?: (sec: number) => void;
}

export const TargetWindowGauge: React.FC<Props> = ({
  currentDurationSec,
  targetDurationSec,
  clipCount,
  onSelectTarget,
}) => {
  const current = Math.max(0, currentDurationSec);
  const target = Math.max(1, targetDurationSec);
  const delta = current - target;
  const ratio = current / target;
  const percentage = Math.round(ratio * 100);

  // States: On-Target is within +/- 5% (i.e. 95% to 105% of target window)
  const isOnTarget = ratio >= 0.95 && ratio <= 1.05;
  const isOverflow = ratio > 1.05;
  const isUnder = ratio < 0.95;

  const formattedCurrent = formatClock(current);
  const formattedTarget = formatClock(target);

  return (
    <div className="flex items-center gap-3 bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-2 text-xs">
      {clipCount !== undefined && (
        <>
          <div className="flex flex-col pr-1">
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Sequence</span>
            <span className="font-bold text-white text-xs">
              {clipCount} <span className="text-slate-400 font-normal text-[11px]">clip{clipCount !== 1 ? 's' : ''}</span>
            </span>
          </div>
          <div className="h-8 w-px bg-slate-800" />
        </>
      )}

      {/* Target Duration Selector Dropdown */}
      <div className="flex flex-col">
        <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Target Window</span>
        <select
          value={targetDurationSec}
          onChange={e => onSelectTarget?.(parseFloat(e.target.value))}
          className="bg-transparent text-indigo-300 font-bold focus:outline-none cursor-pointer text-xs"
        >
          <option value="60" className="bg-slate-900 text-white">60s (Teaser / Short)</option>
          <option value="90" className="bg-slate-900 text-white">90s (Standard Reel)</option>
          <option value="120" className="bg-slate-900 text-white">120s (Extended Trailer)</option>
          <option value="180" className="bg-slate-900 text-white">180s (3-Min Spotlight)</option>
          <option value="300" className="bg-slate-900 text-white">300s (5-Min Scene)</option>
        </select>
      </div>

      <div className="h-8 w-px bg-slate-800" />

      {/* Dynamic Progress Gauge & State Flags */}
      <div className="flex flex-col min-w-[240px] sm:min-w-[280px]">
        {/* Header Readout */}
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-1.5 font-mono">
            <Clock size={12} className={isOnTarget ? 'text-emerald-400' : isOverflow ? 'text-rose-400' : 'text-indigo-400'} />
            <span className="text-white font-bold text-xs">{formattedCurrent}</span>
            <span className="text-slate-500 text-[11px]">/ {formattedTarget}</span>
          </div>

          {/* Status Badge */}
          {isOnTarget && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold font-mono tracking-tight animate-pulse">
              <CheckCircle2 size={10} />
              <span>ON-TARGET (±5%) • {delta >= 0 ? `+${delta.toFixed(1)}s` : `${delta.toFixed(1)}s`}</span>
            </span>
          )}

          {isUnder && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 text-[10px] font-bold font-mono tracking-tight">
              <span>UNDER-BUDGET • -{Math.abs(delta).toFixed(1)}s ({percentage}%)</span>
            </span>
          )}

          {isOverflow && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[10px] font-bold font-mono tracking-tight">
              <AlertTriangle size={10} />
              <span>OVER-BUDGET • +{delta.toFixed(1)}s limit</span>
            </span>
          )}
        </div>

        {/* Segmented Progress Gauge Bar */}
        <div className="relative w-full h-2.5 bg-slate-900 border border-slate-800 rounded-full overflow-hidden">
          {/* Segment Tick Marks at 25%, 50%, 75% */}
          <div className="absolute inset-0 flex justify-between px-1 pointer-events-none z-10">
            <span className="w-px h-full bg-slate-800/80" style={{ left: '25%' }} />
            <span className="w-px h-full bg-slate-800/80" style={{ left: '50%' }} />
            <span className="w-px h-full bg-slate-800/80" style={{ left: '75%' }} />
          </div>

          {/* Optimal Target Window Zone Bracket (95% to 105%) */}
          <div
            className="absolute top-0 bottom-0 bg-emerald-500/15 border-l border-r border-emerald-400/40 z-10 pointer-events-none"
            style={{ left: '95%', width: '10%' }}
            title="Optimal target window (±5%)"
          />

          {/* Fill Bar */}
          <div
            className={`h-full transition-all duration-300 rounded-full ${
              isOverflow
                ? 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]'
                : isOnTarget
                ? 'bg-gradient-to-r from-emerald-500 to-teal-400 shadow-[0_0_10px_rgba(52,211,153,0.7)]'
                : 'bg-gradient-to-r from-indigo-600 via-indigo-500 to-cyan-400'
            }`}
            style={{ width: `${Math.min(100, (current / (target * 1.05)) * 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
};
