import React from 'react';
import { Loader, CheckCircle2, AlertCircle, X } from 'lucide-react';

export interface ZipProgress {
  current: number;
  total: number;
  currentTitle: string;
  percent: number;
}

export interface TranscriptExportBarProps {
  speakerZipProgress: ZipProgress | null;
  speakerZipSuccess: string | null;
  setSpeakerZipSuccess: (msg: string | null) => void;
  speakerZipError: string | null;
  setSpeakerZipError: (msg: string | null) => void;
  audioZipProgress: ZipProgress | null;
  audioZipSuccess: string | null;
  setAudioZipSuccess: (msg: string | null) => void;
  audioZipError: string | null;
  setAudioZipError: (msg: string | null) => void;
}

export const TranscriptExportBar: React.FC<TranscriptExportBarProps> = ({
  speakerZipProgress,
  speakerZipSuccess,
  setSpeakerZipSuccess,
  speakerZipError,
  setSpeakerZipError,
  audioZipProgress,
  audioZipSuccess,
  setAudioZipSuccess,
  audioZipError,
  setAudioZipError,
}) => {
  if (!speakerZipProgress && !speakerZipSuccess && !speakerZipError && !audioZipProgress && !audioZipSuccess && !audioZipError) {
    return null;
  }

  return (
    <div className="space-y-2 flex-shrink-0 px-4 md:px-8 py-2">
      {/* Speaker Zip Progress Status Bar */}
      {speakerZipProgress && (
        <div className="p-3 bg-emerald-950/70 border border-emerald-500/40 rounded-xl text-xs text-emerald-200 shadow-lg space-y-2">
          <div className="flex items-center justify-between font-semibold">
            <span className="flex items-center gap-2">
              <Loader size={13} className="animate-spin text-emerald-400" />
              <span>{speakerZipProgress.currentTitle}</span>
            </span>
            <span className="text-emerald-400 font-mono">{speakerZipProgress.percent}%</span>
          </div>
          <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-emerald-500 h-full transition-all duration-200"
              style={{ width: `${speakerZipProgress.percent}%` }}
            />
          </div>
        </div>
      )}

      {/* Speaker Zip Success Banner */}
      {speakerZipSuccess && (
        <div className="flex items-center justify-between p-3 bg-emerald-950/60 border border-emerald-500/30 rounded-xl text-xs text-emerald-200 shadow-md">
          <span className="flex items-center gap-2 font-medium">
            <CheckCircle2 size={14} className="text-emerald-400" />
            <span>{speakerZipSuccess}</span>
          </span>
          <button onClick={() => setSpeakerZipSuccess(null)} className="text-emerald-400 hover:text-white p-1 cursor-pointer">
            <X size={13} />
          </button>
        </div>
      )}

      {/* Speaker Zip Error Banner */}
      {speakerZipError && (
        <div className="flex items-center justify-between p-3 bg-rose-950/60 border border-rose-500/30 rounded-xl text-xs text-rose-200 shadow-md">
          <span className="flex items-center gap-2 font-medium">
            <AlertCircle size={14} className="text-rose-400" />
            <span>{speakerZipError}</span>
          </span>
          <button onClick={() => setSpeakerZipError(null)} className="text-rose-400 hover:text-white p-1 cursor-pointer">
            <X size={13} />
          </button>
        </div>
      )}

      {/* Audio Zip Progress Status Bar */}
      {audioZipProgress && (
        <div className="p-3 bg-emerald-950/70 border border-emerald-500/40 rounded-xl text-xs text-emerald-200 shadow-lg space-y-2">
          <div className="flex items-center justify-between font-semibold">
            <span className="flex items-center gap-2">
              <Loader size={13} className="animate-spin text-emerald-400" />
              <span>{audioZipProgress.currentTitle}</span>
            </span>
            <span className="text-emerald-400 font-mono">{audioZipProgress.percent}%</span>
          </div>
          <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-emerald-500 h-full transition-all duration-300"
              style={{ width: `${audioZipProgress.percent}%` }}
            />
          </div>
        </div>
      )}

      {/* Audio Zip Success Banner */}
      {audioZipSuccess && (
        <div className="flex items-center justify-between p-3 bg-emerald-950/60 border border-emerald-500/30 rounded-xl text-xs text-emerald-200 shadow-md">
          <span className="flex items-center gap-2 font-medium">
            <CheckCircle2 size={14} className="text-emerald-400" />
            <span>{audioZipSuccess}</span>
          </span>
          <button onClick={() => setAudioZipSuccess(null)} className="text-emerald-400 hover:text-white p-1 cursor-pointer">
            <X size={13} />
          </button>
        </div>
      )}

      {/* Audio Zip Error Banner */}
      {audioZipError && (
        <div className="flex items-center justify-between p-3 bg-rose-950/60 border border-rose-500/30 rounded-xl text-xs text-rose-200 shadow-md">
          <span className="flex items-center gap-2 font-medium">
            <AlertCircle size={14} className="text-rose-400" />
            <span>{audioZipError}</span>
          </span>
          <button onClick={() => setAudioZipError(null)} className="text-rose-400 hover:text-white p-1 cursor-pointer">
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  );
};
