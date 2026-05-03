import React, { useState, useCallback } from 'react';
import { RefreshCw, ExternalLink, CheckCircle, XCircle, Clock, Loader, AlertCircle, Play } from 'lucide-react';
import { WorkflowRun, EnhancedConfig } from '../types';
import { getWorkflowRuns } from '../utils/github';

interface Props {
  config: EnhancedConfig;
}

const WORKFLOW_COLORS: Record<string, string> = {
  'ingest': 'bg-indigo-500/15 text-indigo-400',
  'monitor': 'bg-amber-500/15 text-amber-400',
  'test': 'bg-slate-700 text-slate-400',
  'rss': 'bg-emerald-500/15 text-emerald-400',
};

function workflowBadgeColor(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('ingest') || lower.includes('space')) return WORKFLOW_COLORS.ingest;
  if (lower.includes('monitor') || lower.includes('batch')) return WORKFLOW_COLORS.monitor;
  if (lower.includes('test')) return WORKFLOW_COLORS.test;
  if (lower.includes('rss') || lower.includes('deploy')) return WORKFLOW_COLORS.rss;
  return 'bg-slate-700 text-slate-400';
}

function workflowShortName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('ingest')) return 'Ingest';
  if (lower.includes('monitor')) return 'Monitor';
  if (lower.includes('test')) return 'Test';
  if (lower.includes('rss')) return 'RSS';
  return name.split(' ')[0];
}

function StatusBadge({ status, conclusion }: { status: string; conclusion: string | null }) {
  if (status === 'in_progress' || status === 'queued' || status === 'waiting') {
    return (
      <span className="flex items-center gap-1.5 px-2 py-0.5 bg-amber-500/15 text-amber-400 text-[10px] font-semibold rounded-full">
        <Loader size={10} className="animate-spin" />
        {status === 'queued' ? 'Queued' : status === 'waiting' ? 'Waiting' : 'Running'}
      </span>
    );
  }
  if (conclusion === 'success') {
    return (
      <span className="flex items-center gap-1.5 px-2 py-0.5 bg-emerald-500/15 text-emerald-400 text-[10px] font-semibold rounded-full">
        <CheckCircle size={10} />
        Success
      </span>
    );
  }
  if (conclusion === 'failure') {
    return (
      <span className="flex items-center gap-1.5 px-2 py-0.5 bg-red-500/15 text-red-400 text-[10px] font-semibold rounded-full">
        <XCircle size={10} />
        Failed
      </span>
    );
  }
  if (conclusion === 'cancelled') {
    return (
      <span className="flex items-center gap-1.5 px-2 py-0.5 bg-slate-700 text-slate-400 text-[10px] font-semibold rounded-full">
        <XCircle size={10} />
        Cancelled
      </span>
    );
  }
  if (conclusion === 'skipped') {
    return (
      <span className="flex items-center gap-1.5 px-2 py-0.5 bg-slate-700 text-slate-400 text-[10px] font-semibold rounded-full">
        Skipped
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 px-2 py-0.5 bg-slate-800 text-slate-500 text-[10px] font-semibold rounded-full">
      <Clock size={10} />
      {status}
    </span>
  );
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const RunHistory: React.FC<Props> = ({ config }) => {
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<string>('all');

  const hasCredentials = config.githubToken && config.ownerName && config.repoName;

  const fetchRuns = useCallback(async () => {
    if (!hasCredentials) return;
    setLoading(true);
    setError('');
    try {
      const data = await getWorkflowRuns(config.githubToken, config.ownerName, config.repoName);
      setRuns(data);
      setLoaded(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [config.githubToken, config.ownerName, config.repoName, hasCredentials]);

  const repoUrl = `https://github.com/${config.ownerName}/${config.repoName}`;

  // Derive unique workflow names for filter tabs
  const workflowNames = Array.from(new Set(runs.map(r => workflowShortName(r.name))));

  const filteredRuns = filter === 'all' ? runs : runs.filter(r => workflowShortName(r.name) === filter);

  return (
    <div className="h-full overflow-y-auto p-6 md:p-12 max-w-4xl mx-auto w-full">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white mb-2">Run History</h2>
          <p className="text-slate-400 text-sm">
            GitHub Actions workflow runs for{' '}
            <code className="text-sky-400 bg-slate-800 px-1 rounded text-xs">{config.ownerName}/{config.repoName}</code>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {config.ownerName && config.repoName && (
            <a
              href={`${repoUrl}/actions`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
            >
              <ExternalLink size={13} />
              Open in GitHub
            </a>
          )}
          <button
            onClick={fetchRuns}
            disabled={loading || !hasCredentials}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Loading…' : loaded ? 'Refresh' : 'Load Runs'}
          </button>
        </div>
      </div>

      {!hasCredentials && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="p-4 bg-slate-800 rounded-2xl mb-4">
            <AlertCircle size={28} className="text-slate-500" />
          </div>
          <p className="text-slate-400 text-sm font-medium">GitHub connection required</p>
          <p className="text-slate-600 text-xs mt-1">Connect your GitHub account and configure your repo to view run history.</p>
        </div>
      )}

      {hasCredentials && !loaded && !loading && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="p-4 bg-slate-800 rounded-2xl mb-4">
            <Play size={28} className="text-slate-500" />
          </div>
          <p className="text-slate-400 text-sm font-medium">Click "Load Runs" to fetch workflow history</p>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-xl mb-4">
          <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {loaded && runs.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="p-4 bg-slate-800 rounded-2xl mb-4">
            <Clock size={28} className="text-slate-500" />
          </div>
          <p className="text-slate-400 text-sm font-medium">No workflow runs found</p>
          <p className="text-slate-600 text-xs mt-1">Runs will appear here after your first ingest.</p>
        </div>
      )}

      {runs.length > 0 && (
        <div className="space-y-4">
          {/* Filter tabs */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${filter === 'all' ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'bg-slate-900 text-slate-500 border border-slate-800 hover:text-slate-300'}`}
            >
              All ({runs.length})
            </button>
            {workflowNames.map(wfName => (
              <button
                key={wfName}
                onClick={() => setFilter(wfName)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${filter === wfName ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'bg-slate-900 text-slate-500 border border-slate-800 hover:text-slate-300'}`}
              >
                {wfName} ({runs.filter(r => workflowShortName(r.name) === wfName).length})
              </button>
            ))}
          </div>

          <div className="space-y-2">
            {filteredRuns.map(run => (
              <a
                key={run.id}
                href={run.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-4 p-4 bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl transition-all group"
              >
                <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center">
                  {run.conclusion === 'success' && <CheckCircle size={20} className="text-emerald-400" />}
                  {run.conclusion === 'failure' && <XCircle size={20} className="text-red-400" />}
                  {(!run.conclusion || run.status === 'in_progress') && <Loader size={20} className="text-amber-400 animate-spin" />}
                  {(run.conclusion === 'cancelled' || run.conclusion === 'skipped') && <XCircle size={20} className="text-slate-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${workflowBadgeColor(run.name)}`}>
                      {workflowShortName(run.name)}
                    </span>
                    <span className="text-sm font-semibold text-white group-hover:text-indigo-300 transition-colors truncate">
                      {run.head_commit?.message?.split('\n')[0] || run.name}
                    </span>
                    <StatusBadge status={run.status} conclusion={run.conclusion} />
                  </div>
                  <p className="text-xs text-slate-500">{timeAgo(run.created_at)}</p>
                </div>
                <ExternalLink size={14} className="flex-shrink-0 text-slate-700 group-hover:text-slate-400 transition-colors" />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default RunHistory;
