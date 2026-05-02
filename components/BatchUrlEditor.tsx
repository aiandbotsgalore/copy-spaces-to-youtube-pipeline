import React, { useState } from 'react';
import { Plus, Trash2, Globe, Youtube, Mic2, Linkedin } from 'lucide-react';
import { EnhancedConfig } from '../types';

interface Props {
  config: EnhancedConfig;
  onChange: (updates: Partial<EnhancedConfig>) => void;
}

function detectPlatform(url: string): { label: string; icon: React.ReactNode; color: string } {
  const u = url.toLowerCase();
  if (u.includes('twitter.com') || u.includes('x.com'))
    return { label: 'Twitter/X', icon: <span className="font-bold text-xs">𝕏</span>, color: 'text-sky-400' };
  if (u.includes('youtube.com') || u.includes('youtu.be'))
    return { label: 'YouTube', icon: <Youtube size={13} />, color: 'text-red-400' };
  if (u.includes('clubhouse.com'))
    return { label: 'Clubhouse', icon: <Mic2 size={13} />, color: 'text-green-400' };
  if (u.includes('linkedin.com'))
    return { label: 'LinkedIn', icon: <Linkedin size={13} />, color: 'text-blue-400' };
  if (u.startsWith('http'))
    return { label: 'URL', icon: <Globe size={13} />, color: 'text-slate-400' };
  return { label: '', icon: null, color: '' };
}

const BatchUrlEditor: React.FC<Props> = ({ config, onChange }) => {
  const [newUrl, setNewUrl] = useState('');

  const urls = config.batchUrls || [];

  const addUrl = () => {
    const trimmed = newUrl.trim();
    if (!trimmed) return;
    onChange({ batchUrls: [...urls, trimmed] });
    setNewUrl('');
  };

  const removeUrl = (i: number) => {
    onChange({ batchUrls: urls.filter((_, idx) => idx !== i) });
  };

  const updateUrl = (i: number, val: string) => {
    const updated = [...urls];
    updated[i] = val;
    onChange({ batchUrls: updated });
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text');
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length > 1) {
      onChange({ batchUrls: [...urls, ...lines] });
    } else if (lines.length === 1) {
      setNewUrl(lines[0]);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 md:p-12 max-w-3xl mx-auto w-full">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white mb-2">Batch Queue</h2>
        <p className="text-slate-400 text-sm">
          Add multiple URLs to process in sequence. These populate <code className="bg-slate-800 px-1 rounded text-xs">batch_queue.txt</code> in your repository. Paste multiple URLs at once to add them all.
        </p>
      </div>

      <div className="space-y-6">
        <div className="flex gap-2">
          <textarea
            value={newUrl}
            onChange={e => setNewUrl(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addUrl(); } }}
            placeholder="Paste one or more URLs (one per line)..."
            rows={2}
            className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-4 py-3 text-sm text-white font-mono focus:outline-none focus:border-indigo-500 transition-colors resize-none"
          />
          <button
            onClick={addUrl}
            disabled={!newUrl.trim()}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors self-start"
          >
            <Plus size={16} />
            Add
          </button>
        </div>

        {urls.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-slate-800 rounded-xl">
            <Globe size={32} className="text-slate-700 mb-3" />
            <p className="text-slate-500 text-sm">No URLs in queue yet</p>
            <p className="text-slate-600 text-xs mt-1">Add a URL above to get started</p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{urls.length} URL{urls.length !== 1 ? 's' : ''} queued</span>
              <button
                onClick={() => onChange({ batchUrls: [] })}
                className="text-xs text-slate-600 hover:text-red-400 transition-colors"
              >
                Clear all
              </button>
            </div>

            {urls.map((url, i) => {
              const platform = detectPlatform(url);
              const isValid = url.startsWith('http');
              return (
                <div key={i} className="flex items-center gap-3 p-3 bg-slate-900 border border-slate-800 rounded-lg group">
                  <span className="text-slate-600 text-xs w-5 text-right flex-shrink-0">{i + 1}</span>
                  <div className={`flex-shrink-0 ${platform.color}`}>
                    {platform.icon}
                  </div>
                  <input
                    value={url}
                    onChange={e => updateUrl(i, e.target.value)}
                    className={`flex-1 min-w-0 bg-transparent text-xs font-mono focus:outline-none ${isValid ? 'text-slate-300' : 'text-red-400'}`}
                  />
                  {platform.label && (
                    <span className={`text-[10px] ${platform.color} flex-shrink-0 hidden sm:block`}>{platform.label}</span>
                  )}
                  {!isValid && url.trim() && (
                    <span className="text-[10px] text-red-400 flex-shrink-0">Invalid URL</span>
                  )}
                  <button
                    onClick={() => removeUrl(i)}
                    className="flex-shrink-0 p-1 text-slate-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all rounded"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="p-4 bg-slate-900/50 border border-slate-800 rounded-xl text-xs text-slate-500 space-y-1">
          <p className="font-medium text-slate-400">How batch processing works:</p>
          <p>1. URLs are saved to <code className="bg-slate-800 px-1 rounded text-slate-400">batch_queue.txt</code> in your repo.</p>
          <p>2. The monitor workflow runs on your configured schedule and promotes URLs one at a time.</p>
          <p>3. Each URL triggers the ingest pipeline and publishes a new episode.</p>
        </div>
      </div>
    </div>
  );
};

export default BatchUrlEditor;
