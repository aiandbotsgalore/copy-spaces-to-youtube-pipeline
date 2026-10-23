import React from 'react';
import { ChevronUp, Layers } from 'lucide-react';
import { useMontage } from '../../contexts/MontageContext';

const fmt = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
};

/** Sidebar footer chip: how much is on the Reel; opens the reel drawer. */
export const ReelChip: React.FC = () => {
  const { clips, isDrawerOpen, toggleDrawer } = useMontage();
  const active = clips.filter(c => !c.isExcluded);
  const total = active.reduce((sum, c) => sum + Math.max(0, c.endSec - c.startSec), 0);

  return (
    <button
      onClick={toggleDrawer}
      aria-expanded={isDrawerOpen}
      title="Open the Reel"
      className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-a1/50 bg-a1/10 text-left hover:bg-a1/15 transition-colors cursor-pointer"
    >
      <Layers size={15} className="text-a0 flex-shrink-0" />
      <span className="flex-1 min-w-0 text-[13px] font-semibold text-white truncate">
        Reel: {active.length} clip{active.length === 1 ? '' : 's'}
        {active.length > 0 && <span className="font-mono font-normal text-slate-300"> · {fmt(total)}</span>}
      </span>
      <ChevronUp size={14} className={`text-slate-400 transition-transform ${isDrawerOpen ? '' : 'rotate-180'}`} />
    </button>
  );
};
