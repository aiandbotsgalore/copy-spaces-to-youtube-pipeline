import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle,
  Copy,
  ExternalLink,
  Globe,
  History,
  Layers,
  Linkedin,
  List,
  ListPlus,
  Loader,
  Mic2,
  Play,
  Plus,
  Sparkles,
  Trash2,
  Youtube,
} from 'lucide-react';
import { EnhancedConfig } from '../types';
import {
  appendLinesToRepositoryTextFile,
  dispatchWorkflow,
  getRepositoryDefaultBranch,
  readRepositoryTextFile,
} from '../utils/github';
import {
  friendlyGitHubError,
  parseBatchUrlsInput,
  validateBatchSubmission,
} from '../utils/submitSpace';

interface Props {
  config: EnhancedConfig;
  onChange: (updates: Partial<EnhancedConfig>) => void;
  onViewRunHistory?: () => void;
  onViewQueue?: () => void;
  onDispatched?: (url: string) => void;
}

type BatchAction = 'queue' | 'dispatch';
type Notice = {
  kind: 'success' | 'error';
  message: string;
  action?: BatchAction;
  count?: number;
} | null;

interface PlatformInfo {
  label: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  type: 'x' | 'youtube' | 'clubhouse' | 'linkedin' | 'url';
}

function detectPlatform(url: string): PlatformInfo {
  const u = url.toLowerCase();
  if (u.includes('twitter.com') || u.includes('x.com')) {
    return {
      label: 'Twitter/X',
      icon: <span className="font-bold text-xs">𝕏</span>,
      color: 'text-sky-300',
      bgColor: 'bg-sky-500/10 border-sky-500/20',
      type: 'x',
    };
  }
  if (u.includes('youtube.com') || u.includes('youtu.be')) {
    return {
      label: 'YouTube',
      icon: <Youtube size={13} />,
      color: 'text-rose-400',
      bgColor: 'bg-rose-500/10 border-rose-500/20',
      type: 'youtube',
    };
  }
  if (u.includes('clubhouse.com')) {
    return {
      label: 'Clubhouse',
      icon: <Mic2 size={13} />,
      color: 'text-emerald-400',
      bgColor: 'bg-emerald-500/10 border-emerald-500/20',
      type: 'clubhouse',
    };
  }
  if (u.includes('linkedin.com')) {
    return {
      label: 'LinkedIn',
      icon: <Linkedin size={13} />,
      color: 'text-blue-400',
      bgColor: 'bg-blue-500/10 border-blue-500/20',
      type: 'linkedin',
    };
  }
  return {
    label: 'Audio URL',
    icon: <Globe size={13} />,
    color: 'text-slate-400',
    bgColor: 'bg-slate-800 border-slate-700',
    type: 'url',
  };
}

const BatchUrlEditor: React.FC<Props> = ({
  config,
  onChange,
  onViewRunHistory,
  onViewQueue,
  onDispatched,
}) => {
  const [inputText, setInputText] = useState('');
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [activeAction, setActiveAction] = useState<BatchAction | null>(null);
  const [dispatchProgress, setDispatchProgress] = useState<{
    current: number;
    total: number;
    currentUrl?: string;
  } | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const urls = config.batchUrls || [];
  const hasCredentials = !!(config.githubToken && config.ownerName && config.repoName);

  const validUrls = urls.map(u => u.trim()).filter(u => u.startsWith('http'));
  const invalidCount = urls.filter(u => u.trim() && !u.trim().startsWith('http')).length;

  const platformCounts = urls.reduce(
    (acc, u) => {
      if (!u.trim()) return acc;
      const p = detectPlatform(u);
      acc[p.type] = (acc[p.type] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const addParsedUrls = (newItems: string[]) => {
    if (newItems.length === 0) return;
    const combined = [...urls, ...newItems];
    onChange({ batchUrls: combined });
    setInputText('');
    if (notice) setNotice(null);
  };

  const handleAddFromInput = () => {
    const parsed = parseBatchUrlsInput(inputText);
    if (parsed.length > 0) {
      addParsedUrls(parsed);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text');
    const parsed = parseBatchUrlsInput(text);
    if (parsed.length > 1) {
      addParsedUrls(parsed);
    } else if (parsed.length === 1) {
      // Single line paste: append to current input text
      setInputText(prev => (prev ? `${prev}\n${parsed[0]}` : parsed[0]));
    }
  };

  const handlePasteClipboard = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
        const text = await navigator.clipboard.readText();
        const parsed = parseBatchUrlsInput(text);
        if (parsed.length > 0) {
          addParsedUrls(parsed);
        }
      }
    } catch {
      // Clipboard permission denied or unavailable
    }
  };

  const removeUrl = (index: number) => {
    onChange({ batchUrls: urls.filter((_, idx) => idx !== index) });
    if (notice) setNotice(null);
  };

  const updateUrl = (index: number, val: string) => {
    const next = [...urls];
    next[index] = val;
    onChange({ batchUrls: next });
  };

  const deduplicateStaged = () => {
    const seen = new Set<string>();
    const deduplicated: string[] = [];
    for (const u of urls) {
      const trimmed = u.trim();
      if (trimmed && !seen.has(trimmed.toLowerCase())) {
        seen.add(trimmed.toLowerCase());
        deduplicated.push(trimmed);
      }
    }
    onChange({ batchUrls: deduplicated });
  };

  const clearAll = () => {
    onChange({ batchUrls: [] });
    if (notice) setNotice(null);
  };

  // 1. Submit Batch to repository queue (batch_queue.txt)
  const submitToQueue = async () => {
    const validationError = validateBatchSubmission(urls, config);
    if (validationError) {
      setNotice({ kind: 'error', message: validationError, action: 'queue' });
      return;
    }

    setActiveAction('queue');
    setNotice(null);

    const token = config.githubToken;
    const owner = config.ownerName.trim();
    const repo = config.repoName.trim();

    try {
      let urlsToAdd = [...validUrls];
      let duplicatesSkipped = 0;

      if (skipDuplicates) {
        try {
          const branch = await getRepositoryDefaultBranch(token, owner, repo);
          const queueFile = await readRepositoryTextFile(token, owner, repo, 'batch_queue.txt', branch);
          if (queueFile?.content) {
            const existingUrls = new Set(
              queueFile.content
                .split(/\r?\n/)
                .map(l => l.trim().toLowerCase())
                .filter(Boolean)
            );
            const filtered = urlsToAdd.filter(u => !existingUrls.has(u.toLowerCase()));
            duplicatesSkipped = urlsToAdd.length - filtered.length;
            urlsToAdd = filtered;
          }
        } catch {
          // If reading fails (e.g. file doesn't exist yet), proceed with full list
        }
      }

      if (urlsToAdd.length === 0) {
        setNotice({
          kind: 'success',
          message: `All ${validUrls.length} episodes are already present in batch_queue.txt. No new URLs were added.`,
          action: 'queue',
          count: 0,
        });
        return;
      }

      const commitMsg = `chore(queue): batch enqueue ${urlsToAdd.length} space${urlsToAdd.length === 1 ? '' : 's'}`;
      const result = await appendLinesToRepositoryTextFile(
        token,
        owner,
        repo,
        'batch_queue.txt',
        urlsToAdd,
        commitMsg
      );

      const dupMessage = duplicatesSkipped > 0 ? ` (${duplicatesSkipped} existing duplicates skipped)` : '';
      setNotice({
        kind: 'success',
        message: `Successfully enqueued ${result.addedCount} episode${result.addedCount === 1 ? '' : 's'} to batch_queue.txt${dupMessage}. Queue now contains ${result.totalCount} episode${result.totalCount === 1 ? '' : 's'}.`,
        action: 'queue',
        count: result.addedCount,
      });
    } catch (error) {
      setNotice({
        kind: 'error',
        message: friendlyGitHubError(error, 'queue'),
        action: 'queue',
      });
    } finally {
      setActiveAction(null);
    }
  };

  // 2. Dispatch ingest.yml for each URL sequentially
  const submitDispatchAll = async () => {
    const validationError = validateBatchSubmission(urls, config);
    if (validationError) {
      setNotice({ kind: 'error', message: validationError, action: 'dispatch' });
      return;
    }

    if (validUrls.length === 0) {
      setNotice({
        kind: 'error',
        message: 'No valid URLs to dispatch. Ensure URLs start with http:// or https://.',
        action: 'dispatch',
      });
      return;
    }

    setActiveAction('dispatch');
    setNotice(null);

    const token = config.githubToken;
    const owner = config.ownerName.trim();
    const repo = config.repoName.trim();

    let dispatchedCount = 0;
    const failedUrls: string[] = [];

    try {
      for (let i = 0; i < validUrls.length; i++) {
        const targetUrl = validUrls[i];
        setDispatchProgress({
          current: i + 1,
          total: validUrls.length,
          currentUrl: targetUrl,
        });

        try {
          await dispatchWorkflow(token, owner, repo, 'ingest.yml', {
            space_url: targetUrl,
          });
          dispatchedCount += 1;
          onDispatched?.(targetUrl);
        } catch (err) {
          failedUrls.push(targetUrl);
          console.error(`Failed to dispatch for ${targetUrl}:`, err);
        }

        // Wait 600ms between workflow dispatches to respect GitHub API secondary rate limits
        if (i < validUrls.length - 1) {
          await new Promise(res => setTimeout(res, 600));
        }
      }

      if (failedUrls.length === 0) {
        setNotice({
          kind: 'success',
          message: `Successfully dispatched all ${dispatchedCount} ingest workflows. They are now queued and running on GitHub Actions!`,
          action: 'dispatch',
          count: dispatchedCount,
        });
      } else {
        setNotice({
          kind: dispatchedCount > 0 ? 'success' : 'error',
          message: `Dispatched ${dispatchedCount} of ${validUrls.length} workflows. ${failedUrls.length} failed to start.`,
          action: 'dispatch',
          count: dispatchedCount,
        });
      }
    } catch (error) {
      setNotice({
        kind: 'error',
        message: friendlyGitHubError(error, 'dispatch'),
        action: 'dispatch',
      });
    } finally {
      setActiveAction(null);
      setDispatchProgress(null);
    }
  };

  const isLoading = activeAction !== null;

  return (
    <div className="h-full overflow-y-auto p-6 md:p-12 max-w-4xl mx-auto w-full pb-24">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-indigo-500/15 border border-indigo-500/20 rounded-xl">
            <ListPlus size={18} className="text-indigo-400" />
          </div>
          <h2 className="text-2xl font-bold text-white">Batch Submit Episodes</h2>
        </div>
        <p className="text-slate-400 text-sm">
          Submit multiple Twitter Spaces or audio URLs at once to ingest episodes in batch. Add them all to your repository queue or trigger immediate parallel processing.
        </p>
      </div>

      {/* GitHub Authentication Warning */}
      {!hasCredentials && (
        <div className="flex items-start gap-3 p-4 mb-6 bg-amber-500/10 border border-amber-500/30 rounded-xl">
          <AlertCircle size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="text-amber-300 font-medium">GitHub Connection Required</p>
            <p className="text-amber-400/80 text-xs mt-0.5">
              Connect GitHub and set your repository in Configuration to submit URLs directly to <code className="bg-amber-500/20 px-1 py-0.5 rounded">batch_queue.txt</code> or dispatch workflows.
            </p>
          </div>
        </div>
      )}

      <div className="space-y-6">
        {/* URL Input Box */}
        <section className="p-5 md:p-6 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
          <div className="flex items-center justify-between">
            <label htmlFor="batch-urls-input" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Paste or Enter Space URLs
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePasteClipboard}
                disabled={isLoading}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-md transition-colors cursor-pointer"
                title="Paste from clipboard"
              >
                <Copy size={12} />
                Paste Clipboard
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <textarea
              id="batch-urls-input"
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleAddFromInput();
                }
              }}
              placeholder={`Paste multiple URLs (one per line, comma, or semicolon separated)...&#10;https://x.com/i/spaces/1DXxyvjZpZQKM&#10;https://x.com/i/spaces/1eaKbgElQanGX&#10;https://www.youtube.com/watch?v=...`}
              rows={4}
              disabled={isLoading}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-sm text-white font-mono placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60 transition-colors resize-y leading-relaxed"
            />
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Supports X Spaces, YouTube, and direct audio streams</span>
              <button
                type="button"
                onClick={handleAddFromInput}
                disabled={!inputText.trim() || isLoading}
                className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg shadow transition-colors cursor-pointer"
              >
                <Plus size={14} />
                Add to Batch List
              </button>
            </div>
          </div>
        </section>

        {/* Staged URLs List */}
        <section className="p-5 md:p-6 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                Staged Episodes ({urls.length})
              </span>
              {urls.length > 0 && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-indigo-500/15 text-indigo-300 border border-indigo-500/25">
                  {validUrls.length} valid
                </span>
              )}
            </div>

            {urls.length > 0 && (
              <div className="flex items-center gap-2 text-xs">
                {urls.length > 1 && (
                  <button
                    type="button"
                    onClick={deduplicateStaged}
                    disabled={isLoading}
                    className="px-2.5 py-1 text-slate-400 hover:text-slate-200 bg-slate-800/80 hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
                  >
                    Deduplicate
                  </button>
                )}
                <button
                  type="button"
                  onClick={clearAll}
                  disabled={isLoading}
                  className="px-2.5 py-1 text-slate-400 hover:text-rose-400 bg-slate-800/80 hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
                >
                  Clear all
                </button>
              </div>
            )}
          </div>

          {/* Platform Breakdown Pills */}
          {urls.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {platformCounts.x && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-sky-500/10 text-sky-300 border border-sky-500/20 font-medium">
                  <span className="font-bold">𝕏</span> {platformCounts.x} Twitter/X Space{platformCounts.x !== 1 ? 's' : ''}
                </span>
              )}
              {platformCounts.youtube && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-rose-500/10 text-rose-300 border border-rose-500/20 font-medium">
                  <Youtube size={12} /> {platformCounts.youtube} YouTube
                </span>
              )}
              {platformCounts.url && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-800 text-slate-300 border border-slate-700 font-medium">
                  <Globe size={12} /> {platformCounts.url} Other Audio
                </span>
              )}
              {invalidCount > 0 && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-rose-500/20 text-rose-400 border border-rose-500/30 font-medium">
                  ⚠️ {invalidCount} Invalid URL{invalidCount !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          )}

          {urls.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center border border-dashed border-slate-800 rounded-xl bg-slate-950/40">
              <div className="p-3 bg-slate-800/60 rounded-xl mb-3 text-slate-400">
                <Layers size={24} />
              </div>
              <p className="text-slate-300 text-sm font-medium">No episodes in batch list yet</p>
              <p className="text-slate-500 text-xs mt-1 max-w-sm">
                Paste one or multiple Space URLs above to prepare a batch submission.
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {urls.map((u, i) => {
                const platform = detectPlatform(u);
                const isValid = u.trim().startsWith('http');
                return (
                  <div
                    key={i}
                    className="flex items-center gap-2.5 p-2.5 bg-slate-950 border border-slate-800 rounded-lg group hover:border-slate-700 transition-colors"
                  >
                    <span className="text-slate-500 text-xs w-6 text-right font-mono flex-shrink-0">
                      {i + 1}.
                    </span>

                    <div className={`p-1.5 rounded-md flex-shrink-0 ${platform.bgColor} ${platform.color}`}>
                      {platform.icon}
                    </div>

                    <input
                      type="text"
                      value={u}
                      onChange={e => updateUrl(i, e.target.value)}
                      disabled={isLoading}
                      className={`flex-1 min-w-0 bg-transparent text-xs font-mono focus:outline-none focus:underline ${
                        isValid ? 'text-slate-200' : 'text-rose-400'
                      }`}
                      placeholder="https://..."
                    />

                    {platform.label && (
                      <span className={`text-[11px] ${platform.color} flex-shrink-0 hidden sm:inline`}>
                        {platform.label}
                      </span>
                    )}

                    {!isValid && (
                      <span className="text-[11px] text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20 flex-shrink-0">
                        Invalid
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => removeUrl(i)}
                      disabled={isLoading}
                      className="p-1 text-slate-500 hover:text-rose-400 opacity-60 group-hover:opacity-100 transition-all rounded hover:bg-rose-500/10 cursor-pointer flex-shrink-0"
                      title="Remove URL"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Batch Submission Actions */}
        <div className="grid md:grid-cols-2 gap-4">
          {/* Action 1: Add All to Repository Queue */}
          <section className="flex flex-col p-5 border bg-slate-900 border-slate-800 hover:border-indigo-500/30 rounded-xl transition-all">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-1.5 bg-indigo-500/15 border border-indigo-500/25 rounded-lg text-indigo-400">
                <ListPlus size={16} />
              </div>
              <h3 className="text-sm font-semibold text-white">Add to Batch Queue</h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed mb-4 flex-1">
              Appends all {validUrls.length} episode{validUrls.length !== 1 ? 's' : ''} to{' '}
              <code className="text-slate-300 bg-slate-950 px-1 py-0.5 rounded text-[11px]">batch_queue.txt</code> in your repository via an atomic commit. The scheduled monitor workflow will process each in order.
            </p>

            <div className="mb-4">
              <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={skipDuplicates}
                  onChange={e => setSkipDuplicates(e.target.checked)}
                  disabled={isLoading}
                  className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-indigo-500/20 cursor-pointer"
                />
                <span>Skip URLs already present in repository queue</span>
              </label>
            </div>

            <button
              type="button"
              onClick={() => void submitToQueue()}
              disabled={isLoading || validUrls.length === 0 || !hasCredentials}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-sm font-semibold rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              {activeAction === 'queue' ? (
                <>
                  <Loader size={16} className="animate-spin text-indigo-400" />
                  <span>Enqueuing {validUrls.length} Episodes…</span>
                </>
              ) : (
                <>
                  <ListPlus size={16} />
                  <span>Add {validUrls.length} Episode{validUrls.length !== 1 ? 's' : ''} to Queue</span>
                </>
              )}
            </button>
          </section>

          {/* Action 2: Dispatch All Workflows Now */}
          <section className="flex flex-col p-5 border bg-indigo-500/[0.07] border-indigo-500/25 rounded-xl transition-all">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-1.5 bg-indigo-500/20 border border-indigo-500/30 rounded-lg text-indigo-400">
                <Play size={16} />
              </div>
              <h3 className="text-sm font-semibold text-white">Run Workflows Now</h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed mb-4 flex-1">
              Immediately triggers the <code className="text-indigo-300 bg-indigo-500/10 px-1 py-0.5 rounded text-[11px]">ingest.yml</code> workflow for each episode on GitHub Actions. Best for immediate parallel archiving.
            </p>

            {isLoading && dispatchProgress && (
              <div className="mb-4 p-2.5 bg-slate-950/80 border border-indigo-500/30 rounded-lg text-xs space-y-1.5">
                <div className="flex items-center justify-between text-indigo-300">
                  <span className="flex items-center gap-1.5">
                    <Loader size={13} className="animate-spin text-indigo-400" />
                    Dispatching episode {dispatchProgress.current} of {dispatchProgress.total}…
                  </span>
                  <span className="font-mono text-[11px]">
                    {Math.round((dispatchProgress.current / dispatchProgress.total) * 100)}%
                  </span>
                </div>
                {dispatchProgress.currentUrl && (
                  <p className="text-[11px] text-slate-400 font-mono truncate">
                    {dispatchProgress.currentUrl}
                  </p>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => void submitDispatchAll()}
              disabled={isLoading || validUrls.length === 0 || !hasCredentials}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg shadow-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              {activeAction === 'dispatch' ? (
                <>
                  <Loader size={16} className="animate-spin" />
                  <span>Dispatching {validUrls.length} Workflows…</span>
                </>
              ) : (
                <>
                  <Play size={16} />
                  <span>Dispatch All {validUrls.length} Workflows</span>
                </>
              )}
            </button>
          </section>
        </div>

        {/* Notices and Results */}
        {notice && (
          <div
            aria-live="polite"
            className={`flex items-start gap-3 p-4 border rounded-xl ${
              notice.kind === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30'
                : 'bg-rose-500/10 border-rose-500/30'
            }`}
          >
            {notice.kind === 'success' ? (
              <CheckCircle size={18} className="text-emerald-400 flex-shrink-0 mt-0.5" />
            ) : (
              <AlertCircle size={18} className="text-rose-400 flex-shrink-0 mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              <p className={`text-sm ${notice.kind === 'success' ? 'text-emerald-300' : 'text-rose-300'}`}>
                {notice.message}
              </p>

              {notice.kind === 'success' && (
                <div className="flex flex-wrap items-center gap-3 mt-3">
                  {notice.action === 'queue' && onViewQueue && (
                    <button
                      type="button"
                      onClick={onViewQueue}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer"
                    >
                      <List size={13} />
                      View Live Queue
                    </button>
                  )}
                  {notice.action === 'dispatch' && onViewRunHistory && (
                    <button
                      type="button"
                      onClick={onViewRunHistory}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer"
                    >
                      <History size={13} />
                      View Run History
                    </button>
                  )}
                  {urls.length > 0 && (
                    <button
                      type="button"
                      onClick={clearAll}
                      className="text-xs text-slate-400 hover:text-slate-200 transition-colors cursor-pointer underline"
                    >
                      Clear submitted list
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Educational Footer */}
        <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-xl text-xs text-slate-400 space-y-1.5 leading-relaxed">
          <p className="font-semibold text-slate-300 flex items-center gap-1.5">
            <Sparkles size={13} className="text-indigo-400" />
            How Batch Ingestion Works:
          </p>
          <p>
            1. <strong>Queue Ingestion:</strong> URLs committed to <code className="bg-slate-800 px-1 rounded text-slate-300">batch_queue.txt</code> are automatically picked up one-by-one by the scheduled monitor workflow.
          </p>
          <p>
            2. <strong>Immediate Run:</strong> Dispatching workflows triggers independent GitHub Actions runners to download, diarize, transcribe, and syndicate your episodes simultaneously.
          </p>
          <p>
            3. <strong>Duration Guard:</strong> Marathon Spaces longer than 10 hours will automatically be split into compliant <code>(Part 1)</code>, <code>(Part 2)</code> chunks to respect YouTube's 12-hour limit.
          </p>
        </div>
      </div>
    </div>
  );
};

export default BatchUrlEditor;
