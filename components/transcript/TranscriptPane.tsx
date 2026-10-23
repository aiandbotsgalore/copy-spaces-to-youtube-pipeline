import React from 'react';
import { Crosshair, Search, X } from 'lucide-react';

export interface PaneSpeaker {
  name: string;
  count: number;
  dotClass: string;
}

export interface TranscriptPaneProps {
  search: string;
  onSearch: (v: string) => void;
  matchCount: number;
  hasSearch: boolean;
  speakers: PaneSpeaker[];
  speakerFilter: string;
  onSpeakerFilter: (name: string) => void;
  follow: boolean;
  onToggleFollow: () => void;
  /** wheel/touch scrolling hands control back to the reader */
  onUserScroll: () => void;
  showJump: boolean;
  onJump: () => void;
  children: React.ReactNode;
}

export const TranscriptPane: React.FC<TranscriptPaneProps> = (p) => (
  <div className="flex-1 min-h-0 flex flex-col bg-bg relative">
    <div className="px-4 md:px-6 py-2.5 border-b border-line flex items-center gap-3 flex-wrap flex-shrink-0">
      <div className="relative w-full max-w-[260px]">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Find in episode"
          aria-label="Find in episode"
          value={p.search}
          onChange={e => p.onSearch(e.target.value)}
          className="w-full pl-8 pr-14 py-1.5 bg-row border border-line rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-a1"
        />
        {p.hasSearch && (
          <span className="absolute right-8 top-1/2 -translate-y-1/2 font-mono text-[11px] text-amber">{p.matchCount}</span>
        )}
        {p.search && (
          <button
            onClick={() => p.onSearch('')}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-white cursor-pointer"
          >
            <X size={12} />
          </button>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
        {p.speakers.length > 1 && p.speakers.map(s => {
          const on = p.speakerFilter === s.name;
          return (
            <button
              key={s.name}
              onClick={() => p.onSpeakerFilter(on ? 'ALL' : s.name)}
              aria-pressed={on}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium transition-colors cursor-pointer ${
                on ? 'border-a1 bg-a1/15 text-white' : 'border-line bg-row text-slate-300 hover:text-white'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${s.dotClass}`} />
              <span className="truncate max-w-[110px]">{s.name}</span>
              <span className="font-mono text-slate-500">{s.count}</span>
            </button>
          );
        })}
      </div>

      <button
        onClick={p.onToggleFollow}
        aria-pressed={p.follow}
        title={p.follow ? 'Following the playhead' : 'Follow the playhead'}
        className={`p-2 rounded-lg border cursor-pointer transition-colors ${
          p.follow ? 'border-a1 bg-a1/15 text-a0' : 'border-line bg-row text-slate-400 hover:text-white'
        }`}
      >
        <Crosshair size={14} />
      </button>
    </div>

    <div
      id="transcript-scroll"
      onWheel={p.onUserScroll}
      onTouchMove={p.onUserScroll}
      className="flex-1 overflow-y-auto px-2 md:px-4 py-3"
    >
      {p.children}
    </div>

    {p.showJump && (
      <button
        onClick={p.onJump}
        className="absolute bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3.5 py-2 rounded-full bg-a1 text-white text-xs font-semibold shadow-xl hover:brightness-110 cursor-pointer"
      >
        <Crosshair size={12} /> Jump to playhead
      </button>
    )}
  </div>
);
