import React from 'react';
import {
  Play, Pause, SkipBack, SkipForward, Loader2, Download, FileText, CheckCircle2, AlertTriangle, AlertCircle, X
} from 'lucide-react';

export interface StudioExportBarProps {
  isAuditioning: boolean;
  onToggleAudition: () => void;
  timelineClipsLength: number;
  auditionStatus?: string | null;
  currentAuditionIndex: number;
  onSkipAudition: (idx: number) => void;
  isExporting: boolean;
  exportProgress: string;
  exportNotice?: { type: 'success' | 'warning' | 'error'; message: string } | null;
  onClearExportNotice?: () => void;
  onExportStitchedWav: () => void;
  onExportAudacityLabels: () => void;
  onExportManifestJson: () => void;
}

export const StudioExportBar: React.FC<StudioExportBarProps> = ({
  isAuditioning,
  onToggleAudition,
  timelineClipsLength,
  auditionStatus,
  currentAuditionIndex,
  onSkipAudition,
  isExporting,
  exportProgress,
  exportNotice,
  onClearExportNotice,
  onExportStitchedWav,
  onExportAudacityLabels,
  onExportManifestJson,
}) => {
  return (
    <div className="px-5 py-3.5 bg-slate-900/90 border-t border-slate-800/80 flex items-center justify-between gap-3 flex-wrap text-xs">
      {/* Audition Player */}
      <div className="flex items-center gap-2">
        <button
          onClick={onToggleAudition}
          disabled={timelineClipsLength === 0}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg font-bold shadow-lg transition-all cursor-pointer disabled:opacity-30 ${
            isAuditioning
              ? 'bg-amber-500 text-slate-950'
              : 'bg-emerald-600 hover:bg-emerald-500 text-white'
          }`}
        >
          {isAuditioning ? <Pause size={14} /> : <Play size={14} />}
          <span>{isAuditioning ? 'Pause Audition' : 'Audition Sequence'}</span>
        </button>

        {auditionStatus && (
          <span className="text-[11px] text-amber-300 max-w-[220px] truncate" title={auditionStatus}>
            {auditionStatus}
          </span>
        )}
        {isAuditioning && (
          <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded-lg border border-slate-800">
            <button
              onClick={() => onSkipAudition(Math.max(0, currentAuditionIndex - 1))}
              disabled={currentAuditionIndex === 0}
              className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-20 cursor-pointer"
            >
              <SkipBack size={12} />
            </button>
            <span className="font-mono text-emerald-400 font-bold text-xs">
              #{currentAuditionIndex + 1}/{timelineClipsLength}
            </span>
            <button
              onClick={() => onSkipAudition(Math.min(timelineClipsLength - 1, currentAuditionIndex + 1))}
              disabled={currentAuditionIndex >= timelineClipsLength - 1}
              className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-20 cursor-pointer"
            >
              <SkipForward size={12} />
            </button>
          </div>
        )}
      </div>

      {/* Export Notice Pill (if present) */}
      {exportNotice && (
        <div
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs max-w-md ${
            exportNotice.type === 'success'
              ? 'bg-emerald-950/70 border-emerald-700/60 text-emerald-300'
              : exportNotice.type === 'warning'
              ? 'bg-amber-950/70 border-amber-700/60 text-amber-300'
              : 'bg-rose-950/70 border-rose-700/60 text-rose-300'
          }`}
        >
          {exportNotice.type === 'success' ? (
            <CheckCircle2 size={13} className="shrink-0 text-emerald-400" />
          ) : exportNotice.type === 'warning' ? (
            <AlertTriangle size={13} className="shrink-0 text-amber-400" />
          ) : (
            <AlertCircle size={13} className="shrink-0 text-rose-400" />
          )}
          <span className="truncate" title={exportNotice.message}>
            {exportNotice.message}
          </span>
          {onClearExportNotice && (
            <button
              onClick={onClearExportNotice}
              className="p-0.5 hover:text-white transition-colors cursor-pointer shrink-0 ml-1"
              title="Dismiss notice"
            >
              <X size={12} />
            </button>
          )}
        </div>
      )}

      {/* Master Export Buttons */}
      <div className="flex items-center gap-2">
        {isExporting ? (
          <div className="flex items-center gap-2 text-indigo-400 font-medium">
            <Loader2 size={15} className="animate-spin" />
            <span>{exportProgress}</span>
          </div>
        ) : (
          <>
            <button
              onClick={onExportStitchedWav}
              disabled={timelineClipsLength === 0}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold shadow-lg cursor-pointer transition-all active:scale-95 disabled:opacity-40"
              title="Render master broadcast WAV file with -16 LUFS loudness matching"
            >
              <Download size={13} />
              <span>Export Stitched WAV</span>
            </button>

            <button
              onClick={onExportAudacityLabels}
              disabled={timelineClipsLength === 0}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-lg border border-slate-700 font-semibold cursor-pointer transition-colors disabled:opacity-40"
              title="Export Audacity / DAW label track marker file"
            >
              <FileText size={13} className="text-amber-400" />
              <span>Audacity Labels</span>
            </button>

            <button
              onClick={onExportManifestJson}
              disabled={timelineClipsLength === 0}
              className="px-2.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg border border-slate-700 font-semibold cursor-pointer transition-colors disabled:opacity-40"
              title="Export JSON recipe"
            >
              <span>JSON</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default StudioExportBar;
