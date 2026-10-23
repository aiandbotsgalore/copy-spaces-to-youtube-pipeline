import React, { useEffect } from 'react';
import { X } from 'lucide-react';

const ROWS: Array<[string, string]> = [
  ['Space', 'Play / pause'],
  ['← / →', 'Seek 1 second'],
  ['⇧ + ← / →', 'Seek 15 seconds'],
  [', / .', 'Nudge sync ∓0.1s'],
  ['F', 'Toggle follow'],
  ['M', 'Mute'],
  ['?', 'This cheat sheet'],
  ['Esc', 'Close / clear selection'],
];

export const ShortcutsOverlay: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <div onClick={e => e.stopPropagation()} className="w-[360px] rounded-xl border border-line bg-card p-5 shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white">Keyboard shortcuts</h3>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-white cursor-pointer"><X size={15} /></button>
        </div>
        <dl className="space-y-2">
          {ROWS.map(([k, d]) => (
            <div key={k} className="flex items-center justify-between text-[13px]">
              <dd className="text-slate-300">{d}</dd>
              <dt><kbd className="px-2 py-0.5 rounded border border-line bg-row font-mono text-[11px] text-slate-200">{k}</kbd></dt>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
};
