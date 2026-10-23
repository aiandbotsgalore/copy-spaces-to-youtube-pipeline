import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Copy, Download, ExternalLink, Podcast, Share2 } from 'lucide-react';

export interface ExportMenuProps {
  disabled: boolean;
  copied: boolean;
  sourceUrl?: string;
  onCopy: () => void;
  onDownload: (format: 'txt' | 'json') => void;
  onPublishPreview?: () => void;
}

export const ExportMenu: React.FC<ExportMenuProps> = ({ disabled, copied, sourceUrl, onCopy, onDownload, onPublishPreview }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const item = 'w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left text-slate-200 hover:bg-line/60 disabled:opacity-40 disabled:hover:bg-transparent cursor-pointer';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Export"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-line bg-card text-slate-300 hover:text-white cursor-pointer"
      >
        <Share2 size={13} />
        <ChevronDown size={12} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-1.5 w-44 py-1 rounded-lg border border-line bg-card shadow-2xl z-30">
          {onPublishPreview && (
            <button role="menuitem" className={item} onClick={() => { onPublishPreview(); setOpen(false); }}>
              <Podcast size={13} /> Publish preview
            </button>
          )}
          <button role="menuitem" className={item} disabled={disabled} onClick={() => { onCopy(); setOpen(false); }}>
            {copied ? <Check size={13} className="text-emerald" /> : <Copy size={13} />} Copy
          </button>
          <button role="menuitem" className={item} disabled={disabled} onClick={() => { onDownload('txt'); setOpen(false); }}>
            <Download size={13} /> .txt
          </button>
          <button role="menuitem" className={item} disabled={disabled} onClick={() => { onDownload('json'); setOpen(false); }}>
            <Download size={13} /> .json
          </button>
          {sourceUrl && (
            <a role="menuitem" className={item} href={sourceUrl} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>
              <ExternalLink size={13} /> Source Space
            </a>
          )}
        </div>
      )}
    </div>
  );
};
