import React, { useEffect } from 'react';
import { Check, Copy, Loader, Podcast, Rocket, X } from 'lucide-react';
import { formatSeconds } from '../../utils/transcriptData';

export interface PreviewChapter {
  startSec: number;
  label: string;
}

export interface PublishPreviewProps {
  open: boolean;
  onClose: () => void;
  feedUrl: string;
  feedTitle: string;
  author: string;
  artworkUrl: string | null;
  episodeTitle: string;
  metaLine: string;
  chapters: PreviewChapter[];
  onSeekChapter: (sec: number) => void;
  feedCopied: boolean;
  onCopyFeed: () => void;
  canPublish: boolean;
  publishing: boolean;
  publishMessage: { kind: 'ok' | 'err'; text: string } | null;
  onPublish: () => void;
}

export const PublishPreview: React.FC<PublishPreviewProps> = (p) => {
  useEffect(() => {
    if (!p.open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') p.onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [p.open, p.onClose]);
  if (!p.open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={p.onClose} role="dialog" aria-modal="true" aria-label="Publish preview">
      <div onClick={e => e.stopPropagation()} className="w-full max-w-xl max-h-[88vh] overflow-y-auto rounded-xl border border-line bg-card shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2"><Podcast size={15} className="text-a0" /> Publish preview</h3>
          <button onClick={p.onClose} aria-label="Close" className="text-slate-400 hover:text-white cursor-pointer"><X size={15} /></button>
        </div>

        <div className="p-5 space-y-5">
          <div className="flex gap-4">
            <div className="w-24 h-24 rounded-lg border border-line bg-row flex-shrink-0 overflow-hidden flex items-center justify-center text-[10px] text-slate-500 text-center px-2">
              {p.artworkUrl ? <img src={p.artworkUrl} alt="Cover art" className="w-full h-full object-cover" /> : 'No cover art set'}
            </div>
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wider text-slate-400">{p.feedTitle}{p.author ? ` · ${p.author}` : ''}</p>
              <h4 className="text-base font-semibold text-white mt-1 leading-snug">{p.episodeTitle}</h4>
              <p className="text-xs font-mono text-slate-400 mt-1.5">{p.metaLine}</p>
            </div>
          </div>

          <div>
            <p className="text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">Feed URL</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 truncate px-3 py-2 rounded-lg bg-row border border-line text-xs text-slate-200">{p.feedUrl || 'Set your GitHub owner and repo in Repo & Podcast'}</code>
              <button onClick={p.onCopyFeed} disabled={!p.feedUrl} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-line text-xs font-medium text-slate-200 hover:bg-row disabled:opacity-40 cursor-pointer">
                {p.feedCopied ? <Check size={13} className="text-emerald" /> : <Copy size={13} />} {p.feedCopied ? 'Copied' : 'Copy RSS'}
              </button>
            </div>
          </div>

          <div>
            <p className="text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">Chapters <span className="normal-case tracking-normal text-slate-500">· generated from turns, click to jump</span></p>
            {p.chapters.length === 0 ? (
              <p className="text-xs text-slate-500">Load a transcript to preview chapters.</p>
            ) : (
              <ul className="rounded-lg border border-line divide-y divide-line overflow-hidden">
                {p.chapters.map(c => (
                  <li key={c.startSec}>
                    <button onClick={() => { p.onSeekChapter(c.startSec); p.onClose(); }} className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-row cursor-pointer">
                      <span className="font-mono text-[11px] text-a0 w-14 flex-shrink-0">{formatSeconds(c.startSec)}</span>
                      <span className="text-xs text-slate-200 truncate">{c.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {p.publishMessage && (
            <p className={`text-xs rounded-lg px-3 py-2 border ${p.publishMessage.kind === 'ok' ? 'text-emerald border-emerald/30 bg-emerald/10' : 'text-rose-300 border-rose-500/30 bg-rose-500/10'}`}>
              {p.publishMessage.text}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-t border-line">
          <p className="text-[11px] text-slate-500">Publish rebuilds the feed from every episode on GitHub; it does not publish this one alone.</p>
          <button
            onClick={p.onPublish}
            disabled={!p.canPublish || p.publishing}
            title={p.canPublish ? 'Run the Update RSS workflow' : 'Connect a GitHub token to publish'}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-a1 hover:brightness-110 text-white text-xs font-semibold disabled:opacity-40 cursor-pointer flex-shrink-0"
          >
            {p.publishing ? <Loader size={13} className="animate-spin" /> : <Rocket size={13} />} Publish
          </button>
        </div>
      </div>
    </div>
  );
};
