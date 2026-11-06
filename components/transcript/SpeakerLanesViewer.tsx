import React, { useMemo, useRef } from 'react';
import { Users, Clock, Filter } from 'lucide-react';
import { formatSeconds } from '../../utils/transcriptData';
import { SpeakerLane, LaneTurn, LaneBand } from './SpeakerLane';
import { SavedSpeaker } from './useTranscriptSession';

export interface SpeakerLanesViewerProps {
  turns: LaneTurn[];
  duration: number;
  currentTime: number | null;
  speakerFilter: string;
  onSelectSpeakerFilter: (speaker: string) => void;
  getDotClass: (speaker: string) => string;
  savedSpeakers?: SavedSpeaker[];
  bands?: LaneBand[];
  onBandClick?: (band: LaneBand) => void;
  onSeek: (sec: number) => void;
  audioDurationSec?: number | null;
}

export const SpeakerLanesViewer: React.FC<SpeakerLanesViewerProps> = ({
  turns,
  duration,
  currentTime,
  speakerFilter,
  onSelectSpeakerFilter,
  getDotClass,
  savedSpeakers = [],
  bands,
  onBandClick,
  onSeek,
  audioDurationSec,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const totalDuration = Math.max(1, audioDurationSec || duration);

  // Group turns by speaker for speaker summary stats
  const speakerStats = useMemo(() => {
    const stats: Record<string, { count: number; totalSec: number }> = {};
    for (const turn of turns) {
      const spk = turn.speaker || 'Unknown';
      if (!stats[spk]) stats[spk] = { count: 0, totalSec: 0 };
      stats[spk].count++;
      const end = turn.endSec !== null && turn.endSec > turn.startSec ? turn.endSec : turn.startSec + 3;
      stats[spk].totalSec += (end - turn.startSec);
    }
    return Object.entries(stats).sort((a, b) => b[1].totalSec - a[1].totalSec);
  }, [turns]);

  return (
    <div className="bg-slate-900/90 border-b border-slate-800/80 px-4 md:px-6 py-2.5 space-y-2 flex-shrink-0" ref={containerRef}>
      <div className="flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-300 flex items-center gap-1.5">
            <Users size={13} className="text-indigo-400" />
            Diarization Timeline
          </span>
          <span className="text-[11px] text-slate-400">
            {turns.length} turns • {speakerStats.length} speaker{speakerStats.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="flex items-center gap-3 text-[11px] text-slate-400">
          {currentTime !== null && (
            <span className="flex items-center gap-1 font-mono text-slate-200">
              <Clock size={11} className="text-emerald-400" />
              {formatSeconds(currentTime)} / {formatSeconds(totalDuration)}
            </span>
          )}
          {speakerFilter !== 'ALL' && (
            <button
              onClick={() => onSelectSpeakerFilter('ALL')}
              className="text-amber-400 hover:text-amber-300 flex items-center gap-1 cursor-pointer"
            >
              <Filter size={10} />
              Reset ({speakerFilter})
            </button>
          )}
        </div>
      </div>

      {/* Main Single-Track Overview Lane */}
      <SpeakerLane
        turns={turns}
        duration={totalDuration}
        currentTime={currentTime}
        speakerFilter={speakerFilter}
        getDotClass={getDotClass}
        bands={bands}
        onBandClick={onBandClick}
        onSeek={onSeek}
      />

      {/* Speaker Breakdown Pills */}
      {speakerStats.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 pt-1 text-[11px]">
          <button
            onClick={() => onSelectSpeakerFilter('ALL')}
            className={`px-2 py-0.5 rounded-md font-medium transition-colors cursor-pointer ${
              speakerFilter === 'ALL'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            All ({turns.length})
          </button>
          {speakerStats.map(([spk, data]) => {
            const isSelected = speakerFilter === spk;
            const dotClass = getDotClass(spk);
            const saved = savedSpeakers.find(s => s.name.toLowerCase() === spk.toLowerCase());
            return (
              <button
                key={spk}
                onClick={() => onSelectSpeakerFilter(isSelected ? 'ALL' : spk)}
                className={`px-2 py-0.5 rounded-md font-medium flex items-center gap-1.5 transition-colors cursor-pointer border ${
                  isSelected
                    ? 'bg-slate-800 border-indigo-500 text-white shadow-sm ring-1 ring-indigo-400'
                    : 'bg-slate-950/60 border-slate-800/80 text-slate-400 hover:text-slate-200'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${dotClass}`} />
                <span>{saved?.avatarEmoji || ''} {spk}</span>
                <span className="text-[10px] opacity-60">({data.count})</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
