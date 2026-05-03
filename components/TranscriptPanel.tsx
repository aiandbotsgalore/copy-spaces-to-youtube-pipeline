import React, { useState, useCallback, useMemo } from 'react';
import { FileText, RefreshCw, AlertCircle, Search, ChevronDown, Loader, ExternalLink } from 'lucide-react';
import { Release, EnhancedConfig } from '../types';
import { getReleases, fetchAssetText } from '../utils/github';

interface Props {
  config: EnhancedConfig;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function highlight(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return parts.map((p, i) =>
    p.toLowerCase() === query.toLowerCase()
      ? <mark key={i} className="bg-amber-400/30 text-amber-200 rounded px-0.5">{p}</mark>
      : p
  );
}

const TranscriptPanel: React.FC<Props> = ({ config }) => {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [transcriptText, setTranscriptText] = useState('');
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState('');
  const [search, setSearch] = useState('');

  const hasCredentials = config.githubToken && config.ownerName && config.repoName;

  const fetchReleases = useCallback(async () => {
    if (!hasCredentials) return;
    setLoading(true);
    setError('');
    try {
      const data = await getReleases(config.githubToken, config.ownerName, config.repoName);
      setReleases(data.filter(r => r.assets.some(a => a.name.endsWith('.txt'))));
      setLoaded(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [config.githubToken, config.ownerName, config.repoName, hasCredentials]);

  const loadTranscript = async (release: Release) => {
    const asset = release.assets.find(a => a.name.endsWith('.txt'));
    if (!asset) return;
    if (selectedId === release.id && transcriptText) return;
    setSelectedId(release.id);
    setTranscriptLoading(true);
    setTranscriptError('');
    setTranscriptText('');
    try {
      const text = await fetchAssetText(asset.browser_download_url);
      setTranscriptText(text);
    } catch (e) {
      setTranscriptError((e as Error).message);
    } finally {
      setTranscriptLoading(false);
    }
  };

  const selectedRelease = releases.find(r => r.id === selectedId);

  const matchCount = useMemo(() => {
    if (!search.trim() || !transcriptText) return 0;
    const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    return (transcriptText.match(re) || []).length;
  }, [search, transcriptText]);

  const displayLines = useMemo(() => {
    if (!transcriptText) return [];
    return transcriptText.split('\n');
  }, [transcriptText]);

  return (
    <div className="h-full overflow-hidden flex flex-col">
      {/* Header */}
      <div className="p-6 md:px-12 md:pt-10 md:pb-6 border-b border-slate-800 flex items-start justify-between gap-4 flex-shrink-0">
        <div>
          <h2 className="text-2xl font-bold text-white mb-1">Transcripts</h2>
          <p className="text-slate-400 text-sm">
            Episode transcripts from{' '}
            <code className="text-sky-400 bg-slate-800 px-1 rounded text-xs">{config.ownerName}/{config.repoName}</code>
          </p>
        </div>
        <button
          onClick={fetchReleases}
          disabled={loading || !hasCredentials}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex-shrink-0"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Loading…' : loaded ? 'Refresh' : 'Load Transcripts'}
        </button>
      </div>

      {!hasCredentials && (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
          <div className="p-4 bg-slate-800 rounded-2xl mb-4"><AlertCircle size={28} className="text-slate-500" /></div>
          <p className="text-slate-400 text-sm font-medium">GitHub connection required</p>
        </div>
      )}

      {hasCredentials && !loaded && !loading && (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
          <div className="p-4 bg-slate-800 rounded-2xl mb-4"><FileText size={28} className="text-slate-500" /></div>
          <p className="text-slate-400 text-sm font-medium">Click "Load Transcripts" to find episodes with transcripts</p>
          <p className="text-slate-600 text-xs mt-2 max-w-xs">Transcripts are uploaded automatically when the Whisper AI feature is enabled.</p>
        </div>
      )}

      {error && (
        <div className="mx-6 md:mx-12 mt-4 flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
          <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {loaded && releases.length === 0 && !error && (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
          <div className="p-4 bg-slate-800 rounded-2xl mb-4"><FileText size={28} className="text-slate-500" /></div>
          <p className="text-slate-400 text-sm font-medium">No transcripts found</p>
          <p className="text-slate-600 text-xs mt-2 max-w-xs">Enable Whisper AI transcription in Features, then re-deploy and run an ingest. Transcripts are attached to each GitHub Release.</p>
        </div>
      )}

      {loaded && releases.length > 0 && (
        <div className="flex-1 flex min-h-0">
          {/* Episode list (sidebar) */}
          <div className="w-64 flex-shrink-0 border-r border-slate-800 overflow-y-auto">
            {releases.map(release => {
              const txtAsset = release.assets.find(a => a.name.endsWith('.txt'));
              return (
                <button
                  key={release.id}
                  onClick={() => loadTranscript(release)}
                  className={`w-full text-left p-4 border-b border-slate-800/60 hover:bg-slate-900 transition-colors ${selectedId === release.id ? 'bg-indigo-500/10 border-l-2 border-l-indigo-500' : ''}`}
                >
                  <p className="text-xs font-semibold text-white truncate">{release.name || release.tag_name}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{formatDate(release.published_at)}</p>
                  {txtAsset && (
                    <p className="text-[10px] text-amber-400/70 mt-0.5 truncate">{txtAsset.name}</p>
                  )}
                </button>
              );
            })}
          </div>

          {/* Transcript viewer */}
          <div className="flex-1 flex flex-col min-w-0">
            {!selectedId && (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                <ChevronDown size={24} className="text-slate-700 mb-3 rotate-90" />
                <p className="text-slate-600 text-sm">Select an episode to view its transcript</p>
              </div>
            )}

            {selectedId && (
              <>
                {/* Search bar */}
                <div className="p-4 border-b border-slate-800 flex items-center gap-3">
                  <div className="flex-1 relative">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type="text"
                      placeholder="Search transcript…"
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
                    />
                  </div>
                  {search && (
                    <span className="text-xs text-amber-400 whitespace-nowrap">
                      {matchCount} match{matchCount !== 1 ? 'es' : ''}
                    </span>
                  )}
                  {selectedRelease && (
                    <a
                      href={selectedRelease.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded-lg transition-colors"
                      title="View release on GitHub"
                    >
                      <ExternalLink size={13} />
                    </a>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                  {transcriptLoading && (
                    <div className="flex items-center gap-3 text-slate-400">
                      <Loader size={16} className="animate-spin" />
                      <span className="text-sm">Loading transcript…</span>
                    </div>
                  )}

                  {transcriptError && (
                    <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
                      <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
                      <div>
                        <p className="text-sm text-red-400">{transcriptError}</p>
                        <p className="text-xs text-slate-600 mt-1">GitHub release assets on public repos are usually accessible. Try opening the release on GitHub directly.</p>
                      </div>
                    </div>
                  )}

                  {transcriptText && (
                    <div className="font-mono text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">
                      {displayLines.map((line, i) => (
                        <div key={i} className="hover:bg-slate-800/40 px-1 rounded -mx-1">
                          {highlight(line, search)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default TranscriptPanel;
