import React from 'react';
import { Check, Headphones, Loader, Pause, Play, Sparkles } from 'lucide-react';

export type QueueStage = 'fetch' | 'transcribe' | 'diarize' | 'index';

const STAGES: Array<{ key: QueueStage; label: string }> = [
  { key: 'fetch', label: 'Fetch' },
  { key: 'transcribe', label: 'Transcribe' },
  { key: 'diarize', label: 'Diarize' },
  { key: 'index', label: 'Index' },
];

export interface QueuedEpisodeProps {
  partLabel?: string;
  hasAudio: boolean;
  isPlaying: boolean;
  onTogglePlay: () => void;
  /** 1-based place in transcription_status.next_in_queue, when this episode is listed there */
  position: number | null;
  queueLength: number | null;
  /** Only known once the pipeline writes stages into transcription_status.json */
  stage: QueueStage | null;
  etaLabel?: string;
  transcribing: boolean;
  success: string | null;
  onPrioritize: () => void;
}

/** Shown for episodes that have audio but no transcript yet. */
export const QueuedEpisode: React.FC<QueuedEpisodeProps> = (p) => {
  const stageIdx = p.stage ? STAGES.findIndex(s => s.key === p.stage) : -1;
  const label = p.partLabel ? ` (${p.partLabel})` : '';
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-16 max-w-xl mx-auto w-full">
      <div className="w-14 h-14 rounded-xl bg-amber/10 border border-amber/30 flex items-center justify-center mb-4 text-amber">
        {p.hasAudio ? <Headphones size={26} /> : <Sparkles size={26} />}
      </div>
      <h4 className="text-base font-semibold text-white">Queued for transcription{label}</h4>
      <p className="text-xs text-slate-400 mt-1.5 mb-6 leading-relaxed">
        {p.position
          ? <>Position <span className="font-mono text-slate-200">#{p.position}</span>{p.queueLength ? <> of <span className="font-mono text-slate-200">{p.queueLength}</span> waiting</> : null}{p.etaLabel ? <> · about <span className="font-mono text-slate-200">{p.etaLabel}</span></> : null}.</>
          : 'This episode has audio and will be transcribed automatically, newest first.'}
      </p>

      <ol className="flex items-center w-full max-w-md mb-7" aria-label="Pipeline stages">
        {STAGES.map((s, i) => {
          const done = stageIdx > i;
          const current = stageIdx === i;
          return (
            <li key={s.key} className="flex-1 flex flex-col items-center gap-1.5 relative">
              {i > 0 && <span className={`absolute top-3 right-1/2 w-full h-px ${done || current ? 'bg-a1' : 'bg-line'}`} />}
              <span className={`relative z-10 w-6 h-6 rounded-full border flex items-center justify-center text-[10px] font-mono ${
                done ? 'bg-a1 border-a1 text-white' : current ? 'border-a1 text-a0 bg-bg animate-pulse' : 'border-line text-slate-500 bg-bg'
              }`}>
                {done ? <Check size={12} /> : i + 1}
              </span>
              <span className={`text-[11px] ${current ? 'text-white' : 'text-slate-400'}`}>{s.label}</span>
            </li>
          );
        })}
      </ol>
      {!p.stage && <p className="text-[11px] text-slate-500 -mt-4 mb-6">Stage detail appears once the pipeline reports it.</p>}

      {p.success ? (
        <div className="p-4 bg-emerald/10 border border-emerald/30 rounded-xl text-emerald text-xs text-left w-full">
          <p className="font-semibold flex items-center gap-1.5"><Check size={14} /> Job dispatched</p>
          <p className="mt-1 opacity-90">{p.success}</p>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row items-center gap-3">
          {p.hasAudio && (
            <button onClick={p.onTogglePlay} className="flex items-center gap-2 px-4 py-2 bg-a1 hover:brightness-110 text-white text-xs font-semibold rounded-lg cursor-pointer">
              {p.isPlaying ? <Pause size={14} /> : <Play size={14} />}
              {p.isPlaying ? 'Pause audio' : 'Play audio'}
            </button>
          )}
          <button onClick={p.onPrioritize} disabled={p.transcribing} className="flex items-center gap-2 px-4 py-2 bg-card hover:brightness-125 disabled:opacity-50 text-white text-xs font-semibold rounded-lg border border-line cursor-pointer">
            {p.transcribing ? <Loader size={14} className="animate-spin" /> : <Sparkles size={14} className="text-amber" />}
            {p.transcribing ? 'Dispatching…' : 'Prioritize'}
          </button>
        </div>
      )}
    </div>
  );
};
