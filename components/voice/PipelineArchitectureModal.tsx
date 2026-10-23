import React from 'react';
import { HelpCircle, X } from 'lucide-react';

interface PipelineArchitectureModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PipelineArchitectureModal: React.FC<PipelineArchitectureModalProps> = ({
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700/80 rounded-xl max-w-xl w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HelpCircle size={18} className="text-amber-400" />
            <h3 className="text-base font-bold text-white">Voice Diarization Architecture</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3 text-xs text-slate-300 leading-relaxed max-h-[70vh] overflow-y-auto pr-2">
          <p>
            SpacePipe Gen utilizes a dual-tier acoustic and conversational identification architecture to automatically resolve speakers in audio spaces:
          </p>

          <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1.5">
            <h5 className="font-bold text-indigo-400">1. SpeechBrain ECAPA-TDNN Embeddings</h5>
            <p className="text-slate-400">
              Audio waveforms are projected into a 192-dimensional vector space using the <code className="text-indigo-300 font-mono">speechbrain/spkrec-ecapa-voxceleb</code> neural model. Distinct voices cluster together, allowing cosine similarity comparison against enrolled profiles stored in <code className="text-indigo-300 font-mono">voice_profiles.json</code>.
            </p>
          </div>

          <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1.5">
            <h5 className="font-bold text-emerald-400">2. Word-Level Boundary Diarization</h5>
            <p className="text-slate-400">
              WhisperX neural diarizer tracks word-level acoustic boundaries. Each speaker transition immediately flushes conversational turns, preserving brief interjections, backchannels, and rapid multi-party exchanges without text crosstalk bleed.
            </p>
          </div>

          <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1.5">
            <h5 className="font-bold text-indigo-400">3. Conversational Heuristics & LLM Consensus</h5>
            <p className="text-slate-400">
              Direct vocative address rules and self-introductions in the text are cross-referenced with your registered Voice Profile Library to guarantee accurate identification even in challenging audio environments.
            </p>
          </div>
        </div>

        <div className="flex justify-end pt-2 border-t border-slate-800">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
          >
            Got It
          </button>
        </div>
      </div>
    </div>
  );
};

export default PipelineArchitectureModal;
