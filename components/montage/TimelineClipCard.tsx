import React from 'react';
import {
  GripVertical, Play, Pause, ArrowUp, ArrowDown, ShieldAlert,
  Lock, Unlock, X, AlertTriangle
} from 'lucide-react';
import { MontageClipItem } from '../../contexts/MontageContext';
import { categoryDotClass } from '../../utils/uiTokens';
import { VisualWaveformTrim } from '../VisualWaveformTrim';

export interface TimelineClipCardProps {
  clip: MontageClipItem;
  idx: number;
  timelineClipsLength: number;
  isDraggingThis: boolean;
  isDragOverThis: boolean;
  isPlayingThis: boolean;
  isSoloPlaying: boolean;
  isUnverifiable: boolean;
  isBlacklisted: boolean;
  auditionProgress: { timelineIndex: number; clipProgress: number } | null;
  previewAudioRef: React.RefObject<HTMLAudioElement | null>;
  previewClipId: string | null;
  onDragStart: (idx: number) => void;
  onDragOver: (e: React.DragEvent, idx: number) => void;
  onDrop: (e: React.DragEvent, idx: number) => void;
  onPlaySolo: (clip: MontageClipItem) => void;
  onMoveClip: (id: string, dir: 'up' | 'down') => void;
  onToggleBlacklist: (quoteIdOrId: string) => void;
  onToggleLock: (id: string) => void;
  onRemoveClip: (id: string) => void;
  onUpdateClip: (id: string, updates: Partial<MontageClipItem>) => void;
  onResetTrim: (id: string) => void;
}

export const TimelineClipCard: React.FC<TimelineClipCardProps> = ({
  clip,
  idx,
  timelineClipsLength,
  isDraggingThis,
  isDragOverThis,
  isPlayingThis,
  isSoloPlaying,
  isUnverifiable,
  isBlacklisted,
  auditionProgress,
  previewAudioRef,
  previewClipId,
  onDragStart,
  onDragOver,
  onDrop,
  onPlaySolo,
  onMoveClip,
  onToggleBlacklist,
  onToggleLock,
  onRemoveClip,
  onUpdateClip,
  onResetTrim,
}) => {
  return (
    <div
      draggable
      onDragStart={() => onDragStart(idx)}
      onDragOver={e => onDragOver(e, idx)}
      onDrop={e => onDrop(e, idx)}
      className={`p-3.5 rounded-xl border transition-all relative ${
        isDraggingThis
          ? 'opacity-40 border-dashed border-indigo-500'
          : isDragOverThis
          ? 'border-indigo-400 bg-indigo-950/40 shadow-lg ring-2 ring-indigo-500/40'
          : isPlayingThis
          ? 'bg-indigo-950/80 border-emerald-500 shadow-xl ring-2 ring-emerald-500/30'
          : 'bg-slate-900/90 border-slate-800 hover:border-slate-700'
      }`}
    >
      {/* Top Row: Reorder grip, Rank, Category, Speaker, Controls */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-300" title="Drag to reorder">
            <GripVertical size={14} />
          </span>
          <span className="w-5 h-5 rounded-md bg-slate-800 text-slate-200 font-mono text-[11px] font-bold flex items-center justify-center border border-slate-700">
            {idx + 1}
          </span>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-800 text-slate-300">
            <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${categoryDotClass(clip.category)}`} aria-hidden="true" />
            {clip.category || 'Archival Quote'}
          </span>
          <span className="text-xs font-bold text-slate-200 truncate max-w-[140px]">
            {clip.speaker}
          </span>
          {typeof clip.tensionScore === 'number' && (
            <span
              className="px-1.5 py-0.5 rounded-md text-[11px] font-mono font-bold bg-slate-800 text-slate-300"
              title="Director tension score (1-10)"
            >
              T{clip.tensionScore}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Play solo preview */}
          <button
            onClick={() => onPlaySolo(clip)}
            className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
              isSoloPlaying
                ? 'bg-amber-500 text-slate-950 border-amber-400'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border-slate-700'
            }`}
            title="Audition single clip slice"
          >
            {isSoloPlaying ? <Pause size={12} /> : <Play size={12} />}
          </button>

          {/* Move Up/Down */}
          <button
            onClick={() => onMoveClip(clip.id, 'up')}
            disabled={idx === 0}
            className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white disabled:opacity-20 cursor-pointer"
            title="Move earlier"
          >
            <ArrowUp size={12} />
          </button>
          <button
            onClick={() => onMoveClip(clip.id, 'down')}
            disabled={idx === timelineClipsLength - 1}
            className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white disabled:opacity-20 cursor-pointer"
            title="Move later"
          >
            <ArrowDown size={12} />
          </button>

          {/* Exclude / Blacklist toggle */}
          <button
            onClick={() => onToggleBlacklist(clip.quoteId || clip.id)}
            className={`p-1 rounded-lg text-xs transition-colors cursor-pointer ${
              isBlacklisted
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                : 'hover:bg-slate-800 text-slate-400 hover:text-rose-400'
            }`}
            title="Toggle Exclude from Montage (blacklist quote)"
          >
            <ShieldAlert size={12} />
          </button>

          {/* Lock: the Director never changes a locked clip */}
          <button
            onClick={() => onToggleLock(clip.id)}
            className={`p-1 rounded-lg text-xs transition-colors cursor-pointer ${
              clip.locked
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                : 'hover:bg-slate-800 text-slate-400 hover:text-amber-300'
            }`}
            title={clip.locked ? 'Locked: the Director will not change this clip' : 'Lock this clip against Director edits'}
            aria-pressed={!!clip.locked}
          >
            {clip.locked ? <Lock size={12} /> : <Unlock size={12} />}
          </button>

          {/* Delete */}
          <button
            onClick={() => onRemoveClip(clip.id)}
            className="p-1 rounded-lg hover:bg-rose-950/50 text-slate-400 hover:text-rose-400 cursor-pointer transition-colors"
            title="Remove from sequence"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Quote text */}
      <p className="text-xs text-slate-300 italic font-medium leading-relaxed mb-3 line-clamp-3">
        "{clip.quote}"
      </p>
      {clip.directorNote && (
        <p className="text-[11px] text-indigo-300/90 mb-2">Director: {clip.directorNote}</p>
      )}
      {isUnverifiable && (
        <p className="text-[11px] text-amber-300 mb-2 flex items-center gap-1">
          <AlertTriangle size={11} /> Audio could not be loaded (missing file or unreachable URL). It will be skipped.
        </p>
      )}

      {/* Visual Waveform & Interactive Trim Scrubbing */}
      <div className="pt-2.5 border-t border-slate-800/80">
        <VisualWaveformTrim
          clip={clip}
          isPlaying={isPlayingThis}
          playheadProgress={auditionProgress?.timelineIndex === idx ? auditionProgress.clipProgress : 0}
          onTrimStart={(newStart) => {
            onUpdateClip(clip.id, {
              startSec: newStart,
              origStartSec: clip.origStartSec ?? clip.startSec,
              origEndSec: clip.origEndSec ?? clip.endSec,
              trimBasis: 'manual',
            });
          }}
          onTrimEnd={(newEnd) => {
            onUpdateClip(clip.id, {
              endSec: newEnd,
              origStartSec: clip.origStartSec ?? clip.startSec,
              origEndSec: clip.origEndSec ?? clip.endSec,
              trimBasis: 'manual',
            });
          }}
          onResetTrim={() => onResetTrim(clip.id)}
          onSeekPreview={(timeSec) => {
            if (previewAudioRef.current && previewClipId === clip.id) {
              previewAudioRef.current.currentTime = timeSec;
            }
          }}
        />
      </div>
    </div>
  );
};

export default TimelineClipCard;
