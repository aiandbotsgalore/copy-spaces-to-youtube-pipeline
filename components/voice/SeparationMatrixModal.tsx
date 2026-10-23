import React from 'react';
import { Sparkles, X, Info } from 'lucide-react';
import { ConfusionPair } from './types';

interface SeparationMatrixModalProps {
  isOpen: boolean;
  onClose: () => void;
  stats: { total: number; enrolled: number; pending?: number; [key: string]: any };
  confusionPairs: ConfusionPair[];
}

export const SeparationMatrixModal: React.FC<SeparationMatrixModalProps> = ({
  isOpen,
  onClose,
  stats,
  confusionPairs,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700/80 rounded-xl max-w-3xl w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-xl bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
              <Sparkles size={18} />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Acoustic Separation Matrix &amp; Diarization Auditor</h3>
              <p className="text-xs text-slate-400">Pairwise cosine similarity between enrolled 192-dim neural vectors</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1 text-xs">
          {/* Summary Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
              <span className="text-[11px] uppercase font-bold text-slate-400">Total Enrolled Voices</span>
              <p className="text-xl font-black text-white">{stats.enrolled}</p>
            </div>
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
              <span className="text-[11px] uppercase font-bold text-slate-400">Evaluated Pairs</span>
              <p className="text-xl font-black text-indigo-400">{confusionPairs.length}</p>
            </div>
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
              <span className="text-[11px] uppercase font-bold text-slate-400">High Overlap Risks (&gt;75%)</span>
              <p className={`text-xl font-black ${confusionPairs.filter(p => p.risk === 'high').length > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                {confusionPairs.filter(p => p.risk === 'high').length}
              </p>
            </div>
          </div>

          {/* Guidance Box */}
          <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-slate-300 leading-relaxed text-[11px] space-y-1">
            <span className="font-bold text-indigo-300 flex items-center gap-1">
              <Info size={12} /> Diarization Quality Metric Interpretation
            </span>
            <p>
              Cosine similarity ranges from <strong>0.00</strong> (completely orthogonal vocal acoustics) to <strong>1.00</strong> (identical voice).
              Separation below <strong>0.65</strong> ensures razor-sharp multi-speaker discrimination.
              Pairs with <strong>&gt;0.75</strong> similarity run a slight risk of label mixing during crosstalk or degraded microphone conditions.
            </p>
          </div>

          {/* Pairs List */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Pairwise Similarity Scores</h4>
            {confusionPairs.length === 0 ? (
              <p className="p-4 text-center text-slate-400 bg-slate-950 rounded-xl border border-slate-800">
                At least 2 enrolled voice profiles with 192-dim vectors are required to calculate acoustic separation.
              </p>
            ) : (
              <div className="space-y-2">
                {confusionPairs.map((pair, idx) => (
                  <div
                    key={idx}
                    className={`p-3 rounded-xl border flex items-center justify-between gap-4 transition-all ${
                      pair.risk === 'high' ? 'bg-rose-500/10 border-rose-500/30 text-rose-200' :
                      pair.risk === 'moderate' ? 'bg-amber-500/10 border-amber-500/25 text-amber-200' :
                      'bg-slate-950/80 border-slate-800 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="font-mono text-xs font-bold text-slate-400">#{idx + 1}</span>
                      <div>
                        <span className="font-bold text-white text-xs">{pair.speakerA}</span>
                        <span className="text-slate-400 mx-2">↔</span>
                        <span className="font-bold text-white text-xs">{pair.speakerB}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 flex-shrink-0">
                      {/* Progress bar */}
                      <div className="w-24 bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-800 hidden sm:block">
                        <div
                          style={{ width: `${Math.round(pair.similarity * 100)}%` }}
                          className={`h-full rounded-full ${
                            pair.risk === 'high' ? 'bg-rose-500' :
                            pair.risk === 'moderate' ? 'bg-amber-400' :
                            'bg-emerald-400'
                          }`}
                        />
                      </div>

                      <span className="font-mono text-xs font-bold text-white">
                        {(pair.similarity * 100).toFixed(1)}%
                      </span>

                      <span className={`text-[11px] uppercase font-bold px-2 py-0.5 rounded-full border ${
                        pair.risk === 'high' ? 'bg-rose-500/20 text-rose-300 border-rose-500/40' :
                        pair.risk === 'moderate' ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' :
                        'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      }`}>
                        {pair.risk === 'high' ? 'High Overlap' : pair.risk === 'moderate' ? 'Moderate' : 'Optimal Separation'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end pt-3 border-t border-slate-800">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
          >
            Close Auditor
          </button>
        </div>
      </div>
    </div>
  );
};

export default SeparationMatrixModal;
