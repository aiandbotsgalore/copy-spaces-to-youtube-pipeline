import React, { useState } from 'react';
import {
  Terminal, X, Sparkles, ArrowRight, Check, Copy
} from 'lucide-react';
import { VoiceProfile } from '../../types';

interface CliEnrollmentGuideModalProps {
  isOpen: boolean;
  targetProfile: VoiceProfile | null;
  onClose: () => void;
  onOpenEdit: (p: VoiceProfile) => void;
}

export const CliEnrollmentGuideModal: React.FC<CliEnrollmentGuideModalProps> = ({
  isOpen,
  targetProfile,
  onClose,
  onOpenEdit,
}) => {
  const [copiedCode, setCopiedCode] = useState(false);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700/80 rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-xl bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
              <Terminal size={18} />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Enroll Voice Sample</h3>
              <p className="text-xs text-slate-400">Generate 192-dim neural embedding using ECAPA-TDNN</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 text-xs text-slate-300">
          <p className="leading-relaxed">
            Add sample audio for <strong className="text-white font-bold">{targetProfile?.name || 'this speaker'}</strong> using either of the two enrollment methods below:
          </p>

          {/* Method 1: Cloud GitHub Action */}
          <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
                <Sparkles size={13} className="text-indigo-400" /> Method 1: 1-Click Cloud Runner (Recommended)
              </span>
              <span className="text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">Zero Local Setup</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Provide any direct link to a voice clip (.wav, .mp3, .m4a) in the profile editor, or run the <strong className="text-slate-200">Enroll Voice Profile</strong> action in GitHub. The cloud runner loads PyTorch &amp; SpeechBrain ECAPA-TDNN, extracts the 192-dim vector, and commits to <code className="text-indigo-300 font-mono">voice_profiles.json</code> automatically.
            </p>
            <div className="pt-1 flex items-center justify-between">
              <span className="text-[11px] font-mono text-slate-400">Workflow: .github/workflows/enroll_voice.yml</span>
              <button
                onClick={() => {
                  onClose();
                  if (targetProfile) onOpenEdit(targetProfile);
                }}
                className="text-xs font-bold text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer"
              >
                Open Profile to Enroll <ArrowRight size={12} />
              </button>
            </div>
          </div>

          {/* Method 2: Local CLI */}
          <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <Terminal size={13} className="text-emerald-400" /> Method 2: Local Command Line
              </span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(`python scripts/speaker_tool.py extract-samples --enroll "speaker_samples/${targetProfile?.name || 'speaker'}.wav" --name "${targetProfile?.name || 'Speaker'}"`);
                  setCopiedCode(true);
                  setTimeout(() => setCopiedCode(false), 2500);
                }}
                className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 cursor-pointer"
              >
                {copiedCode ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                {copiedCode ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <p className="text-[11px] text-slate-400">
              Run directly on your local machine or server with Python 3:
            </p>
            <pre className="p-2.5 bg-slate-900 rounded-lg text-emerald-300 font-mono text-[11px] overflow-x-auto select-all">
              python scripts/speaker_tool.py extract-samples --enroll "speaker_samples/{targetProfile?.name || 'speaker'}.wav" --name "{targetProfile?.name || 'Speaker'}"
            </pre>
          </div>

          <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl space-y-1">
            <span className="font-bold text-indigo-300 flex items-center gap-1 text-xs">
              <Sparkles size={12} /> Automatic Diarization Matching
            </span>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              Once enrolled, new Twitter Spaces transcribed by Whisper or WhisperX will automatically compute cosine similarity against this 192-dim vector and label speech turns accurately.
            </p>
          </div>
        </div>

        <div className="flex justify-end pt-3 border-t border-slate-800">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default CliEnrollmentGuideModal;
