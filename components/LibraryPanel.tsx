import React, { useState, useCallback, useEffect } from 'react';
import {
  Library, RefreshCw, ExternalLink, Download, Play, AlertCircle,
  CheckCircle, Loader, Music, FileText, RotateCcw, Copy, Trash2, X
} from 'lucide-react';
import { Release, EnhancedConfig } from '../types';
import { getReleases, dispatchWorkflow, deleteRelease } from '../utils/github';
import { usePlayer } from '../contexts/PlayerContext';

interface Props {
  config: EnhancedConfig;
}

interface DuplicateGroup {
  key: string;
  releases: Release[];
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function yyyymmddToDisplay(d: string): string {
  const y = d.slice(0, 4);
  const m = parseInt(d.slice(4, 6), 10) - 1;
  const day = d.slice(6, 8).replace(/^0/, '');
  return `${MONTHS[m] ?? '?'} ${day}, ${y}`;
}

function extractYYYYMMDD(body: string | null, tagName: string): string | null {
  if (body) {
    const m = body.match(/METADATA::EPISODE_DATE::(\d{8})/);
    if (m) return m[1];
  }
  const t = tagName.match(/^(\d{8})/);
  if (t) return t[1];
  return null;
}

function episodeDateDisplay(body: string | null, tagName: string): string | null {
  const raw = extractYYYYMMDD(body, tagName);
  return raw ? yyyymmddToDisplay(raw) : null;
}

function episodeDateMs(body: string | null, tagName: string): number {
  const raw = extractYYYYMMDD(body, tagName);
  if (!raw) return 0;
  return Date.UTC(
    parseInt(raw.slice(0, 4), 10),
    parseInt(raw.slice(4, 6), 10) - 1,
    parseInt(raw.slice(6, 8), 10)
  );
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

function findDuplicates(releases: Release[]): DuplicateGroup[] {
  const groups = new Map<string, Release[]>();
  for (const r of releases) {
    const sourceId = parseSourceId(r.body);
    const key = sourceId || r.name || r.tag_name;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  return Array.from(groups.entries())
    .filter(([, g]) => g.length > 1)
    .map(([key, g]) => ({
      key,
      releases: [...g].sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime()),
    }));
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

  const [sort, setSort] = useState<'date-desc' | 'date-asc' | 'dur-desc' | 'dur-asc'>('date-desc');

  const [dupMode, setDupMode] = useState(false);
  const [dupGroups, setDupGroups] = useState<DuplicateGroup[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState({ done: 0, total: 0 });
  const [deleteError, setDeleteError] = useState('');

  const { play, current, isPlaying } = usePlayer();

  const hasCredentials = !!(config.githubToken && config.ownerName && config.repoName);

  const fetchLibrary = useCallback(async () => {
    if (!hasCredentials) return;
    setLoading(true);
    setError('');
    try {
      const data = await getReleases(config.githubToken, config.ownerName.trim(), config.repoName.trim());
      setReleases(data);
      setLoaded(true);
      setDupMode(false);
      setSelected(new Set());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [config.githubToken, config.ownerName, config.repoName, hasCredentials]);

  useEffect(() => {
    if (hasCredentials && !loaded && !loading) {
      fetchLibrary();
    }
  }, [hasCredentials, loaded, loading, fetchLibrary]);

  const enterDupMode = () => {
    const groups = findDuplicates(releases);
    setDupGroups(groups);
    const preSelected = new Set<number>();
    for (const g of groups) {
      g.releases.slice(1).forEach(r => preSelected.add(r.id));
    }
    setSelected(preSelected);
    setDupMode(true);
    setDeleteError('');
  };

  const exitDupMode = () => {
    setDupMode(false);
    setSelected(new Set());
    setDeleteError('');
  };

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllInGroup = (group: DuplicateGroup) => {
    setSelected(prev => {
      const next = new Set(prev);
      group.releases.slice(1).forEach(r => next.add(r.id));
      return next;
    });
  };

  const handleBulkDelete = async () => {
    if (selected.size === 0) return;
    setDeleting(true);
    setDeleteError('');
    setDeleteProgress({ done: 0, total: selected.size });
    const ids = [...selected];
    let done = 0;
    const errors: string[] = [];
    for (const id of ids) {
      try {
        await deleteRelease(config.githubToken, config.ownerName.trim(), config.repoName.trim(), id);
        done++;
        setDeleteProgress({ done, total: ids.length });
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    setDeleting(false);
    if (errors.length) {
      setDeleteError(`${errors.length} deletion(s) failed: ${errors[0]}`);
    }
    await fetchLibrary();
  };

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

  function durationToSecs(body: string | null): number {
    const dur = parseDuration(body);
    if (!dur) return -1;
    const [h, m, s] = dur.split(':').map(Number);
    return h * 3600 + m * 60 + s;
  }

  const filtered = releases
    .filter(r => !search.trim() || r.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sort === 'date-desc') return episodeDateMs(b.body, b.tag_name) - episodeDateMs(a.body, a.tag_name);
      if (sort === 'date-asc')  return episodeDateMs(a.body, a.tag_name) - episodeDateMs(b.body, b.tag_name);
      if (sort === 'dur-desc')  return durationToSecs(b.body) - durationToSecs(a.body);
      if (sort === 'dur-asc')   return durationToSecs(a.body) - durationToSecs(b.body);
      return 0;
    });

  const mp3Count = releases.reduce((n, r) => n + r.assets.filter(a => a.name.endsWith('.mp3')).length, 0);
  const txtCount = releases.reduce((n, r) => n + r.assets.filter(a => a.name.endsWith('.txt')).length, 0);
  const dupCount = findDuplicates(releases).length;

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
        <div className="flex items-center gap-2 flex-shrink-0">
          {loaded && dupCount > 0 && !dupMode && (
            <button
              onClick={enterDupMode}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 border border-amber-500/30 rounded-lg transition-colors"
            >
              <Copy size={14} />
              {dupCount} Duplicate{dupCount !== 1 ? 's' : ''}
            </button>
          )}
          {dupMode && (
            <button
              onClick={exitDupMode}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
            >
              <X size={14} />
              Exit
            </button>
          )}
          <button
            onClick={fetchLibrary}
            disabled={loading || !hasCredentials || deleting}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Loading…' : loaded ? 'Refresh' : 'Load Library'}
          </button>
        </div>
      </div>

      {!hasCredentials && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="p-4 bg-slate-800 rounded-2xl mb-4"><AlertCircle size={28} className="text-slate-500" /></div>
          <p className="text-slate-400 text-sm font-medium">GitHub connection required</p>
          <p className="text-slate-600 text-xs mt-1">Connect your account and configure the repo to browse your library.</p>
        </div>
      )}

      {hasCredentials && !loaded && loading && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Loader size={28} className="text-slate-500 animate-spin mb-4" />
          <p className="text-slate-400 text-sm">Fetching releases…</p>
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

      {/* ── Duplicate mode ──────────────────────────────────────────────── */}
      {dupMode && (
        <div className="space-y-5">
          <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
            <p className="text-sm text-amber-300 font-medium mb-1">
              Found {dupGroups.length} duplicate group{dupGroups.length !== 1 ? 's' : ''} ({dupGroups.reduce((n, g) => n + g.releases.length - 1, 0)} extra releases)
            </p>
            <p className="text-xs text-amber-400/70">
              The newest release in each group is pre-selected to keep. Tick any release to mark it for deletion.
            </p>
          </div>

          {deleteError && (
            <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
              <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
              <p className="text-sm text-red-400">{deleteError}</p>
            </div>
          )}

          {dupGroups.map(group => (
            <div key={group.key} className="border border-amber-500/20 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 bg-amber-500/10">
                <p className="text-xs font-medium text-amber-300 truncate max-w-xs" title={group.key}>
                  {group.key}
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-amber-400/60">{group.releases.length} copies</span>
                  <button
                    onClick={() => selectAllInGroup(group)}
                    className="text-[10px] text-amber-400/80 hover:text-amber-300 underline"
                  >
                    select all older
                  </button>
                </div>
              </div>
              <div className="divide-y divide-slate-800">
                {group.releases.map((release, idx) => {
                  const isNewest = idx === 0;
                  const isChecked = selected.has(release.id);
                  const mp3 = release.assets.find(a => a.name.endsWith('.mp3'));
                  return (
                    <div
                      key={release.id}
                      className={`flex items-center gap-3 px-4 py-3 transition-colors ${isChecked ? 'bg-red-500/5' : 'bg-slate-900'}`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleSelect(release.id)}
                        disabled={deleting}
                        className="w-4 h-4 rounded accent-red-500 cursor-pointer flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm text-white truncate">{release.name || release.tag_name}</span>
                          {isNewest && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded font-medium">newest · keep</span>
                          )}
                          {isChecked && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded font-medium">marked for deletion</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          {episodeDateDisplay(release.body, release.tag_name) && (
                            <span className="text-xs text-slate-500">{episodeDateDisplay(release.body, release.tag_name)}</span>
                          )}
                          {mp3 && <span className="text-xs text-slate-600">· {formatSize(mp3.size)}</span>}
                        </div>
                      </div>
                      <a
                        href={release.html_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 text-slate-600 hover:text-slate-400 hover:bg-slate-800 rounded-lg transition-colors flex-shrink-0"
                      >
                        <ExternalLink size={13} />
                      </a>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Delete bar */}
          <div className="sticky bottom-0 bg-slate-950/95 backdrop-blur border border-slate-800 rounded-xl p-4 flex items-center justify-between gap-4">
            {deleting ? (
              <div className="flex items-center gap-3 flex-1">
                <Loader size={16} className="text-red-400 animate-spin flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm text-red-400 font-medium">Deleting… {deleteProgress.done}/{deleteProgress.total}</p>
                  <div className="mt-1.5 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-red-500 rounded-full transition-all"
                      style={{ width: `${deleteProgress.total ? (deleteProgress.done / deleteProgress.total) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <>
                <p className="text-sm text-slate-400">
                  <span className="text-white font-semibold">{selected.size}</span> release{selected.size !== 1 ? 's' : ''} selected for deletion
                </p>
                <button
                  onClick={handleBulkDelete}
                  disabled={selected.size === 0}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                >
                  <Trash2 size={14} />
                  Delete {selected.size > 0 ? selected.size : ''} Release{selected.size !== 1 ? 's' : ''}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Normal library view ─────────────────────────────────────────── */}
      {!dupMode && loaded && releases.length > 0 && (
        <div className="space-y-4">
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

          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              placeholder="Search episodes…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
            />
            <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1 flex-shrink-0">
              {(
                [
                  { value: 'date-desc', label: 'Newest' },
                  { value: 'date-asc',  label: 'Oldest' },
                  { value: 'dur-desc',  label: 'Longest' },
                  { value: 'dur-asc',   label: 'Shortest' },
                ] as const
              ).map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setSort(opt.value)}
                  className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                    sort === opt.value
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            {filtered.map(release => {
              const mp3 = release.assets.find(a => a.name.endsWith('.mp3'));
              const txt = release.assets.find(a => a.name.endsWith('.txt'));
              const duration = parseDuration(release.body);
              const sourceId = parseSourceId(release.body);
              const epDate = episodeDateDisplay(release.body, release.tag_name);

              const isCurrent = current?.id === release.id;
              return (
                <div key={release.id} className="p-4 bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl transition-all">
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => mp3 && play({ id: release.id, title: release.name || release.tag_name, audioUrl: mp3.browser_download_url })}
                      disabled={!mp3}
                      className="flex-shrink-0 w-9 h-9 flex items-center justify-center bg-indigo-500/10 hover:bg-indigo-500/20 disabled:opacity-40 disabled:cursor-not-allowed rounded-full mt-0.5 transition-colors"
                      title={mp3 ? 'Play episode' : 'No audio file on this release'}
                    >
                      {isCurrent && isPlaying
                        ? <Music size={14} className="text-indigo-400 animate-pulse" />
                        : <Play size={14} className="text-indigo-400 translate-x-0.5" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-white truncate">{release.name || release.tag_name}</p>
                          <div className="flex items-center gap-2 flex-wrap mt-0.5">
                            {epDate && <span className="text-xs text-slate-500">{epDate}</span>}
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
