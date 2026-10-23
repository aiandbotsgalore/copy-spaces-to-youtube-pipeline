import React from 'react';
import { CheckCircle2, HardDriveDownload, Loader, Pencil, Save, Star, Users } from 'lucide-react';
import { EpisodeDrawerButton } from './EpisodeList';
import { ExportMenu, ExportMenuProps } from './ExportMenu';

export interface EpisodeHeaderProps {
  title: string;
  dateLabel: string;
  hostHandle?: string;
  runtimeLabel?: string;
  turnCount: number;
  speakerCount: number;
  model?: string;
  language?: string;
  hasAudio: boolean;
  isCached: boolean;
  isCaching: boolean;
  cachePct: number;
  onToggleCache: () => void;
  savedSpeakersCount: number;
  onOpenSavedSpeakers: () => void;
  onOpenRename: () => void;
  onOpenVoices: () => void;
  canSave: boolean;
  saving: boolean;
  onSave: () => void;
  onOpenDrawer: () => void;
  exportMenu: ExportMenuProps;
}

const btn = 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-line bg-card text-xs font-medium text-slate-300 hover:text-white transition-colors cursor-pointer disabled:opacity-40';

export const EpisodeHeader: React.FC<EpisodeHeaderProps> = (p) => (
  <div className="px-4 md:px-6 py-3 bg-bg border-b border-line flex items-center justify-between gap-3">
    <div className="flex items-center gap-3 min-w-0">
      <EpisodeDrawerButton onClick={p.onOpenDrawer} />
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-white truncate max-w-xl">{p.title}</h3>
        <p className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5 flex-nowrap min-w-0 overflow-hidden">
          {p.hostHandle && <span className="text-slate-200 whitespace-nowrap truncate max-w-[160px]" title="Host">@{p.hostHandle}</span>}
          <span className="font-mono text-slate-300 whitespace-nowrap">{p.dateLabel}</span>
          {p.runtimeLabel && <span className="font-mono whitespace-nowrap px-1.5 py-0.5 rounded bg-card border border-line text-slate-300">{p.runtimeLabel}</span>}
          {p.turnCount > 0 && <span className="font-mono text-a0 whitespace-nowrap">{p.turnCount} turns</span>}
          {p.model && <span className="font-mono truncate" title="Speech-to-text model">{p.model}</span>}
          {p.language && <span className="font-mono uppercase">{p.language}</span>}
        </p>
      </div>
    </div>

    <div className="flex items-center gap-1.5 flex-shrink-0">
      {p.hasAudio && (
        <button
          onClick={p.onToggleCache}
          disabled={p.isCaching}
          title={p.isCached ? 'Audio is cached for instant seeking. Click to purge.' : 'Cache the MP3 for instant offline scrubbing'}
          className={`${btn} ${p.isCached ? '!border-emerald/50 !text-emerald' : ''}`}
        >
          {p.isCaching
            ? <><Loader size={13} className="animate-spin" /><span className="font-mono">{p.cachePct}%</span></>
            : p.isCached
              ? <><CheckCircle2 size={13} /><span>Cached</span></>
              : <><HardDriveDownload size={13} /><span>Cache</span></>}
        </button>
      )}
      <button onClick={p.onOpenSavedSpeakers} title="Saved speakers" className={btn}>
        <Star size={13} className="text-amber" /><span className="font-mono">{p.savedSpeakersCount}</span>
      </button>
      {p.speakerCount > 0 && (
        <div className="flex items-stretch">
          <button onClick={p.onOpenVoices} title="Open Voice Profiles" className={`${btn} !rounded-r-none`}>
            <Users size={13} /><span className="font-mono">{p.speakerCount}</span>
          </button>
          <button onClick={p.onOpenRename} title="Rename speakers in this episode" aria-label="Rename speakers" className={`${btn} !rounded-l-none border-l-0 !px-2`}>
            <Pencil size={11} />
          </button>
        </div>
      )}
      {p.speakerCount > 0 && (
        <button onClick={p.onSave} disabled={p.saving || !p.canSave} title="Save speaker names and sync offset to GitHub" className={btn}>
          {p.saving ? <Loader size={13} className="animate-spin" /> : <Save size={13} />}
        </button>
      )}
      <ExportMenu {...p.exportMenu} />
    </div>
  </div>
);
