import React, { useEffect, useState } from 'react';
import { Bot, Copy, Scissors, X } from 'lucide-react';
import { formatSeconds } from '../../utils/transcriptData';

export interface SelectionInfo {
  text: string;
  startSec: number;
  endSec: number;
  speaker: string;
  turnIds: string[];
}

export interface SelectionBarProps {
  /** Resolve a rendered turn id to its timing/speaker. */
  resolveTurn: (id: string) => { startSec: number; endSec: number | null; speaker: string } | null;
  onClip: (sel: SelectionInfo) => void;
  onAsk: (sel: SelectionInfo) => void;
}

/** Floating action bar shown while transcript text is selected (drag across words or turns). */
export const SelectionBar: React.FC<SelectionBarProps> = ({ resolveTurn, onClip, onAsk }) => {
  const [sel, setSel] = useState<SelectionInfo | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let timer: number | undefined;
    const read = () => {
      const s = window.getSelection();
      if (!s || s.isCollapsed || s.rangeCount === 0) { setSel(null); return; }
      const text = s.toString().replace(/\s+/g, ' ').trim();
      if (text.length < 3) { setSel(null); return; }
      const range = s.getRangeAt(0);
      const turnEls = Array.from(document.querySelectorAll<HTMLElement>('[data-turn]'))
        .filter(el => range.intersectsNode(el));
      if (!turnEls.length) { setSel(null); return; }
      const ids = turnEls.map(el => el.dataset.turn as string);
      const first = resolveTurn(ids[0]);
      const last = resolveTurn(ids[ids.length - 1]);
      if (!first || !last) { setSel(null); return; }
      const endSec = last.endSec ?? last.startSec + 8;
      setSel({ text, startSec: first.startSec, endSec: Math.max(endSec, first.startSec + 3), speaker: first.speaker, turnIds: ids });
    };
    const onChange = () => { window.clearTimeout(timer); timer = window.setTimeout(read, 120); };
    document.addEventListener('selectionchange', onChange);
    return () => { document.removeEventListener('selectionchange', onChange); window.clearTimeout(timer); };
  }, [resolveTurn]);

  if (!sel) return null;
  const clear = () => { window.getSelection()?.removeAllRanges(); setSel(null); };
  const words = sel.text.split(' ').length;

  return (
    <div
      role="toolbar"
      aria-label="Selection actions"
      onMouseDown={e => e.preventDefault()}
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1.5 pl-3.5 pr-1.5 py-1.5 rounded-xl border border-cyan/40 bg-card shadow-2xl shadow-black/50"
    >
      <span className="text-[11px] font-mono text-cyan mr-1.5 whitespace-nowrap">
        {words} words · {formatSeconds(sel.startSec)}–{formatSeconds(sel.endSec)}
      </span>
      <button
        onClick={() => { onClip(sel); clear(); }}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-a1 hover:brightness-110 cursor-pointer"
      >
        <Scissors size={13} /> Clip
      </button>
      <button
        onClick={() => { onAsk(sel); clear(); }}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-200 border border-line hover:bg-row cursor-pointer"
      >
        <Bot size={13} /> Ask
      </button>
      <button
        onClick={async () => {
          try { await navigator.clipboard.writeText(sel.text); setCopied(true); window.setTimeout(() => setCopied(false), 1200); } catch { /* clipboard blocked */ }
        }}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-200 border border-line hover:bg-row cursor-pointer"
      >
        <Copy size={13} /> {copied ? 'Copied' : 'Copy'}
      </button>
      <button onClick={clear} aria-label="Clear selection" className="p-1.5 rounded-lg text-slate-400 hover:text-white cursor-pointer">
        <X size={13} />
      </button>
    </div>
  );
};
