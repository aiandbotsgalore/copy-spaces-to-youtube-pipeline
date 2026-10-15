import React, { useRef, useState } from 'react';

/**
 * Drag handle for resizable panes. Reports the ABSOLUTE pointer position (clientX or clientY) so the parent can
 * clamp against its own container; keyboard (arrow keys, 24 px steps) and double-click (reset) are supported.
 */
export const Splitter: React.FC<{
  orientation: 'vertical' | 'horizontal'; // vertical = a vertical bar that resizes columns; horizontal = a bar that resizes rows
  label: string;
  /** Current size, for assistive tech and keyboard stepping. */
  valueNow: number;
  onMove: (clientPos: number) => void;
  onStep: (deltaPx: number) => void;
  onEnd?: () => void;
  onReset?: () => void;
}> = ({ orientation, label, valueNow, onMove, onStep, onEnd, onReset }) => {
  const [dragging, setDragging] = useState(false);
  const active = useRef(false);
  const isCol = orientation === 'vertical';

  const pos = (e: React.PointerEvent) => (isCol ? e.clientX : e.clientY);

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={Math.round(valueNow)}
      tabIndex={0}
      title={`${label} (drag, arrow keys, or double-click to reset)`}
      onPointerDown={e => {
        if (e.button !== 0) return;
        active.current = true;
        setDragging(true);
        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
      }}
      onPointerMove={e => {
        if (active.current) onMove(pos(e));
      }}
      onPointerUp={e => {
        if (!active.current) return;
        active.current = false;
        setDragging(false);
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          /* already released */
        }
        onEnd?.();
      }}
      onPointerCancel={() => {
        active.current = false;
        setDragging(false);
        onEnd?.();
      }}
      onDoubleClick={() => onReset?.()}
      onKeyDown={e => {
        const step = 24;
        if (isCol && e.key === 'ArrowLeft') onStep(-step);
        else if (isCol && e.key === 'ArrowRight') onStep(step);
        else if (!isCol && e.key === 'ArrowUp') onStep(-step);
        else if (!isCol && e.key === 'ArrowDown') onStep(step);
        else return;
        e.preventDefault();
      }}
      style={{ touchAction: 'none' }}
      className={`group relative flex-shrink-0 flex items-center justify-center select-none outline-none ${
        isCol ? 'w-2 cursor-col-resize self-stretch' : 'h-2 w-full cursor-row-resize'
      }`}
    >
      <span
        className={`rounded-full transition-colors ${isCol ? 'w-px h-full' : 'h-px w-full'} ${
          dragging ? 'bg-indigo-400' : 'bg-slate-800 group-hover:bg-indigo-500/70 group-focus-visible:bg-indigo-400'
        }`}
      />
      <span
        className={`absolute rounded-full transition-colors ${isCol ? 'w-1 h-10' : 'h-1 w-10'} ${
          dragging ? 'bg-indigo-400' : 'bg-slate-700 group-hover:bg-indigo-400'
        }`}
      />
    </div>
  );
};

export default Splitter;
