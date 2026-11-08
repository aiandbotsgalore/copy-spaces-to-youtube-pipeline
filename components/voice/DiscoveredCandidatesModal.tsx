import React, { useState, useEffect } from 'react';
import { Users, X, Play, Plus, RefreshCw, CheckCircle2, Volume2, Sparkles } from 'lucide-react';

export interface SpeakerCandidate {
  id: string;
  suggested_name: string;
  raw_speaker: string;
  episode_count: number;
  episodes: string[];
  total_turns: number;
  total_duration_sec: number;
  sample_clips?: Array<{
    episode_tag: string;
    audio_url: string;
    start: number;
    end: number;
    snippet: string;
  }>;
}

interface DiscoveredCandidatesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onEnrollCandidate: (candidate: SpeakerCandidate) => void;
  onPlaySample?: (audioUrl: string, startSec: number) => void;
}

export const DiscoveredCandidatesModal: React.FC<DiscoveredCandidatesModalProps> = ({
  isOpen,
  onClose,
  onEnrollCandidate,
  onPlaySample,
}) => {
  const [candidates, setCandidates] = useState<SpeakerCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [playingClipId, setPlayingClipId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    fetch('/transcripts/speaker_candidates.json')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data?.candidates)) {
          setCandidates(data.candidates);
        }
      })
      .catch(() => {
        // Fallback or empty
        setCandidates([]);
      })
      .finally(() => setLoading(false));
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700/80 rounded-xl max-w-4xl w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-xl bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
              <Sparkles size={18} />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Auto-Discovered Speaker Candidates</h3>
              <p className="text-xs text-slate-400">
                Recurring unassigned speakers discovered across archive transcripts via conversational cues and turn clustering
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1 text-xs">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-slate-400">
              <RefreshCw size={20} className="animate-spin text-indigo-400" />
              <span>Scanning archive for candidate speaker clusters…</span>
            </div>
          ) : candidates.length === 0 ? (
            <div className="py-12 text-center text-slate-400 space-y-2">
              <Users size={32} className="mx-auto text-slate-600 opacity-50" />
              <p className="font-semibold text-slate-300">No unassigned candidate clusters found yet.</p>
              <p className="text-[11px] text-slate-500 max-w-md mx-auto">
                Run <code className="px-1 py-0.5 bg-slate-800 rounded font-mono text-indigo-300">python scripts/speaker_tool.py scan-candidates</code> to cluster unassigned speakers across historical spaces.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-slate-400 text-[11px] px-1">
                <span>Showing <strong>{candidates.length}</strong> discovered candidate clusters</span>
                <span>Sorted by hand-off detection confidence &amp; episode count</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {candidates.map(cand => {
                  const firstClip = cand.sample_clips?.[0];
                  return (
                    <div
                      key={cand.id}
                      className="p-3.5 bg-slate-950 border border-slate-800/90 rounded-xl space-y-2.5 hover:border-slate-700 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-white text-sm">{cand.suggested_name}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-indigo-300 border border-slate-700/80 font-mono">
                              {cand.raw_speaker}
                            </span>
                          </div>
                          <span className="text-[11px] text-slate-400">
                            {cand.episode_count} episode{cand.episode_count !== 1 ? 's' : ''} &bull; {cand.total_turns} turns ({cand.total_duration_sec}s speech)
                          </span>
                        </div>

                        <button
                          onClick={() => {
                            onEnrollCandidate(cand);
                            onClose();
                          }}
                          className="flex items-center gap-1 px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer flex-shrink-0"
                          title="Open enrollment modal pre-filled with this candidate"
                        >
                          <Plus size={12} />
                          <span>Enroll</span>
                        </button>
                      </div>

                      {/* Sample snippet */}
                      {firstClip && (
                        <div className="p-2 rounded bg-slate-900 border border-slate-800/80 text-[11px] text-slate-300 space-y-1.5">
                          <p className="line-clamp-2 italic text-slate-300">
                            &ldquo;{firstClip.snippet}&rdquo;
                          </p>
                          <div className="flex items-center justify-between text-[10px] text-slate-500">
                            <span className="truncate max-w-[180px] font-mono">{firstClip.episode_tag}</span>
                            {onPlaySample && firstClip.audio_url && (
                              <button
                                type="button"
                                onClick={() => {
                                  setPlayingClipId(cand.id);
                                  onPlaySample(firstClip.audio_url, firstClip.start);
                                }}
                                className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 font-bold transition-colors cursor-pointer"
                              >
                                <Play size={10} className="fill-current" />
                                <span>Preview Audio</span>
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
