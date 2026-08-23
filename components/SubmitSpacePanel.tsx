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
          { space_url: trimmedUrl }
        );
        onDispatched?.(trimmedUrl);
        setNotice({ kind: 'success', message: 'Workflow started successfully.', action });
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
        <section className="p-5 md:p-6 bg-slate-900 border border-slate-800 rounded-xl">
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
          <p className="mt-2 text-[11px] text-slate-600">
            Supports X Spaces and other audio URLs handled by your ingest workflow.
          </p>
        </section>

        <div className="grid md:grid-cols-2 gap-3">
          <section className="flex flex-col p-5 bg-indigo-500/[0.07] border border-indigo-500/25 rounded-xl">
            <div className="flex items-center gap-2 mb-2">
              <Play size={16} className="text-indigo-400" />
              <h3 className="text-sm font-semibold text-white">Run Now</h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed mb-5 flex-1">
              Starts this Space immediately by dispatching the ingest workflow. The queue is not changed.
            </p>
            <button
              type="button"
              onClick={() => void submit('run')}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 focus:ring-offset-slate-900"
            >
              {activeAction === 'run' ? <Loader size={16} className="animate-spin" /> : <Play size={16} />}
              {activeAction === 'run' ? 'Starting…' : 'Run Now'}
            </button>
          </section>

          <section className="flex flex-col p-5 bg-sky-500/[0.05] border border-sky-500/20 rounded-xl">
            <div className="flex items-center gap-2 mb-2">
              <ListPlus size={16} className="text-sky-400" />
              <h3 className="text-sm font-semibold text-white">Add to Queue</h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed mb-5 flex-1">
              Adds this Space to the bottom of <code className="text-sky-400">batch_queue.txt</code> without removing existing URLs.
            </p>
            <button
              type="button"
              onClick={() => void submit('queue')}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-200 text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-offset-2 focus:ring-offset-slate-900"
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
