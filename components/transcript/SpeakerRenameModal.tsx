import React, { useState, useEffect } from 'react';
import { Pencil, X, Star, RotateCcw, Check } from 'lucide-react';
import { SavedSpeaker } from './SavedSpeakersModal';

export interface RenameTarget {
  rawSpeaker: string;
  currentName: string;
  turnCount?: number;
}

interface SpeakerRenameModalProps {
  target: RenameTarget | null;
  onClose: () => void;
  onApply: (rawSpeaker: string, newName: string, color: string, emoji: string, addToSaved: boolean) => void;
  onReset: (rawSpeaker: string) => void;
  onOpenSavedModal: () => void;
  savedSpeakers: SavedSpeaker[];
  defaultSavedSpeakers: SavedSpeaker[];
  speakerColorMap: Record<string, { bg: string; text: string; border: string; badge: string; dot: string; avatar: string }>;
  dynamicColorOrder: string[];
  getSpeakerTheme: (name: string, savedSpeakers?: SavedSpeaker[]) => any;
  getAutoSpeakerColor: (name: string) => string;
  getAutoSpeakerEmoji: (name: string) => string;
}

export const SpeakerRenameModal: React.FC<SpeakerRenameModalProps> = ({
  target,
  onClose,
  onApply,
  onReset,
  onOpenSavedModal,
  savedSpeakers,
  defaultSavedSpeakers,
  speakerColorMap,
  dynamicColorOrder,
  getSpeakerTheme,
  getAutoSpeakerColor,
  getAutoSpeakerEmoji,
}) => {
  const [quickRenameVal, setQuickRenameVal] = useState('');
  const [quickRenameColor, setQuickRenameColor] = useState('indigo');
  const [quickRenameEmoji, setQuickRenameEmoji] = useState('🎙️');
  const [quickRenameAddToSaved, setQuickRenameAddToSaved] = useState(false);

  useEffect(() => {
    if (target) {
      setQuickRenameVal(target.currentName);
      const clean = target.currentName.trim();
      const def = defaultSavedSpeakers.find((s) => s.name.toLowerCase() === clean.toLowerCase());
      const existing = savedSpeakers.find((s) => s.name.toLowerCase() === clean.toLowerCase());
      const initialColor = def?.color || existing?.color || (clean ? getAutoSpeakerColor(clean) : 'indigo');
      const initialEmoji = def?.avatarEmoji || existing?.avatarEmoji || (clean ? getAutoSpeakerEmoji(clean) : '🎙️');
      setQuickRenameColor(initialColor);
      setQuickRenameEmoji(initialEmoji);
      setQuickRenameAddToSaved(false);
    }
  }, [target]);

  if (!target) return null;

  const handleApply = () => {
    if (!quickRenameVal.trim()) return;
    onApply(target.rawSpeaker, quickRenameVal.trim(), quickRenameColor, quickRenameEmoji, quickRenameAddToSaved);
  };

  const displayName = quickRenameVal.trim() || target.rawSpeaker;
  const activeColor = quickRenameColor && speakerColorMap[quickRenameColor] ? quickRenameColor : getAutoSpeakerColor(displayName);
  const theme = speakerColorMap[activeColor] || speakerColorMap.indigo;
  const activeEmoji = quickRenameEmoji || getAutoSpeakerEmoji(displayName);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700/80 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-xl bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
              <Pencil size={18} />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Rename Speaker</h3>
              <p className="text-xs text-slate-400">
                Voice tag: <span className="font-mono text-slate-200 font-bold">{target.rawSpeaker}</span>
                {target.turnCount !== undefined ? ` • ${target.turnCount} turns in this episode` : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Input and preview */}
        <div className="space-y-3">
          <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider">
            Speaker Display Name:
          </label>
          <div className="relative">
            <input
              type="text"
              autoFocus
              value={quickRenameVal}
              onChange={(e) => {
                const newVal = e.target.value;
                setQuickRenameVal(newVal);
                const clean = newVal.trim();
                const def = defaultSavedSpeakers.find((s) => s.name.toLowerCase() === clean.toLowerCase());
                const existing = savedSpeakers.find((s) => s.name.toLowerCase() === clean.toLowerCase());
                if (def?.color || existing?.color) {
                  setQuickRenameColor(def?.color || existing?.color || 'indigo');
                } else if (clean) {
                  setQuickRenameColor(getAutoSpeakerColor(clean));
                }
                if (def?.avatarEmoji || existing?.avatarEmoji) {
                  setQuickRenameEmoji(def?.avatarEmoji || existing?.avatarEmoji || '🎙️');
                } else if (clean) {
                  setQuickRenameEmoji(getAutoSpeakerEmoji(clean));
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleApply();
                if (e.key === 'Escape') onClose();
              }}
              placeholder="e.g. Angela, Logan, Rick Doty…"
              className="w-full px-4 py-2.5 text-sm font-bold bg-slate-950 border-2 border-indigo-500 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-400/50 shadow-inner"
            />
            {quickRenameVal && (
              <button
                type="button"
                onClick={() => setQuickRenameVal('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <p className="text-[11px] text-slate-400">
            Renaming will immediately update all turns by <strong className="text-indigo-300">{target.rawSpeaker}</strong> across this entire episode.
          </p>

          {/* Live Badge Preview & Custom Color/Emoji */}
          <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Badge Preview:</span>
              <div className="flex items-center gap-2">
                <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold ${theme.avatar}`}>
                  {activeEmoji}
                </div>
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg border text-xs font-bold ${theme.badge}`}>
                  <span>{activeEmoji}</span>
                  <span>{displayName}</span>
                </span>
              </div>
            </div>

            {/* Color selection row */}
            <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-slate-800/80">
              <span className="text-[10px] text-slate-400 uppercase font-bold mr-1">Color:</span>
              {dynamicColorOrder.map((c) => {
                const cTheme = speakerColorMap[c] || speakerColorMap.indigo;
                const isPicked = activeColor === c;
                return (
                  <button
                    key={c}
                    type="button"
                    title={`Set theme to ${c}`}
                    onClick={() => setQuickRenameColor(c)}
                    className={`w-5 h-5 rounded-full transition-transform cursor-pointer ${cTheme.dot} ${
                      isPicked ? 'scale-125 ring-2 ring-white shadow-md' : 'opacity-60 hover:opacity-100 hover:scale-110'
                    }`}
                  />
                );
              })}
            </div>

            {/* Quick emoji selection row */}
            <div className="flex items-center gap-1 flex-wrap pt-1">
              <span className="text-[10px] text-slate-400 uppercase font-bold mr-1">Emoji:</span>
              {['🎙️', '🎧', '⚙️', '🧠', '👁️', '⚡', '🌹', '🌸', '🛸', '✨', '💫', '👑', '👽', '🤖', '🔥', '⭐'].map((em) => (
                <button
                  key={em}
                  type="button"
                  onClick={() => setQuickRenameEmoji(em)}
                  className={`w-6 h-6 rounded-md flex items-center justify-center text-xs transition-all cursor-pointer ${
                    activeEmoji === em ? 'bg-indigo-600 ring-2 ring-white scale-110' : 'bg-slate-900 hover:bg-slate-800 text-slate-300'
                  }`}
                >
                  {em}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* One-click Saved Speakers Quick Pick */}
        {savedSpeakers.length > 0 && (
          <div className="p-3.5 bg-slate-950/80 border border-slate-800 rounded-xl space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
                <Star size={12} className="text-amber-400 fill-amber-400" /> Quick-Pick Saved Speaker:
              </span>
              <button
                type="button"
                onClick={onOpenSavedModal}
                className="text-[11px] text-indigo-400 hover:text-indigo-300 underline cursor-pointer"
              >
                Manage List
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {savedSpeakers.map((s) => {
                const isSelected = quickRenameVal.trim().toLowerCase() === s.name.toLowerCase();
                const sTheme = getSpeakerTheme(s.name, savedSpeakers);
                return (
                  <button
                    key={s.id || s.name}
                    type="button"
                    onClick={() => {
                      setQuickRenameVal(s.name);
                      const color = s.color && speakerColorMap[s.color] ? s.color : getAutoSpeakerColor(s.name);
                      const emoji = s.avatarEmoji || getAutoSpeakerEmoji(s.name);
                      setQuickRenameColor(color);
                      setQuickRenameEmoji(emoji);
                    }}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      isSelected
                        ? `${sTheme.badge} ring-2 ring-white scale-105 shadow-lg brightness-110`
                        : `${sTheme.badge} opacity-75 hover:opacity-100 hover:scale-105`
                    }`}
                  >
                    <span className="text-sm">{s.avatarEmoji || sTheme.emoji || '🎙️'}</span>
                    <span>{s.name}</span>
                    {s.role && <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-300 font-normal">{s.role}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Permanent directory checkbox */}
        {quickRenameVal.trim() && !savedSpeakers.some((s) => s.name.toLowerCase() === quickRenameVal.trim().toLowerCase()) && (
          <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer p-2 rounded-xl bg-slate-950/50 border border-slate-800 hover:border-slate-700 transition-colors">
            <input
              type="checkbox"
              checked={quickRenameAddToSaved}
              onChange={(e) => setQuickRenameAddToSaved(e.target.checked)}
              className="w-4 h-4 rounded border-slate-700 text-indigo-600 focus:ring-indigo-500 bg-slate-900 cursor-pointer"
            />
            <span>Also add <strong className="text-white font-bold">"{quickRenameVal.trim()}"</strong> to Permanent Saved Speakers</span>
          </label>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-800">
          {target.currentName !== target.rawSpeaker ? (
            <button
              type="button"
              onClick={() => {
                onReset(target.rawSpeaker);
                onClose();
              }}
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
            >
              <RotateCcw size={12} /> Reset to Original
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={!quickRenameVal.trim()}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-bold rounded-lg transition-all shadow-lg cursor-pointer hover:scale-105"
            >
              <Check size={14} /> Update All Turns
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SpeakerRenameModal;
