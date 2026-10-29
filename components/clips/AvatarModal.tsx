import React from 'react';
import {
  X,
  Camera,
  Upload,
  Check,
  ExternalLink,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { ClipItem } from '../../utils/contracts/clipCatalog';
import { cleanClipSpeakers, MAX_STAGE_SPEAKERS } from '../../utils/avatarStage';

export interface AvatarModalProps {
  clip: ClipItem | null;
  onClose: () => void;
  speakerAvatarMap: Record<string, string>;
  onUploadPhotoForSpeaker: (speaker: string, file?: File | null) => void;
  uploadingSpeakerAvatar: string | null;
  avatarLayoutMode: 'stage_grid' | 'split_screen' | 'solo';
  setAvatarLayoutMode: (mode: 'stage_grid' | 'split_screen' | 'solo') => void;
  avatarRatio: '9:16' | '1:1' | '16:9';
  setAvatarRatio: (ratio: '9:16' | '1:1' | '16:9') => void;
  avatarDispatchStatus: string | null;
  isDispatchingAvatar: boolean;
  onDispatchAvatar: (clip: ClipItem) => void;
  owner: string;
  repo: string;
}

export const AvatarModal: React.FC<AvatarModalProps> = ({
  clip,
  onClose,
  speakerAvatarMap,
  onUploadPhotoForSpeaker,
  uploadingSpeakerAvatar,
  avatarLayoutMode,
  setAvatarLayoutMode,
  avatarRatio,
  setAvatarRatio,
  avatarDispatchStatus,
  isDispatchingAvatar,
  onDispatchAvatar,
  owner,
  repo,
}) => {
  if (!clip) return null;

  // Catalog speaker lists are not schema checked: they can be missing, hold nulls or placeholders,
  // and the worker caps the stage too, so the cast preview has to match what will be rendered.
  const stageSpeakers = cleanClipSpeakers(clip.speakers);
  const speakersList = (stageSpeakers.length > 0 ? stageSpeakers : ['Logan', 'Guest']).slice(0, MAX_STAGE_SPEAKERS);
  const dispatchFailed = Boolean(avatarDispatchStatus && avatarDispatchStatus.startsWith('error'));
  const dispatchSucceeded = Boolean(avatarDispatchStatus && avatarDispatchStatus.startsWith('success'));
  const dispatchNote = dispatchSucceeded && avatarDispatchStatus ? avatarDispatchStatus.replace(/^success:?\s*/, '') : '';

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Spaces Live Stage animator"
    >
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-purple-500/10 border border-purple-500/20 text-purple-400 rounded-xl">
              <Sparkles size={20} />
            </div>
            <div>
              <h3 className="text-base font-bold text-white leading-none">
                Spaces Live Stage Animator
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Renders a multi-speaker stage: only the person talking lip-syncs and lights up, everyone else listens.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* 1. Stage Preview & Speaker Photos */}
        <div className="mb-6">
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-2">
            1. Spaces Stage Cast & Avatars
          </label>
          <div className="bg-slate-950 border border-slate-800/80 rounded-xl p-4">
            <div className="flex items-center justify-around flex-wrap gap-4 py-2">
              {speakersList.map((speaker, sIdx) => {
                const avatarImg = speakerAvatarMap[speaker] || 'https://unavatar.io/twitter/LoganBlack';
                return (
                  <div key={speaker} className="flex flex-col items-center gap-2 max-w-[120px]">
                    <div className="relative group/avatar">
                      <div className={`w-16 h-16 rounded-full border-2 overflow-hidden shadow-lg ${
                        sIdx === 0 ? 'border-purple-500 ring-2 ring-purple-500/30' : 'border-slate-700'
                      }`}>
                        <img
                          src={avatarImg}
                          alt={speaker}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = 'https://unavatar.io/twitter/twitter';
                          }}
                        />
                      </div>
                      <label
                        className="absolute inset-0 bg-slate-950/80 rounded-full opacity-0 group-hover/avatar:opacity-100 flex flex-col items-center justify-center cursor-pointer transition-opacity text-white text-[9px] font-semibold"
                        title={`Upload custom photo for ${speaker}`}
                      >
                        <Camera size={16} className="text-purple-300 mb-0.5" />
                        <span>Change</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => onUploadPhotoForSpeaker(speaker, e.target.files?.[0])}
                        />
                      </label>
                    </div>

                    <div className="text-center w-full min-w-0">
                      <p className="text-xs font-bold text-white truncate">{speaker}</p>
                      <label
                        className="inline-flex items-center gap-1 mt-1 text-[10px] text-purple-400 hover:text-purple-300 cursor-pointer font-medium hover:underline"
                      >
                        <Upload size={10} />
                        <span>{uploadingSpeakerAvatar === speaker ? 'Uploading...' : 'Choose Image'}</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => onUploadPhotoForSpeaker(speaker, e.target.files?.[0])}
                        />
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 pt-3 border-t border-slate-800/80 flex flex-col items-center text-center">
              <span className="text-[9px] font-bold uppercase tracking-wider text-amber-400 mb-1">
                🔥 Dynamic Kinetic Caption Bar 🔥
              </span>
              <p className="text-xs font-bold text-white bg-slate-900/90 px-3 py-1.5 rounded-lg border border-amber-500/30 max-w-md truncate">
                &ldquo;{clip.transcript_snippet || 'Banter, debate, and quotes will animate here in sync with speech...'}&rdquo;
              </p>
            </div>
          </div>
        </div>

        {/* 2. Format & Layout Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5">
              2. Stage Layout Style
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAvatarLayoutMode('stage_grid')}
                className={`p-2.5 rounded-xl border text-xs font-semibold text-left cursor-pointer transition-all ${
                  avatarLayoutMode === 'stage_grid'
                    ? 'border-purple-500 bg-purple-500/20 text-white'
                    : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="font-bold">🎭 Spaces Live Stage</div>
                <div className="text-[10px] text-slate-400 font-normal mt-0.5">Active glowing tiles</div>
              </button>
              <button
                type="button"
                onClick={() => setAvatarLayoutMode('split_screen')}
                className={`p-2.5 rounded-xl border text-xs font-semibold text-left cursor-pointer transition-all ${
                  avatarLayoutMode === 'split_screen'
                    ? 'border-purple-500 bg-purple-500/20 text-white'
                    : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="font-bold">📱 Stacked Split</div>
                <div className="text-[10px] text-slate-400 font-normal mt-0.5">Top/Bottom podcast</div>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5">
              3. Video Aspect Ratio
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['9:16', '1:1', '16:9'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setAvatarRatio(r)}
                  className={`p-2.5 rounded-xl border text-xs font-semibold text-center cursor-pointer transition-all ${
                    avatarRatio === r
                      ? 'border-purple-500 bg-purple-500/20 text-white'
                      : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  {r === '9:16' ? '📱 9:16 (Shorts)' : r === '1:1' ? '⬛ 1:1' : '🖥️ 16:9'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {dispatchSucceeded && (
          <div className="mb-4 p-3.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs text-emerald-400 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in">
            <div className="flex items-start gap-2.5">
              <Check size={18} className="flex-shrink-0 text-emerald-400" />
              <div>
                <p className="font-semibold text-white">🎉 Cloud GPU Render Dispatched!</p>
                <p className="text-[11px] text-emerald-400/90 mt-0.5">
                  The Kaggle T4 worker is rendering the {avatarRatio} {avatarLayoutMode === 'split_screen' ? 'stacked split' : avatarLayoutMode === 'solo' ? 'solo' : 'stage grid'} video with synced clip audio.
                </p>
                {dispatchNote && (
                  <p className="text-[11px] text-amber-300/90 mt-1">Note: {dispatchNote}.</p>
                )}
              </div>
            </div>
            <a
              href={`https://github.com/${owner}/${repo}/actions/workflows/generate_avatar_short.yml`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 rounded-lg text-emerald-200 font-semibold transition-colors shrink-0 text-xs shadow-sm"
            >
              <ExternalLink size={13} />
              <span>View Run & Download Video MP4 ↗</span>
            </a>
          </div>
        )}

        {dispatchFailed && avatarDispatchStatus && (
          <div className="mb-4 p-3.5 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-400 animate-in fade-in">
            <p className="font-semibold text-rose-300">Render not dispatched</p>
            <p className="mt-0.5 break-words">{avatarDispatchStatus.replace(/^error:?\s*/, '')}</p>
            <p className="mt-1 text-[11px] text-rose-300/70">
              Nothing was queued, so it is safe to retry once the token in Settings can dispatch workflows.
            </p>
          </div>
        )}

        {/* Footer Buttons */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 text-xs font-semibold text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isDispatchingAvatar}
            onClick={() => onDispatchAvatar(clip)}
            className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-purple-600 via-indigo-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-purple-900/50 cursor-pointer disabled:opacity-50"
          >
            {isDispatchingAvatar ? (
              <>
                <RefreshCw size={14} className="animate-spin" />
                <span>Dispatching Cloud GPU...</span>
              </>
            ) : (
              <>
                <Sparkles size={14} />
                <span>Generate Spaces Live Stage Short</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
