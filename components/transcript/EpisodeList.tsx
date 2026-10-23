import React, { useMemo, useState } from 'react';
import { Globe, Menu, Volume2, X } from 'lucide-react';
import { Release } from '../../types';
import { getEpisodeRecordedDate } from '../../utils/dates';

export type EpisodeStatus = 'ready' | 'audio' | 'queued';
type Filter = 'all' | 'ready' | 'audio';

export interface EpisodeListProps {
  releases: Release[];
  selectedId: number | string | null;
  globalActive: boolean;
  totalLabel: string;
  getStatus: (release: Release) => EpisodeStatus;
  getRuntimeLabel?: (release: Release) => string | undefined;
  getHandle?: (release: Release) => string | undefined;
  playingId?: number | string | null;
  onSelect: (release: Release) => void;
  onOpenGlobal: () => void;
  className?: string;
}

const DOT: Record<EpisodeStatus, string> = {
  ready: 'bg-emerald',
  audio: 'bg-slate-500',
  queued: 'bg-amber',
};

const STATUS_TITLE: Record<EpisodeStatus, string> = {
  ready: 'Transcript ready',
  audio: 'Audio only',
  queued: 'Queued for transcription',
};

export const EpisodeList: React.FC<EpisodeListProps> = ({
  releases, selectedId, globalActive, totalLabel, getStatus, getRuntimeLabel, getHandle,
  playingId, onSelect, onOpenGlobal, className = '',
}) => {
  const [filter, setFilter] = useState<Filter>('all');

  const rows = useMemo(
    () => releases.map(r => ({ release: r, status: getStatus(r) })),
    [releases, getStatus],
  );
  const counts = useMemo(() => ({
    all: rows.length,
    ready: rows.filter(r => r.status === 'ready').length,
    audio: rows.filter(r => r.status !== 'ready').length,
  }), [rows]);
  const visible = useMemo(() => rows.filter(r => (
    filter === 'all' ? true : filter === 'ready' ? r.status === 'ready' : r.status !== 'ready'
  )), [rows, filter]);

  const chips: { key: Filter; label: string; dot?: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'ready', label: 'Ready', dot: 'bg-emerald' },
    { key: 'audio', label: 'Audio', dot: 'bg-amber' },
  ];

  return (
    <div className={`flex flex-col min-h-0 bg-bg border-r border-line ${className}`}>
      <div className="p-2.5 border-b border-line flex-shrink-0">
        <button
          onClick={onOpenGlobal}
          title="Search every transcript"
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left transition-colors cursor-pointer ${
            globalActive ? 'border-a1 bg-a1/15 text-white' : 'border-line bg-row text-slate-300 hover:border-slate-600'
          }`}
        >
          <Globe size={14} className="text-a0 flex-shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold truncate">Search all transcripts</span>
            <span className="block text-[11px] font-mono text-slate-400 truncate">{totalLabel}</span>
          </span>
        </button>
      </div>

      <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-line flex-shrink-0">
        {chips.map(c => (
          <button
            key={c.key}
            onClick={() => setFilter(c.key)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
              filter === c.key ? 'bg-card text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            {c.dot && <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />}
            {c.label}
            <span className="font-mono font-normal text-slate-500">{counts[c.key]}</span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {visible.map(({ release, status }) => {
          const selected = !globalActive && (selectedId === release.id || (typeof selectedId === 'string' && (release.tag_name === selectedId || release.tag_name.includes(selectedId))));
          const playing = playingId === release.id;
          const runtime = getRuntimeLabel?.(release);
          const handle = getHandle?.(release);
          return (
            <button
              key={release.id}
              onClick={() => onSelect(release)}
              className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors cursor-pointer ${
                selected ? 'border-a1 bg-a1/10' : 'border-line bg-row hover:border-slate-600'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <p className={`flex-1 min-w-0 text-xs font-semibold truncate ${selected ? 'text-white' : 'text-slate-200'}`}>
                  {release.name || release.tag_name}
                </p>
                {playing
                  ? <Volume2 size={12} className="text-a0 animate-pulse flex-shrink-0" />
                  : <span title={STATUS_TITLE[status]} className={`w-2 h-2 rounded-full flex-shrink-0 ${DOT[status]}`} />}
              </div>
              {handle && <p className="text-[11px] text-slate-400 truncate mt-0.5">{handle}</p>}
              <div className="flex items-center gap-2 mt-1 flex-nowrap min-w-0 text-[11px] font-mono text-slate-400">
                <span className="whitespace-nowrap">{getEpisodeRecordedDate(release).displayDate}</span>
                {runtime && <span className="whitespace-nowrap">{runtime}</span>}
              </div>
            </button>
          );
        })}
        {visible.length === 0 && (
          <p className="text-center text-xs text-slate-500 py-8">Nothing here</p>
        )}
      </div>
    </div>
  );
};

export interface EpisodeDrawerProps extends EpisodeListProps {
  open: boolean;
  onClose: () => void;
}

/** Below 1120px the list lives in a drawer opened from the header's menu button. */
export const EpisodeDrawer: React.FC<EpisodeDrawerProps> = ({ open, onClose, onSelect, onOpenGlobal, ...list }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex min-[1120px]:hidden">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-80 max-w-[85vw] h-full flex flex-col shadow-2xl">
        <button
          onClick={onClose}
          aria-label="Close episode list"
          className="absolute top-2.5 right-2.5 z-10 p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-card cursor-pointer"
        >
          <X size={14} />
        </button>
        <EpisodeList
          {...list}
          className="h-full"
          onSelect={r => { onSelect(r); onClose(); }}
          onOpenGlobal={() => { onOpenGlobal(); onClose(); }}
        />
      </div>
    </div>
  );
};

export const EpisodeDrawerButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button
    onClick={onClick}
    title="Episodes"
    aria-label="Open episode list"
    className="min-[1120px]:hidden flex-shrink-0 p-2 rounded-lg border border-line bg-row text-slate-300 hover:text-white cursor-pointer"
  >
    <Menu size={15} />
  </button>
);
