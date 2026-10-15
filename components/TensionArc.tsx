import React from 'react';
import { buildSequencePlan, formatClock } from '../utils/sequencePlan';
import type { PlanClip } from '../utils/sequencePlan';

interface ArcClip extends PlanClip {
  id: string;
  tensionScore?: number;
  quoteId?: string;
  title?: string;
  speaker?: string;
}

/**
 * Tension Arc: one bar per clip, width proportional to its real duration, height to the Director's tension score.
 * Uses buildSequencePlan, so the geometry always matches what is heard and exported.
 */
export const TensionArc: React.FC<{
  clips: ArcClip[];
  defaultGapSec: number;
  currentIndex?: number;
  isPlaying?: boolean;
  onSelect?: (index: number) => void;
}> = ({ clips, defaultGapSec, currentIndex, isPlaying, onSelect }) => {
  if (clips.length === 0 || !clips.some(c => typeof c.tensionScore === 'number')) return null;
  const plan = buildSequencePlan<ArcClip>(clips, defaultGapSec);
  if (plan.totalSec <= 0) return null;

  const W = 1000;
  const H = 64;
  const PAD = 4;
  const x = (sec: number) => (sec / plan.totalSec) * W;

  return (
    <div className="px-5 pt-3 pb-1" aria-label="Tension arc">
      <div className="flex items-center justify-between text-[11px] uppercase font-semibold text-slate-400 mb-1">
        <span>Tension arc</span>
        <span className="font-mono normal-case text-slate-400">{formatClock(plan.totalSec)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-14 rounded-lg bg-slate-900/70 border border-slate-800">
        {plan.items.map(it => {
          const score = typeof it.clip.tensionScore === 'number' ? Math.min(10, Math.max(1, it.clip.tensionScore)) : undefined;
          const h = score === undefined ? 4 : PAD + ((H - PAD * 2) * score) / 10;
          const active = isPlaying && currentIndex === it.index;
          const w = Math.max(2, x(it.effDur) - 1);
          return (
            <g key={it.clip.id} onClick={() => onSelect?.(it.index)} style={{ cursor: onSelect ? 'pointer' : 'default' }}>
              <title>{`#${it.index + 1} ${it.clip.speaker || ''} · ${it.effDur.toFixed(1)}s${score ? ` · tension ${score}/10` : ''}`}</title>
              <rect
                x={x(it.timelineStart)}
                y={H - h}
                width={w}
                height={h}
                rx={2}
                className={active ? 'fill-emerald-400' : score === undefined ? 'fill-slate-600' : 'fill-indigo-500'}
                opacity={active ? 1 : 0.85}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
};

export default TensionArc;
