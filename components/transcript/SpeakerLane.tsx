import React, { useRef } from 'react';
import { formatSeconds } from '../../utils/transcriptData';

export interface LaneTurn {
  id: string;
  startSec: number;
  endSec: number | null;
  speaker: string;
}

export interface LaneBand {
  startSec: number;
  endSec: number;
  score: number;
}

export interface SpeakerLaneProps {
  turns: LaneTurn[];
  duration: number;
  /** null when this episode is not the one loaded in the player */
  currentTime: number | null;
  speakerFilter: string;
  getDotClass: (speaker: string) => string;
  hotMarks?: number[];
  bands?: LaneBand[];
  onBandClick?: (band: LaneBand) => void;
  onSeek: (sec: number) => void;
}

/** One coloured segment per turn, laid out on the episode timeline. Click anywhere to seek. */
export const SpeakerLane: React.FC<SpeakerLaneProps> = ({
  turns, duration, currentTime, speakerFilter, getDotClass, hotMarks, bands, onBandClick, onSeek,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const total = Math.max(1, duration);

  const seekFromEvent = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    onSeek(frac * total);
  };

  return (
    <div className="px-4 md:px-6 pt-3 bg-bg flex-shrink-0">
      <div
        ref={ref}
        onClick={seekFromEvent}
        className="relative h-14 rounded-lg border border-line bg-row overflow-hidden cursor-pointer"
        role="slider"
        aria-label="Episode timeline"
        aria-valuemin={0}
        aria-valuemax={Math.round(total)}
        aria-valuenow={Math.round(currentTime ?? 0)}
        tabIndex={0}
      >
        {bands?.map((b, i) => (
          <button
            key={`band-${i}`}
            type="button"
            title={`Suggested clip • score ${Math.round(b.score)} • ${formatSeconds(b.startSec)}`}
            onClick={e => { e.stopPropagation(); onBandClick?.(b); }}
            className="absolute top-0 h-full border-x border-a0/70 bg-a0 cursor-pointer z-[1] hover:brightness-125"
            style={{
              left: `${(b.startSec / total) * 100}%`,
              width: `max(3px, ${((b.endSec - b.startSec) / total) * 100}%)`,
              opacity: 0.12 + Math.min(1, Math.max(0, b.score / 100)) * 0.38,
            }}
          />
        ))}

        {turns.map(t => {
          const end = t.endSec !== null && t.endSec > t.startSec ? t.endSec : t.startSec + 2;
          const dim = speakerFilter !== 'ALL' && t.speaker !== speakerFilter;
          return (
            <div
              key={t.id}
              title={`${t.speaker} • ${formatSeconds(t.startSec)}`}
              className={`absolute top-3 bottom-3 rounded-[2px] transition-all hover:top-1.5 hover:bottom-1.5 ${getDotClass(t.speaker)} ${dim ? 'opacity-15' : 'opacity-90'}`}
              style={{ left: `${(t.startSec / total) * 100}%`, width: `max(2px, ${((end - t.startSec) / total) * 100}%)` }}
            />
          );
        })}

        {hotMarks?.map((s, i) => (
          <span
            key={`hot-${i}`}
            title={`Mentions • ${formatSeconds(s)}`}
            className="absolute bottom-0 h-1 bg-live pointer-events-none"
            style={{ left: `${(s / total) * 100}%`, width: 'max(3px, 1.2%)' }}
          />
        ))}

        {currentTime !== null && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_6px_rgba(255,255,255,0.7)] pointer-events-none z-[2]"
            style={{ left: `${Math.min(100, (currentTime / total) * 100)}%` }}
          />
        )}
      </div>
    </div>
  );
};
