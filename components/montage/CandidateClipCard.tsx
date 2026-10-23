import React from 'react';
import {
  AlertTriangle, Play, Pause, Check, Plus
} from 'lucide-react';
import { MontageClipItem } from '../../contexts/MontageContext';
import { categoryDotClass } from '../../utils/uiTokens';

export interface CandidateClipCardProps {
  clip: MontageClipItem;
  isHardExcluded: boolean;
  isExcluded: boolean;
  isAlreadyInTimeline: boolean;
  isSoloPlaying: boolean;
  hasFailed?: boolean;
  onPlaySolo: (clip: MontageClipItem) => void;
  onToggleBlacklist: (quoteIdOrId: string) => void;
  onAddClip: (clip: MontageClipItem) => void;
}

export const CandidateClipCard: React.FC<CandidateClipCardProps> = ({
  clip,
  isHardExcluded,
  isExcluded,
  isAlreadyInTimeline,
  isSoloPlaying,
  hasFailed,
  onPlaySolo,
  onToggleBlacklist,
  onAddClip,
}) => {
  return (
    <div
      draggable={!isHardExcluded}
      onDragStart={(e) => {
        e.dataTransfer.setData('application/spacepipe-clip', JSON.stringify(clip));
        e.dataTransfer.effectAllowed = 'copy';
      }}
      className={`p-4 rounded-xl border transition-all ${
        !isHardExcluded ? 'cursor-grab active:cursor-grabbing' : ''
      } ${
        isExcluded
          ? 'bg-rose-950/20 border-rose-500/30'
          : isAlreadyInTimeline
          ? 'bg-slate-900/60 border-indigo-500/30'
          : 'bg-slate-900/90 border-slate-800/90 hover:border-slate-700'
      }`}
    >
      {/* Hard Exclude Editorial Alert if present */}
      {isHardExcluded && (
        <div className="mb-2.5 px-3 py-1.5 rounded-lg bg-rose-500/15 border border-rose-500/30 flex items-center gap-2 text-rose-300 text-xs font-semibold">
          <AlertTriangle size={14} className="flex-shrink-0" />
          <span>MANDATORY EXCLUSION: Strictly excluded from montage sequences by Editorial Charter.</span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div className="flex items-center gap-2">
          {clip.quoteId && (
            <span className="font-mono text-[11px] text-slate-400">
              {clip.quoteId}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-800 text-slate-300">
            <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${categoryDotClass(clip.category)}`} aria-hidden="true" />
            {clip.category || 'Excerpt'}
          </span>
          <span className="text-xs text-slate-400">
            {clip.speaker}
          </span>
        </div>

        {/* Status Badges */}
        <div className="flex items-center gap-1.5">
          {clip.status === 'EXISTS' && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400" title="Asset exists in cloud release library">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
              In library
            </span>
          )}
          {clip.status === 'READY_FOR_EXTRACTION' && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400" title="Timecode boundaries aligned for cloud slicing">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-500" aria-hidden="true" />
              Ready to extract
            </span>
          )}
          {clip.status === 'SOURCE_NOT_AVAILABLE' && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400" title="Source recording outside available archive pool">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-400" aria-hidden="true" />
              Source not available
            </span>
          )}
          {isExcluded && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-400" aria-hidden="true" />
              Excluded
            </span>
          )}
        </div>
      </div>

      {/* Quote Text */}
      <p className="text-sm text-slate-100 leading-relaxed mb-3">
        &ldquo;{clip.quote}&rdquo;
      </p>

      {/* Footer: Source Space, Duration, Actions */}
      <div className="pt-2.5 border-t border-slate-800/80 flex items-center justify-between gap-3 flex-wrap text-xs">
        <div className="text-[11px] text-slate-400 truncate max-w-[240px]">
          <span className="text-slate-400">Source:</span> {clip.sourceTitle}
        </div>

        <div className="flex items-center gap-2">
          {/* Instant streaming playback button */}
          {clip.audioUrl ? (
            <button
              onClick={() => onPlaySolo(clip)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                isSoloPlaying
                  ? 'bg-indigo-600 text-white border-indigo-500'
                  : 'bg-transparent hover:bg-slate-800 text-slate-300 border-transparent'
              }`}
              title="Stream preview directly from cloud storage"
            >
              {isSoloPlaying ? <Pause size={12} /> : <Play size={12} />}
              <span>{isSoloPlaying ? 'Pause' : 'Stream'}</span>
            </button>
          ) : hasFailed ? (
            <span className="px-2 py-1 rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/30 text-[11px] font-semibold">
              Stream Offline
            </span>
          ) : null}

          {/* Blacklist toggle button */}
          {!isHardExcluded && (
            <button
              onClick={() => onToggleBlacklist(clip.quoteId || clip.id)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                isExcluded
                  ? 'bg-transparent text-rose-300 border-rose-500/40 hover:bg-rose-500/10'
                  : 'bg-transparent hover:bg-slate-800 text-slate-300 hover:text-rose-300 border-transparent'
              }`}
              title="Exclude quote from automatic montage sequences"
            >
              {isExcluded ? 'Include' : 'Exclude'}
            </button>
          )}

          {/* Add to timeline button */}
          <button
            onClick={() => onAddClip(clip)}
            disabled={isHardExcluded || isAlreadyInTimeline}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm cursor-pointer ${
              isAlreadyInTimeline
                ? 'bg-transparent text-emerald-400 border border-slate-800 cursor-not-allowed'
                : isHardExcluded
                ? 'bg-rose-950/40 text-slate-400 border border-rose-900/30 cursor-not-allowed'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white'
            }`}
          >
            {isAlreadyInTimeline ? (
              <>
                <Check size={12} />
                <span>In reel</span>
              </>
            ) : (
              <>
                <Plus size={12} />
                <span>Add to reel</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CandidateClipCard;
