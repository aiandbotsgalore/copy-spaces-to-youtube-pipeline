import React, { useState, useEffect } from 'react';
import {
  ShieldCheck, AlertCircle, CheckCircle2, Clock, RefreshCw,
  ExternalLink, Loader, Activity, Key, Server, Check, X, AlertTriangle
} from 'lucide-react';
import { EnhancedConfig, WorkflowRun } from '../types';
import { useWorkflowRuns, isActiveRun } from '../hooks/useWorkflowRuns';
import { getCachedRateLimit, onRateLimitChange, GitHubRateLimitInfo, validateToken } from '../utils/github';

interface Props {
  config: EnhancedConfig;
  onNavigateToGitHub?: () => void;
  compact?: boolean;
}

export const PipelineHealthWidget: React.FC<Props> = ({
  config,
  onNavigateToGitHub,
  compact = false,
}) => {
  const { runs, loading: runsLoading, error: runsError, refresh: refreshRuns } = useWorkflowRuns(config, true);
  const [rateLimit, setRateLimit] = useState<GitHubRateLimitInfo | null>(getCachedRateLimit());
  const [tokenValid, setTokenValid] = useState<boolean | null>(null);
  const [tokenUser, setTokenUser] = useState<string | null>(null);
  const [tokenChecking, setTokenChecking] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const owner = (config.ownerName || '').trim();
  const repo = (config.repoName || '').trim();
  const hasToken = !!config.githubToken?.trim();
  const hasRepo = !!(owner && repo);

  // Subscribe to rate limit updates
  useEffect(() => {
    return onRateLimitChange(info => setRateLimit(info));
  }, []);

  // Check token validity
  useEffect(() => {
    if (!hasToken) {
      setTokenValid(false);
      setTokenUser(null);
      return;
    }
    setTokenChecking(true);
    validateToken(config.githubToken)
      .then(u => {
        setTokenValid(true);
        setTokenUser(u.login);
      })
      .catch(() => {
        setTokenValid(false);
        setTokenUser(null);
      })
      .finally(() => setTokenChecking(false));
  }, [config.githubToken, hasToken]);

  // Evaluate recent failures (last 10 runs)
  const recentRuns = runs.slice(0, 10);
  const activeRuns = recentRuns.filter(r => isActiveRun(r));
  const failedRuns = recentRuns.filter(r => r.conclusion === 'failure');
  const successfulRuns = recentRuns.filter(r => r.conclusion === 'success');

  // Overall Health Assessment
  const isHealthy = hasToken && tokenValid && failedRuns.length === 0 && (rateLimit ? rateLimit.remaining > 50 : true);
  const isWarning = (hasToken && failedRuns.length > 0) || (rateLimit ? rateLimit.remaining <= 100 : false);
  const isCritical = !hasToken || tokenValid === false;

  const handleManualRefresh = () => {
    refreshRuns(false);
    if (hasToken) {
      validateToken(config.githubToken)
        .then(u => { setTokenValid(true); setTokenUser(u.login); })
        .catch(() => setTokenValid(false));
    }
  };

  const formatResetTime = (resetSec: number) => {
    const diff = Math.max(0, Math.floor(resetSec - Date.now() / 1000));
    const mins = Math.floor(diff / 60);
    const secs = diff % 60;
    return `${mins}m ${secs}s`;
  };

  if (compact) {
    return (
      <div className="relative">
        <button
          onClick={() => setExpanded(!expanded)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
            isCritical
              ? 'bg-rose-500/15 text-rose-300 border-rose-500/30 hover:bg-rose-500/25'
              : isWarning
              ? 'bg-amber-500/15 text-amber-300 border-amber-500/30 hover:bg-amber-500/25'
              : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/25'
          }`}
          title="Click to inspect pipeline health and telemetry"
        >
          <span className={`w-2 h-2 rounded-full ${
            isCritical ? 'bg-rose-500 animate-pulse' : isWarning ? 'bg-amber-400' : 'bg-emerald-400'
          }`} />
          <span>{isCritical ? 'Pipeline Alert' : isWarning ? `${failedRuns.length} Failed Run` : 'Pipeline Healthy'}</span>
        </button>

        {expanded && (
          <div className="absolute right-0 top-full mt-2 w-80 bg-slate-900 border border-slate-700/90 rounded-2xl shadow-2xl p-4 z-50 space-y-3 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-xs font-bold text-white flex items-center gap-1.5">
                <Activity size={13} className="text-indigo-400" /> Pipeline Diagnostics
              </span>
              <button onClick={() => setExpanded(false)} className="text-slate-400 hover:text-white text-xs">
                <X size={14} />
              </button>
            </div>

            <div className="space-y-2 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">GitHub Authentication</span>
                <span className={`font-semibold ${tokenValid ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {tokenChecking ? 'Checking…' : tokenValid ? `@${tokenUser}` : 'Disconnected'}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400">API Rate Limit</span>
                <span className="font-mono text-slate-200">
                  {rateLimit ? `${rateLimit.remaining} / ${rateLimit.limit}` : 'Nominal'}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400">Active Workflows</span>
                <span className={`font-semibold ${activeRuns.length > 0 ? 'text-amber-400' : 'text-slate-300'}`}>
                  {activeRuns.length > 0 ? `${activeRuns.length} running` : 'Idle'}
                </span>
              </div>

              {failedRuns.length > 0 && (
                <div className="p-2 bg-rose-500/10 border border-rose-500/25 rounded-lg text-rose-300">
                  <p className="font-bold">Latest Failed Run:</p>
                  <p className="truncate">{failedRuns[0].name} ({new Date(failedRuns[0].created_at).toLocaleTimeString()})</p>
                  <a
                    href={failedRuns[0].html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[10px] text-rose-400 underline mt-1 font-bold"
                  >
                    View Failure Log <ExternalLink size={10} />
                  </a>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Full Widget Mode (for Dashboard)
  return (
    <div className="bg-slate-900/80 border border-slate-800/90 rounded-2xl p-5 shadow-lg space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2.5">
          <div className={`p-2 rounded-xl border ${
            isCritical ? 'bg-rose-500/15 text-rose-400 border-rose-500/30' :
            isWarning ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' :
            'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
          }`}>
            <Activity size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-white tracking-tight">Pipeline Health &amp; Telemetry</h3>
              <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border ${
                isCritical ? 'bg-rose-500/20 text-rose-300 border-rose-500/40' :
                isWarning ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' :
                'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
              }`}>
                {isCritical ? 'Attention Required' : isWarning ? 'Degraded Performance' : 'Optimal'}
              </span>
            </div>
            <p className="text-xs text-slate-400">Continuous monitoring of GitHub token validity, rate quotas, and cloud workflow executions</p>
          </div>
        </div>

        <button
          onClick={handleManualRefresh}
          disabled={runsLoading || tokenChecking}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
        >
          <RefreshCw size={12} className={runsLoading || tokenChecking ? 'animate-spin' : ''} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Diagnostics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Token Status */}
        <div className="p-3 bg-slate-950/70 border border-slate-800/80 rounded-xl space-y-1">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-bold uppercase tracking-wider">GitHub Auth</span>
            <Key size={13} className={tokenValid ? 'text-emerald-400' : 'text-rose-400'} />
          </div>
          <div className="flex items-center gap-1.5">
            {tokenChecking ? (
              <span className="text-xs text-slate-400">Validating…</span>
            ) : tokenValid ? (
              <span className="text-xs font-bold text-emerald-300 truncate">@{tokenUser}</span>
            ) : (
              <span className="text-xs font-bold text-rose-400">Token Invalid / Missing</span>
            )}
          </div>
          <p className="text-[10px] text-slate-500">
            {tokenValid ? 'Full workflow dispatch scopes' : (
              <button onClick={onNavigateToGitHub} className="text-indigo-400 hover:underline cursor-pointer">
                Connect GitHub Token →
              </button>
            )}
          </p>
        </div>

        {/* API Rate Limit */}
        <div className="p-3 bg-slate-950/70 border border-slate-800/80 rounded-xl space-y-1">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-bold uppercase tracking-wider">GitHub API Quota</span>
            <Server size={13} className="text-indigo-400" />
          </div>
          <div className="text-xs font-bold text-white font-mono">
            {rateLimit ? (
              <span>{rateLimit.remaining} <span className="text-slate-500 text-[10px]">/ {rateLimit.limit} reqs</span></span>
            ) : (
              <span>5,000 reqs / hr</span>
            )}
          </div>
          <p className="text-[10px] text-slate-500">
            {rateLimit ? `Reset in ${formatResetTime(rateLimit.reset)}` : 'ETag caching active (304 saves quota)'}
          </p>
        </div>

        {/* Workflow Executions */}
        <div className="p-3 bg-slate-950/70 border border-slate-800/80 rounded-xl space-y-1">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-bold uppercase tracking-wider">Workflow Runs</span>
            <Activity size={13} className={activeRuns.length > 0 ? 'text-amber-400 animate-spin' : 'text-emerald-400'} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-white">
              {activeRuns.length > 0 ? `${activeRuns.length} In-Flight` : `${successfulRuns.length} Succeeded`}
            </span>
            {failedRuns.length > 0 && (
              <span className="text-[10px] bg-rose-500/20 text-rose-300 px-1.5 py-0.2 rounded font-bold">
                {failedRuns.length} Failed
              </span>
            )}
          </div>
          <p className="text-[10px] text-slate-500">
            {hasRepo ? `${owner}/${repo}` : 'Repository not configured'}
          </p>
        </div>
      </div>

      {/* Actionable Error Remediation (If any failures detected) */}
      {failedRuns.length > 0 && (
        <div className="p-3.5 bg-rose-950/30 border border-rose-500/30 rounded-xl space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-rose-200 flex items-center gap-1.5">
              <AlertTriangle size={14} className="text-rose-400" />
              Workflow Execution Failure Detected ({failedRuns[0].name})
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              {new Date(failedRuns[0].created_at).toLocaleString()}
            </span>
          </div>
          <p className="text-[11px] text-slate-300 leading-relaxed">
            The latest execution of <strong className="text-white">{failedRuns[0].name}</strong> failed in GitHub Actions. Check logs for missing API tokens (e.g., DEEPGRAM_API_KEY) or transient download timeouts.
          </p>
          <div className="flex items-center gap-2 pt-1">
            <a
              href={failedRuns[0].html_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
            >
              Inspect GitHub Action Logs <ExternalLink size={12} />
            </a>
            {hasRepo && (
              <a
                href={`https://github.com/${owner}/${repo}/settings/secrets/actions`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
              >
                Manage Repository Secrets <ExternalLink size={12} />
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default PipelineHealthWidget;
