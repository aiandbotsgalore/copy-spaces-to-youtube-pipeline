import React, { useState, useCallback } from 'react';
import {
  Library, RefreshCw, ExternalLink, Download, Play, AlertCircle,
  CheckCircle, Loader, Music, FileText, RotateCcw
} from 'lucide-react';
import { Release, EnhancedConfig } from '../types';
import { getReleases, dispatchWorkflow } from '../utils/github';

interface Props {
  config: EnhancedConfig;
}

function parseDuration(body: string | null): string {
  if (!body) return '';
  const m = body.match(/METADATA::DURATION::(\d{2}:\d{2}:\d{2})/);
  return m ? m[1] : '';
}

function parseSourceId(body: string | null): string {
  if (!body) return '';
  const m = body.match(/METADATA::SOURCE_ID::(\S+)/);
  return m ? m[1] : '';
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const LibraryPanel: React.FC<Props> = ({ config }) => {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [dispatching, setDispatching] = useState<number | null>(null);
  const [dispatchMsg, setDispatchMsg] = useState<Record<number, string>>({});
  const [search, setSearch] = useState('');
  const [confirmRerun, setConfirmRerun] = useState<number | null>(null);

  const hasCredentials = config.githubToken && config.ownerName && config.repoName;

  const fetchLibrary = useCallback(async () => {
    if (!hasCredentials) return;
    setLoading(true);
    setError('');
    try {
      const data = await getReleases(config.githubToken, config.ownerName, config.repoName);
      setReleases(data);
      setLoaded(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [config.githubToken, config.ownerName, config.repoName, hasCredentials]);

  const handleRerun = async (release: Release) => {
    const mp3Asset = release.assets.find(a => a.name.endsWith('.mp3'));
    if (!mp3Asset) {
      setDispatchMsg(m => ({ ...m, [release.id]: 'No MP3 asset found to re-run.' }));
      return;
    }
    setConfirmRerun(null);
    setDispatching(release.id);
    setDispatchMsg(m => ({ ...m, [release.id]: '' }));
    try {
      await dispatchWorkflow(
        config.githubToken,
        config.ownerName,
        config.repoName,
        'ingest.yml',
        { space_url: release.html_url }
      );
      setDispatchMsg(m => ({ ...m, [release.id]: 'Workflow dispatched — check Run History.' }));
    } catch (e) {
      setDispatchMsg(m => ({ ...m, [release.id]: (e as Error).message }));
    } finally {
      setDispatching(null);
    }
  };

  const filtered = releases.filter(r =>
    !search.trim() || r.name.toLowerCase().includes(search.toLowerCase())
  );

  const mp3Count = releases.reduce((n, r) => n + r.assets.filter(a => a.name.endsWith('.mp3')).length, 0);
  const txtCount = releases.reduce((n, r) => n + r.assets.filter(a => a.name.endsWith('.txt')).length, 0);

  return (
    <div className="h-full overflow-y-auto p-6 md:p-12 max-w-4xl mx-auto w-full">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white mb-2">Episode Library</h2>
          <p className="text-slate-400 text-sm">
            All archived episodes from{' '}
            <code className="text-sky-400 bg-slate-800 px-1 rounded text-xs">{config.ownerName}/{config.repoName}</code>
          </p>
        </div>
        <button
          onClick={fetchLibrary}
          disabled={loading || !hasCredentials}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex-shrink-0"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Loading…' : loaded ? 'Refresh' : 'Load Library'}
        </button>
      </div>

      {!hasCredentials && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="p-4 bg-slate-800 rounded-2xl mb-4"><AlertCircle size={28} className="text-slate-500" /></div>
          <p className="text-slate-400 text-sm font-medium">GitHub connection required</p>
          <p className="text-slate-600 text-xs mt-1">Connect your account and configure the repo to browse your library.</p>
        </div>
      )}

      {hasCredentials && !loaded && !loading && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="p-4 bg-slate-800 rounded-2xl mb-4"><Library size={28} className="text-slate-500" /></div>
          <p className="text-slate-400 text-sm font-medium">Click "Load Library" to fetch your episodes</p>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-xl mb-4">
          <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {loaded && releases.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="p-4 bg-slate-800 rounded-2xl mb-4"><Music size={28} className="text-slate-500" /></div>
          <p className="text-slate-400 text-sm font-medium">No episodes yet</p>
          <p className="text-slate-600 text-xs mt-1">Episodes appear here after your first successful ingest run.</p>
        </div>
      )}

      {loaded && releases.length > 0 && (
        <div className="space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Episodes', value: releases.length, color: 'text-indigo-400' },
              { label: 'Audio files', value: mp3Count, color: 'text-emerald-400' },
              { label: 'Transcripts', value: txtCount, color: 'text-amber-400' },
            ].map(s => (
              <div key={s.label} className="p-3 bg-slate-900 border border-slate-800 rounded-xl text-center">
                <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-[10px] text-slate-500 uppercase tracking-wide mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Search */}
          <input
            type="text"
            placeholder="Search episodes…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
          />

          {/* Episode list */}
          <div className="space-y-2">
            {filtered.map(release => {
              const mp3 = release.assets.find(a => a.name.endsWith('.mp3'));
              const txt = release.assets.find(a => a.name.endsWith('.txt'));
              const duration = parseDuration(release.body);
              const sourceId = parseSourceId(release.body);

              return (
                <div key={release.id} className="p-4 bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl transition-all">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-9 h-9 flex items-center justify-center bg-indigo-500/10 rounded-full mt-0.5">
                      <Play size={14} className="text-indigo-400 translate-x-0.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-white truncate">{release.name || release.tag_name}</p>
                          <div className="flex items-center gap-2 flex-wrap mt-0.5">
                            <span className="text-xs text-slate-500">{formatDate(release.published_at)}</span>
                            {duration && <span className="text-xs text-slate-500">· {duration}</span>}
                            {mp3 && <span className="text-xs text-slate-600">· {formatSize(mp3.size)}</span>}
                            {txt && (
                              <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-amber-500/15 text-amber-400 rounded font-medium">
                                <FileText size={9} /> Transcript
                              </span>
                            )}
                          </div>
                          {sourceId && (
                            <p className="text-[10px] text-slate-700 mt-0.5 font-mono truncate">ID: {sourceId}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <a
                            href={release.html_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded-lg transition-colors"
                            title="View release on GitHub"
                          >
                            <ExternalLink size={13} />
                          </a>
                          {mp3 && (
                            <a
                              href={mp3.browser_download_url}
                              className="p-1.5 text-slate-500 hover:text-emerald-400 hover:bg-slate-800 rounded-lg transition-colors"
                              title="Download MP3"
                            >
                              <Download size={13} />
                            </a>
                          )}
                        </div>
                      </div>

                      {/* Re-run row */}
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        {confirmRerun === release.id ? (
                          <>
                            <span className="text-xs text-amber-400">Re-ingest this episode?</span>
                            <button
                              onClick={() => handleRerun(release)}
                              className="px-2 py-0.5 text-xs bg-amber-500/20 text-amber-400 rounded hover:bg-amber-500/30 transition-colors"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setConfirmRerun(null)}
                              className="px-2 py-0.5 text-xs bg-slate-800 text-slate-400 rounded hover:bg-slate-700 transition-colors"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setConfirmRerun(release.id)}
                            disabled={dispatching === release.id}
                            className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded transition-colors disabled:opacity-50"
                          >
                            {dispatching === release.id
                              ? <Loader size={9} className="animate-spin" />
                              : <RotateCcw size={9} />}
                            Re-ingest
                          </button>
                        )}
                        {dispatchMsg[release.id] && (
                          <span className={`text-[10px] ${dispatchMsg[release.id].includes('dispatched') ? 'text-emerald-400' : 'text-red-400'}`}>
                            {dispatchMsg[release.id].includes('dispatched')
                              ? <CheckCircle size={9} className="inline mr-1" />
                              : null}
                            {dispatchMsg[release.id]}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {filtered.length === 0 && search && (
            <p className="text-center text-slate-600 text-sm py-8">No episodes match "{search}"</p>
          )}
        </div>
      )}
    </div>
  );
};

export default LibraryPanel;
