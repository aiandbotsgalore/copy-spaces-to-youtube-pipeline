import React, { useState, useCallback, useEffect } from 'react';
import { List, RefreshCw, AlertCircle, Globe, Youtube, Mic2, Linkedin } from 'lucide-react';
import { EnhancedConfig } from '../types';
import { getRepositoryDefaultBranch, readRepositoryTextFile } from '../utils/github';

interface Props {
  config: EnhancedConfig;
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
  return { label: 'URL', icon: <Globe size={13} />, color: 'text-slate-400' };
}

const LiveQueuePanel: React.FC<Props> = ({ config }) => {
  const [urls, setUrls] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  const hasCredentials = !!(config.githubToken && config.ownerName && config.repoName);

  const fetchQueue = useCallback(async () => {
    if (!hasCredentials) return;
    setLoading(true);
    setError('');
    try {
      const branch = await getRepositoryDefaultBranch(config.githubToken, config.ownerName.trim(), config.repoName.trim());
      const file = await readRepositoryTextFile(
        config.githubToken,
        config.ownerName.trim(),
        config.repoName.trim(),
        'batch_queue.txt',
        branch
      );
      const lines = (file?.content || '')
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean);
      setUrls(lines);
      setLoaded(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [config.githubToken, config.ownerName, config.repoName, hasCredentials]);

  useEffect(() => {
    if (hasCredentials && !loaded && !loading) fetchQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasCredentials]);

  return (
    <div className="h-full overflow-y-auto p-6 md:p-12 max-w-3xl mx-auto w-full">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-sky-500/15 border border-sky-500/20 rounded-xl">
              <List size={18} className="text-sky-400" />
            </div>
            <h2 className="text-2xl font-bold text-white">Batch Queue</h2>
          </div>
          <p className="text-slate-400 text-sm">
            Live contents of <code className="text-sky-400 bg-slate-800 px-1 rounded text-xs">batch_queue.txt</code> in your repo —
            processed in order, top to bottom, by the scheduled monitor workflow.
          </p>
        </div>
        <button
          onClick={fetchQueue}
          disabled={loading || !hasCredentials}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex-shrink-0"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {!hasCredentials && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="p-4 bg-slate-800 rounded-2xl mb-4"><AlertCircle size={28} className="text-slate-500" /></div>
          <p className="text-slate-400 text-sm font-medium">GitHub connection required</p>
          <p className="text-slate-600 text-xs mt-1">Connect your account and configure your repo to view the live queue.</p>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-xl mb-4">
          <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {loaded && urls.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="p-4 bg-slate-800 rounded-2xl mb-4"><List size={28} className="text-slate-500" /></div>
          <p className="text-slate-400 text-sm font-medium">Queue is empty</p>
          <p className="text-slate-600 text-xs mt-1">Use "Add to Queue" from Command Center or Submit New Space.</p>
        </div>
      )}

      {urls.length > 0 && (
        <div className="space-y-2">
          {urls.map((url, i) => {
            const platform = detectPlatform(url);
            return (
              <div key={`${url}-${i}`} className="flex items-center gap-3 p-3.5 bg-slate-900 border border-slate-800 rounded-xl">
                <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center bg-slate-800 rounded-full text-[10px] font-bold text-slate-400">
                  {i + 1}
                </span>
                <span className={`flex-shrink-0 flex items-center gap-1 text-[10px] font-medium ${platform.color}`}>
                  {platform.icon} {platform.label}
                </span>
                <span className="flex-1 min-w-0 text-sm text-slate-300 font-mono truncate">{url}</span>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-6 text-[11px] text-slate-600">
        Reordering or removing individual entries isn't supported yet — edit{' '}
        <code className="text-slate-500">batch_queue.txt</code> directly on GitHub for now.
      </p>
    </div>
  );
};

export default LiveQueuePanel;
