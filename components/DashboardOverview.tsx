import React, { useState, useEffect, useCallback } from 'react';
import {
  Zap, Play, ListPlus, Loader, CheckCircle, XCircle, AlertCircle,
  Copy, Check, Github, ExternalLink, Library, FileText, ChevronRight, Radio,
} from 'lucide-react';
import { EnhancedConfig, Release } from '../types';
import { dispatchWorkflow, appendLineToRepositoryTextFile, getReleases } from '../utils/github';
import { validateSubmission, friendlyGitHubError } from '../utils/submitSpace';
import { useActiveOperations } from '../hooks/useActiveOperations';
import { usePlayer } from '../contexts/PlayerContext';

interface Props {
  config: EnhancedConfig;
  onNavigate: (panel: 'library' | 'transcripts' | 'run-history' | 'live-queue' | 'submit-space') => void;
}

function parseDuration(body: string | null): string {
  if (!body) return '';
  const m = body.match(/METADATA::DURATION::(\d{2}:\d{2}:\d{2})/);
  return m ? m[1] : '';
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

const DashboardOverview: React.FC<Props> = ({ config, onNavigate }) => {
  const [url, setUrl] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState<'run' | 'queue' | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  const [releases, setReleases] = useState<Release[]>([]);
  const [releasesLoading, setReleasesLoading] = useState(false);
  const [releasesError, setReleasesError] = useState('');
  const [copied, setCopied] = useState(false);
  const [scanning, setScanning] = useState(false);

  const { play } = usePlayer();
  const { operations, trackDispatch, dismissOperation } = useActiveOperations(config);

  const hasCredentials = !!(config.githubToken && config.ownerName && config.repoName);
  const rssUrl = `https://${config.ownerName.trim()}.github.io/${config.repoName.trim()}/podcast.xml`;

  const loadReleases = useCallback(async () => {
    if (!hasCredentials) return;
    setReleasesLoading(true);
    setReleasesError('');
    try {
      const data = await getReleases(config.githubToken, config.ownerName.trim(), config.repoName.trim());
      setReleases(data);
    } catch (e) {
      setReleasesError((e as Error).message);
    } finally {
      setReleasesLoading(false);
    }
  }, [config.githubToken, config.ownerName, config.repoName, hasCredentials]);

  useEffect(() => { loadReleases(); }, [loadReleases]);

  const recent = [...releases]
    .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())
    .slice(0, 4);

  const handleCopyRss = () => {
    navigator.clipboard.writeText(rssUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handlePresubmit = () => {
    const trimmed = url.trim();
    const err = validateSubmission(trimmed, config);
    if (err) {
      setNotice({ kind: 'error', message: err });
      return;
    }
    setNotice(null);
    setConfirming(true);
  };

  const handleConfirm = async (action: 'run' | 'queue') => {
    const trimmed = url.trim();
    setSubmitting(action);
    setNotice(null);
    try {
      if (action === 'run') {
        await dispatchWorkflow(config.githubToken, config.ownerName, config.repoName, 'ingest.yml', { space_url: trimmed });
        trackDispatch(trimmed);
        setNotice({ kind: 'success', message: 'Ingest started — tracking below.' });
      } else {
        await appendLineToRepositoryTextFile(
          config.githubToken, config.ownerName, config.repoName,
          'batch_queue.txt', trimmed, 'chore(queue): enqueue space'
        );
        setNotice({ kind: 'success', message: 'Added to the queue.' });
      }
      setUrl('');
      setConfirming(false);
    } catch (error) {
      setNotice({ kind: 'error', message: friendlyGitHubError(error, action) });
    } finally {
      setSubmitting(null);
    }
  };

  const handleScanXSpaces = async () => {
    if (!hasCredentials) return;
    setScanning(true);
    setNotice(null);
    const targetHandle = config.authorName?.replace(/^@/, '').trim() || 'LoganBlack';
    try {
      await dispatchWorkflow(
        config.githubToken,
        config.ownerName.trim(),
        config.repoName.trim(),
        'auto_detect_spaces.yml',
        { x_handle: targetHandle }
      );
      setNotice({
        kind: 'success',
        message: `🛰️ Auto-detection scan triggered for @${targetHandle}! Checking recent tweets for new Spaces in GitHub Actions...`,
      });
    } catch (err) {
      setNotice({
        kind: 'error',
        message: friendlyGitHubError(err, 'dispatching auto-detect scan'),
      });
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 md:p-12 max-w-5xl mx-auto w-full pb-20">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white mb-1">Command Center</h2>
        <p className="text-slate-400 text-sm">Ingest a new Space, keep an eye on what's running, and jump back into recent episodes.</p>
      </div>

      {!hasCredentials && (
        <div className="flex items-start gap-3 p-4 mb-8 bg-amber-500/10 border border-amber-500/30 rounded-xl">
          <AlertCircle size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-300">
            Connect GitHub and set your repository details in Configuration to use Quick Ingest and see live data here.
          </p>
        </div>
      )}

      {/* Hero Quick Ingest */}
      <section className="p-5 md:p-6 bg-slate-900 border border-slate-800 rounded-xl mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Zap size={16} className="text-indigo-400" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wide">Quick Ingest</h3>
        </div>

        {!confirming ? (
          <>
            <input
              type="url"
              value={url}
              onChange={e => { setUrl(e.target.value); if (notice) setNotice(null); }}
              onKeyDown={e => { if (e.key === 'Enter') handlePresubmit(); }}
              placeholder="https://x.com/i/spaces/..."
              disabled={!hasCredentials}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-sm text-white font-mono placeholder:text-slate-700 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50 transition-colors mb-3"
            />
            <button
              onClick={handlePresubmit}
              disabled={!hasCredentials || !url.trim()}
              className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Play size={15} /> Continue
            </button>
          </>
        ) : (
          <div className="space-y-4">
            <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg">
              <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Confirm submission</p>
              <p className="text-sm text-white font-mono break-all">{url.trim()}</p>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <button
                onClick={() => handleConfirm('run')}
                disabled={submitting !== null}
                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {submitting === 'run' ? <Loader size={15} className="animate-spin" /> : <Play size={15} />}
                {submitting === 'run' ? 'Starting…' : 'Run Now'}
              </button>
              <button
                onClick={() => handleConfirm('queue')}
                disabled={submitting !== null}
                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 disabled:opacity-50 text-slate-200 text-sm font-medium rounded-lg transition-colors"
              >
                {submitting === 'queue' ? <Loader size={15} className="animate-spin" /> : <ListPlus size={15} />}
                {submitting === 'queue' ? 'Adding…' : 'Add to Queue'}
              </button>
            </div>
            <button
              onClick={() => { setConfirming(false); setNotice(null); }}
              disabled={submitting !== null}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

        {notice && (
          <div className={`mt-4 flex items-start gap-2 p-3 border rounded-lg ${
            notice.kind === 'success' ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'
          }`}>
            {notice.kind === 'success'
              ? <CheckCircle size={14} className="text-emerald-400 flex-shrink-0 mt-0.5" />
              : <AlertCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />}
            <p className={`text-xs ${notice.kind === 'success' ? 'text-emerald-300' : 'text-red-300'}`}>{notice.message}</p>
          </div>
        )}

        <div className="mt-4 pt-4 border-t border-slate-800 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-slate-400">
              Auto-Detect active (scans @{config.authorName?.replace(/^@/, '').trim() || 'LoganBlack'} every 30m)
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => onNavigate('live-queue')}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-0.5"
            >
              View queue <ChevronRight size={11} />
            </button>
            <button
              onClick={handleScanXSpaces}
              disabled={!hasCredentials || scanning}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 transition-colors"
              title="Scan X timeline for new Space broadcasts right now"
            >
              {scanning ? <Loader size={12} className="animate-spin text-indigo-400" /> : <Radio size={12} className="text-indigo-400" />}
              {scanning ? 'Scanning…' : 'Scan X Now'}
            </button>
          </div>
        </div>
      </section>

      {/* Active Operations Tracker */}
      {operations.length > 0 && (
        <section className="mb-6 space-y-2">
          <div className="flex items-center gap-2 px-1">
            <Radio size={13} className="text-amber-400" />
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide">Active Operations</h3>
          </div>
          {operations.map(op => (
            <div key={op.id} className="flex items-center gap-3 p-3.5 bg-slate-900 border border-slate-800 rounded-xl">
              <div className="flex-shrink-0 w-7 h-7 flex items-center justify-center">
                {op.status === 'success' && <CheckCircle size={18} className="text-emerald-400" />}
                {op.status === 'failure' && <XCircle size={18} className="text-red-400" />}
                {op.status === 'not_found' && <AlertCircle size={18} className="text-slate-500" />}
                {(op.status === 'dispatching' || op.status === 'in_progress') && <Loader size={18} className="text-amber-400 animate-spin" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate font-mono">{op.url}</p>
                <p className="text-xs text-slate-500">
                  {op.status === 'dispatching' && 'Waiting for GitHub to register the run…'}
                  {op.status === 'in_progress' && 'Running…'}
                  {op.status === 'success' && 'Completed successfully'}
                  {op.status === 'failure' && 'Run failed — check the Action log'}
                  {op.status === 'not_found' && "Couldn't confirm this started — check Run History"}
                </p>
              </div>
              {op.matchedRun && (
                <a
                  href={op.matchedRun.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-shrink-0 p-1.5 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded-lg transition-colors"
                  title="View on GitHub"
                >
                  <ExternalLink size={13} />
                </a>
              )}
              {(op.status === 'success' || op.status === 'failure' || op.status === 'not_found') && (
                <button
                  onClick={() => dismissOperation(op.id)}
                  className="flex-shrink-0 text-xs text-slate-600 hover:text-slate-400 transition-colors px-1"
                >
                  Dismiss
                </button>
              )}
            </div>
          ))}
        </section>
      )}

      {/* Pipeline Health & Quick Stats */}
      <section className="grid sm:grid-cols-3 gap-3 mb-6">
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="flex items-center gap-2 mb-2">
            <Github size={13} className="text-slate-500" />
            <p className="text-[10px] text-slate-500 uppercase tracking-wide">Repository</p>
          </div>
          <p className="text-sm font-semibold text-white truncate">{config.ownerName || '—'}/{config.repoName || '—'}</p>
        </div>
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="flex items-center gap-2 mb-2">
            <Library size={13} className="text-slate-500" />
            <p className="text-[10px] text-slate-500 uppercase tracking-wide">Published Episodes</p>
          </div>
          <p className="text-sm font-semibold text-white">
            {releasesLoading ? <Loader size={14} className="animate-spin text-slate-500" /> : releases.length}
          </p>
        </div>
        <button
          onClick={handleCopyRss}
          disabled={!hasCredentials}
          className="p-4 bg-slate-900 border border-slate-800 rounded-xl text-left hover:border-slate-700 disabled:opacity-50 transition-colors"
        >
          <div className="flex items-center gap-2 mb-2">
            {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} className="text-slate-500" />}
            <p className="text-[10px] text-slate-500 uppercase tracking-wide">RSS Feed URL</p>
          </div>
          <p className="text-sm font-semibold text-white">{copied ? 'Copied!' : 'Copy link'}</p>
        </button>
      </section>

      {/* Recent Episodes Showcase */}
      <section>
        <div className="flex items-center justify-between mb-3 px-1">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide">Recent Episodes</h3>
          <button onClick={() => onNavigate('library')} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors">
            View all <ChevronRight size={12} />
          </button>
        </div>

        {releasesError && (
          <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
            <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
            <p className="text-sm text-red-400">{releasesError}</p>
          </div>
        )}

        {!releasesLoading && !releasesError && recent.length === 0 && hasCredentials && (
          <div className="flex flex-col items-center justify-center py-12 text-center bg-slate-900 border border-slate-800 rounded-xl">
            <p className="text-slate-400 text-sm font-medium">No episodes yet</p>
            <p className="text-slate-600 text-xs mt-1">Run your first ingest above to get started.</p>
          </div>
        )}

        {recent.length > 0 && (
          <div className="space-y-2">
            {recent.map(release => {
              const mp3 = release.assets.find(a => a.name.endsWith('.mp3'));
              const txt = release.assets.find(a => a.name.endsWith('.txt'));
              const duration = parseDuration(release.body);
              return (
                <div key={release.id} className="flex items-center gap-3 p-4 bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl transition-all">
                  <button
                    onClick={() => handlePlay(release)}
                    disabled={!mp3}
                    className="flex-shrink-0 w-9 h-9 flex items-center justify-center bg-indigo-500/10 hover:bg-indigo-500/20 disabled:opacity-40 rounded-full transition-colors"
                  >
                    <Play size={14} className="text-indigo-400 translate-x-0.5" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{release.name || release.tag_name}</p>
                    <div className="flex items-center gap-2 flex-wrap mt-0.5">
                      <span className="text-xs text-slate-500">{formatDate(release.published_at)}</span>
                      {duration && <span className="text-xs text-slate-500">· {duration}</span>}
                      {txt && (
                        <button
                          onClick={() => onNavigate('transcripts')}
                          className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-amber-500/15 text-amber-400 rounded font-medium hover:bg-amber-500/25 transition-colors"
                        >
                          <FileText size={9} /> Transcript
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};

export default DashboardOverview;
