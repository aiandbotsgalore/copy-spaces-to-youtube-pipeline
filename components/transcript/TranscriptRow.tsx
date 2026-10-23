import React from 'react';
import { Film, Pencil, Scissors, Clock } from 'lucide-react';
import { ParsedUtterance, UtteranceWord, formatSeconds, getSpeakerTheme } from '../../utils/transcriptData';

type Theme = ReturnType<typeof getSpeakerTheme>;

export interface RowActions {
  play: (sec: number) => void;
  rename: (rawSpeaker: string, name: string) => void;
  slice: (u: ParsedUtterance) => void;
  addToReel: (u: ParsedUtterance) => void;
  syncAudio: (u: ParsedUtterance) => void;
}

export interface TranscriptRowProps {
  utterance: ParsedUtterance;
  theme: Theme;
  striped: boolean;
  active: boolean;
  /** only supplied for the active row */
  words: UtteranceWord[];
  activeWordIndex: number;
  query: string;
  highlight: (text: string, query: string) => React.ReactNode;
  isPlaying: boolean;
  inSelection: boolean;
  actions: RowActions;
}

/** Map a click inside the paragraph to the word under the caret, so every word seeks without a span per word. */
function wordIndexAtClick(e: React.MouseEvent<HTMLElement>): number | null {
  const doc = document as any;
  let node: Node | null = null;
  let offset = 0;
  if (typeof doc.caretPositionFromPoint === 'function') {
    const p = doc.caretPositionFromPoint(e.clientX, e.clientY);
    if (p) { node = p.offsetNode; offset = p.offset; }
  } else if (typeof doc.caretRangeFromPoint === 'function') {
    const r = doc.caretRangeFromPoint(e.clientX, e.clientY);
    if (r) { node = r.startContainer; offset = r.startOffset; }
  }
  const root = e.currentTarget;
  if (!node || !root.contains(node)) return null;
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(node, offset);
  const charPos = range.toString().length;
  const text = root.textContent || '';
  const re = /\S+/g;
  let idx = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index <= charPos) idx++;
    else break;
  }
  return Math.max(0, idx);
}

const TranscriptRowBase: React.FC<TranscriptRowProps> = ({
  utterance: u, theme, striped, active, words, activeWordIndex, query, highlight, isPlaying, inSelection, actions,
}) => {
  const initial = u.speaker.replace(/^Speaker\s+/i, '').trim().charAt(0).toUpperCase() || 'S';

  const onTextClick = (e: React.MouseEvent<HTMLParagraphElement>) => {
    if (window.getSelection()?.toString()) return; // a drag-select just finished
    const idx = wordIndexAtClick(e);
    const all = u.words && u.words.length ? u.words : null;
    if (idx !== null && all && all[idx]) { actions.play(all[idx].start); return; }
    if (idx !== null) {
      const tokens = u.text.trim().split(/\s+/);
      const frac = tokens.length > 1 ? idx / tokens.length : 0;
      const span = (u.endSec ?? u.startSec + tokens.length * 0.38) - u.startSec;
      actions.play(u.startSec + frac * span);
      return;
    }
    actions.play(u.startSec);
  };

  return (
    <div
      id={`utterance-card-${u.id}`}
      data-turn={u.id}
      className={`group grid grid-cols-[64px_104px_minmax(0,1fr)_auto] gap-x-4 items-start px-4 py-2.5 rounded-lg border transition-colors ${
        active
          ? 'bg-a1/10 border-a1/60'
          : inSelection
            ? 'bg-cyan/10 border-cyan/30'
            : `border-transparent ${striped ? 'bg-row' : ''} hover:bg-card/60`
      }`}
    >
      <button
        onClick={() => actions.play(u.startSec)}
        title={u.endLabel ? `${u.startLabel} – ${u.endLabel}` : u.startLabel}
        className={`font-mono text-[11px] pt-1 text-left cursor-pointer ${active ? 'text-a0' : 'text-slate-400 hover:text-white'}`}
      >
        {u.startLabel}
      </button>

      <button
        onClick={() => actions.rename(u.rawSpeaker, u.speaker)}
        title={`Rename ${u.speaker} across this episode`}
        className={`group/tag w-full flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] ${theme.badge} hover:brightness-110 cursor-pointer min-w-0`}
      >
        {theme.emoji
          ? <span className="text-xs flex-shrink-0">{theme.emoji}</span>
          : <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${theme.dot}`} />}
        <span className="truncate">{u.speaker || initial}</span>
        <Pencil size={9} className="ml-auto opacity-0 group-hover/tag:opacity-60 flex-shrink-0" />
      </button>

      {active && words.length > 0 ? (
        <p data-turn-text={u.id} className="text-[15px] leading-relaxed max-w-[68ch] text-slate-100 select-text">
          {words.map((w, i) => {
            const isActive = i === activeWordIndex;
            const isPast = activeWordIndex >= 0 && i < activeWordIndex;
            return (
              <React.Fragment key={i}>
                <span
                  onClick={e => { e.stopPropagation(); actions.play(w.start); }}
                  title={`Play from ${formatSeconds(w.start)}`}
                  className={`cursor-pointer rounded px-0.5 -mx-0.5 ${
                    isActive ? 'bg-a1 text-white font-semibold' : isPast ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {highlight(w.word, query)}
                </span>{' '}
              </React.Fragment>
            );
          })}
        </p>
      ) : (
        <p
          data-turn-text={u.id}
          onClick={onTextClick}
          className="text-[15px] leading-relaxed max-w-[68ch] text-slate-200 select-text cursor-text"
        >
          {highlight(u.text, query)}
        </p>
      )}

      <div className="flex items-center gap-1 pt-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        {isPlaying && (
          <button
            onClick={() => actions.syncAudio(u)}
            title="Align audio playback to this turn"
            className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-line/60 cursor-pointer"
          >
            <Clock size={12} />
          </button>
        )}
        <button
          onClick={() => actions.slice(u)}
          title="Fine-tune boundaries and slice audio"
          className="p-1.5 rounded-md text-slate-400 hover:text-amber hover:bg-line/60 cursor-pointer"
        >
          <Scissors size={12} />
        </button>
        <button
          onClick={() => actions.addToReel(u)}
          title="Add to Reel"
          className="flex items-center gap-1 px-2 py-1 rounded-md bg-a1/15 text-a0 hover:bg-a1/25 text-[11px] font-semibold cursor-pointer"
        >
          <Film size={11} /> Reel
        </button>
        {typeof u.confidence === 'number' && (
          <span
            title="Confidence"
            className={`ml-1 font-mono text-[10px] ${u.confidence >= 0.9 ? 'text-emerald' : u.confidence >= 0.75 ? 'text-amber' : 'text-pink'}`}
          >
            {(u.confidence * 100).toFixed(0)}
          </span>
        )}
      </div>
    </div>
  );
};

export const TranscriptRow = React.memo(TranscriptRowBase);
