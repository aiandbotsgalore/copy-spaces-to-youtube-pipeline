import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle,
  History,
  ListPlus,
  Loader,
  Play,
  Radio,
} from 'lucide-react';
import { EnhancedConfig } from '../types';
import { appendLineToRepositoryTextFile, dispatchWorkflow } from '../utils/github';
import { validateSubmission, friendlyGitHubError, SubmitAction } from '../utils/submitSpace';

interface Props {
  config: EnhancedConfig;
  onViewRunHistory: () => void;
  onDispatched?: (url: string) => void;
}

type Action = SubmitAction;
type Notice = { kind: 'success' | 'error'; message: string; action?: Action } | null;

const SubmitSpacePanel: React.FC<Props> = ({ config, onViewRunHistory, onDispatched }) => {
  const [url, setUrl] = useState('');
  const [recordLive, setRecordLive] = useState(false);
  const [activeAction, setActiveAction] = useState<Action | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const submit = async (action: Action) => {
    const trimmedUrl = url.trim();
    const validationError = validateSubmission(trimmedUrl, config);
    if (validationError) {
      setNotice({ kind: 'error', message: validationError, action });
      return;
    }

    setActiveAction(action);
    setNotice(null);
    try {
      if (action === 'run') {
        await dispatchWorkflow(
          config.githubToken,
          config.ownerName,
          config.repoName,
          'ingest.yml',
          {
            space_url: trimmedUrl,
            ...(recordLive ? { record_live: 'true' } : {}),
          }
        );
        onDispatched?.(trimmedUrl);
        setNotice({
          kind: 'success',
          message: recordLive
            ? 'Workflow dispatched: capturing active live stream.'
            : 'Workflow started successfully.',
          action,
        });
      } else {
        await appendLineToRepositoryTextFile(
          config.githubToken,
          config.ownerName,
          config.repoName,
          'batch_queue.txt',
          trimmedUrl,
          'chore(queue): enqueue space'
        );
        setNotice({ kind: 'success', message: 'Space added to the queue.', action });
      }
      setUrl('');
      setRecordLive(false);
    } catch (error) {
      setNotice({ kind: 'error', message: friendlyGitHubError(error, action), action });
    } finally {
      setActiveAction(null);
    }
  };

  const isLoading = activeAction !== null;

  return (
    <div className="h-full overflow-y-auto p-6 md:p-12 max-w-3xl mx-auto w-full">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-indigo-500/15 border border-indigo-500/20 rounded-xl">
            <Radio size={18} className="text-indigo-400" />
          </div>
          <h2 className="text-2xl font-bold text-white">Submit New Space</h2>
        </div>
        <p className="text-slate-400 text-sm">
          Start one URL immediately or place it at the end of the repository queue.
        </p>
      </div>

      <div className="space-y-5">
        <section className="p-5 md:p-6 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
          <div>
            <label htmlFor="space-url" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Space or audio URL
            </label>
            <input
              id="space-url"
              type="url"
              value={url}
              onChange={event => {
                setUrl(event.target.value);
                if (notice) setNotice(null);
              }}
              onKeyDown={event => {
                if (event.key === 'Enter' && !isLoading) void submit('run');
              }}
              placeholder="https://x.com/i/spaces/..."
              disabled={isLoading}
              autoComplete="url"
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-sm text-white font-mono placeholder:text-slate-700 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60 transition-colors"
            />
            <p className="mt-2 text-[11px] text-slate-500">
              Supports X Spaces and other audio URLs handled by your ingest workflow.
            </p>
          </div>

          <div className={`p-3.5 rounded-lg border transition-all ${
            recordLive
              ? 'bg-rose-500/10 border-rose-500/30 ring-1 ring-rose-500/20'
              : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700'
          }`}>
            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={recordLive}
                onChange={e => setRecordLive(e.target.checked)}
                disabled={isLoading}
                className="mt-0.5 h-4 w-4 rounded border-slate-700 bg-slate-900 text-rose-500 focus:ring-rose-500/20 focus:ring-offset-0 cursor-pointer"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Radio size={14} className={recordLive ? "text-rose-400 animate-pulse" : "text-slate-500"} />
                  <span className={`text-xs font-semibold ${recordLive ? 'text-rose-300' : 'text-slate-300'}`}>
                    Record Live Broadcast (Space currently in progress)
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                  Automated pipelines only ingest completed replays. Check this option only if the Space is actively broadcasting right now and you want to manually record it live.
                </p>
              </div>
            </label>
          </div>
        </section>

        <div className="grid md:grid-cols-2 gap-3">
          <section className={`flex flex-col p-5 border rounded-xl transition-all ${
            recordLive
              ? 'bg-rose-500/[0.08] border-rose-500/30'
              : 'bg-indigo-500/[0.07] border-indigo-500/25'
          }`}>
            <div className="flex items-center gap-2 mb-2">
              {recordLive ? <Radio size={16} className="text-rose-400 animate-pulse" /> : <Play size={16} className="text-indigo-400" />}
              <h3 className="text-sm font-semibold text-white">
                {recordLive ? 'Record Live Stream Now' : 'Run Now'}
              </h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed mb-5 flex-1">
              {recordLive
                ? 'Hooks into the active live stream on GitHub Actions and records until the broadcast concludes.'
                : 'Starts this Space immediately by dispatching the ingest workflow. The queue is not changed.'}
            </p>
            <button
              type="button"
              onClick={() => void submit('run')}
              disabled={isLoading}
              className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 text-white text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed ${
                recordLive
                  ? 'bg-rose-600 hover:bg-rose-500 focus:ring-rose-400'
                  : 'bg-indigo-600 hover:bg-indigo-500 focus:ring-indigo-400'
              }`}
            >
              {activeAction === 'run' ? (
                <Loader size={16} className="animate-spin" />
              ) : recordLive ? (
                <Radio size={16} className="animate-pulse" />
              ) : (
                <Play size={16} />
              )}
              {activeAction === 'run'
                ? (recordLive ? 'Connecting to Stream…' : 'Starting…')
                : (recordLive ? 'Record Live Now' : 'Run Now')}
            </button>
          </section>

          <section className={`flex flex-col p-5 border rounded-xl transition-all ${
            recordLive
              ? 'bg-slate-900/40 border-slate-800 opacity-60'
              : 'bg-sky-500/[0.05] border-sky-500/20'
          }`}>
            <div className="flex items-center gap-2 mb-2">
              <ListPlus size={16} className="text-sky-400" />
              <h3 className="text-sm font-semibold text-white">Add to Queue</h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed mb-4 flex-1">
              Adds this Space to the bottom of <code className="text-sky-400">batch_queue.txt</code> without removing existing URLs.
            </p>
            {recordLive && (
              <p className="text-[11px] text-amber-400/90 mb-3">
                ⚠️ Live streams must be captured immediately and cannot be queued for batch processing.
              </p>
            )}
            <button
              type="button"
              onClick={() => void submit('queue')}
              disabled={isLoading || recordLive}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-offset-2 focus:ring-offset-slate-900"
            >
              {activeAction === 'queue' ? <Loader size={16} className="animate-spin" /> : <ListPlus size={16} />}
              {activeAction === 'queue' ? 'Adding…' : 'Add to Queue'}
            </button>
          </section>
        </div>

        {notice && (
          <div
            aria-live="polite"
            className={`flex items-start gap-3 p-4 border rounded-xl ${
              notice.kind === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30'
                : 'bg-red-500/10 border-red-500/30'
            }`}
          >
            {notice.kind === 'success'
              ? <CheckCircle size={17} className="text-emerald-400 flex-shrink-0 mt-0.5" />
              : <AlertCircle size={17} className="text-red-400 flex-shrink-0 mt-0.5" />}
            <div className="flex-1 min-w-0">
              <p className={`text-sm ${notice.kind === 'success' ? 'text-emerald-300' : 'text-red-300'}`}>
                {notice.message}
              </p>
              {notice.kind === 'success' && notice.action === 'run' && (
                <button
                  type="button"
                  onClick={onViewRunHistory}
                  className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 transition-colors focus:outline-none focus:underline"
                >
                  <History size={13} />
                  View Run History
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SubmitSpacePanel;
