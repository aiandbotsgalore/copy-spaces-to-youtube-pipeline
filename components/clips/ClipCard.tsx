import React from 'react';
import {
  Play,
  Pause,
  Clock,
  User,
  Radio,
  Copy,
  Check,
  Download,
  Video,
} from 'lucide-react';
import { ClipItem } from '../../utils/contracts/clipCatalog';
import { getClipRecordedDate } from '../../utils/dates';
import { formatEpisodeTitle, getCategoryColor, normalizeCategory, getAudioUrl } from './clipUtils';

export interface ClipCardProps {
  clip: ClipItem;
  idx: number;
  isThisPlaying: boolean;
  viewMode: 'grouped' | 'grid' | 'list';
  copiedId: string | null;
  onPlay: (clip: ClipItem) => void;
  onCopyQuote: (title: string, text: string) => void;
  onOpenAvatarModal: (clip: ClipItem) => void;
}

export const ClipCard: React.FC<ClipCardProps> = ({
  clip,
  idx,
  isThisPlaying,
  viewMode,
  copiedId,
  onPlay,
  onCopyQuote,
  onOpenAvatarModal,
}) => {
  const catColor = getCategoryColor(clip.category);
  const starsCount = Math.min(5, Math.max(1, Math.round((clip.viral_score || 8) / 2)));
  const audioUrl = getAudioUrl(clip);

  return (
    <div
      key={`${clip.title}-${idx}`}
      className={`p-5 rounded-xl border transition-all flex flex-col justify-between relative group ${
        isThisPlaying
          ? 'bg-slate-900/95 border-indigo-500/70 shadow-xl ring-1 ring-indigo-500/50'
          : 'bg-slate-900/70 border-slate-800/90 hover:border-slate-700 hover:bg-slate-850/80'
      }`}
    >
      <div>
        {/* Top Row: Category + Stars */}
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <span className={`px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider rounded-md border ${catColor.badge}`}>
            <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle ${catColor.dot}`} aria-hidden="true" />
            {normalizeCategory(clip.category)}
          </span>
          <div className="flex items-center gap-1 text-amber-400 text-xs" title={`Viral Score: ${clip.viral_score}/10`}>
            {'⭐'.repeat(starsCount)}
            <span className="text-[11px] font-bold text-slate-400 ml-1">
              {clip.viral_score}/10
            </span>
          </div>
        </div>

        {/* Space Episode Banner (if not grouped) */}
        {viewMode !== 'grouped' && clip.episode && (
          <div className="flex items-center justify-between gap-1.5 text-[11px] font-medium text-slate-300 bg-slate-950/40 border border-slate-800/40 px-2.5 py-1 rounded-lg mb-2.5 w-full">
            <div className="flex items-center gap-1.5 truncate">
              <Radio size={12} className="flex-shrink-0 text-slate-300" />
              <span className="truncate" title={formatEpisodeTitle(clip.episode)}>
                {formatEpisodeTitle(clip.episode)}
              </span>
            </div>
            <span className="text-[11px] text-amber-400/90 flex-shrink-0 font-normal">
              📅 {getClipRecordedDate(clip).displayDate}
            </span>
          </div>
        )}

        {/* Title */}
        <h3 className="text-sm sm:text-base font-bold text-white mb-1.5 leading-snug group-hover:text-indigo-200 transition-colors">
          {clip.title}
        </h3>

        {/* Reason */}
        <p className="text-xs text-slate-400 mb-3 line-clamp-2 leading-relaxed">
          {clip.reason}
        </p>

        {/* Quote Dialogue Box */}
        <div className="p-3 bg-slate-950/80 border border-slate-800/90 rounded-xl mb-3.5 relative group/quote">
          <p className="text-[11px] text-slate-300 italic line-clamp-3 leading-relaxed">
            "{clip.transcript_snippet}"
          </p>
          <button
            onClick={() => onCopyQuote(clip.title, clip.transcript_snippet)}
            className="absolute right-2 top-2 p-1 bg-slate-800/90 hover:bg-slate-700 text-slate-400 hover:text-white rounded opacity-0 group-hover/quote:opacity-100 transition-opacity cursor-pointer shadow-sm"
            title="Copy Quote"
          >
            {copiedId === clip.title ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
          </button>
        </div>
      </div>

      {/* Bottom Metadata & Playback Controls */}
      <div>
        <div className="flex items-center gap-3 text-[11px] text-slate-400 mb-3.5 flex-wrap">
          <span className="flex items-center gap-1 font-mono text-slate-400">
            <Clock size={11} />
            {clip.duration ? `${clip.duration.toFixed(0)}s` : 'Clip'}
          </span>
          {clip.speakers && clip.speakers.length > 0 && (
            <span className="flex items-center gap-1 truncate max-w-[220px]">
              <User size={11} className="text-emerald-400" />
              <span className="text-slate-400">{clip.speakers.join(', ')}</span>
            </span>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-800/70">
          <button
            onClick={() => onPlay(clip)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer shadow-md ${
              isThisPlaying
                ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white hover:scale-[1.02]'
            }`}
          >
            {isThisPlaying ? <Pause size={14} /> : <Play size={14} className="translate-x-0.2" />}
            <span>{isThisPlaying ? 'Pause Moment' : 'Play Moment'}</span>
          </button>

          <div className="flex items-center gap-1">
            <button
              onClick={() => onCopyQuote(clip.title, clip.transcript_snippet)}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              title="Copy Quote"
            >
              {copiedId === clip.title ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
            </button>
            <a
              href={audioUrl}
              download
              className="p-2 text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded-lg transition-colors"
              title="Download MP3"
            >
              <Download size={14} />
            </a>
            <button
              onClick={() => onOpenAvatarModal(clip)}
              className="p-2 text-slate-400 hover:text-purple-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              title="Animate Talking Avatar (EchoMimicV3 Cloud GPU)"
            >
              <Video size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
