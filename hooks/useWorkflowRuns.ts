import { useState, useCallback, useEffect, useRef } from 'react';
import { WorkflowRun, EnhancedConfig } from '../types';
import { getWorkflowRuns } from '../utils/github';

// 15s while a run is active, matching the Active Operations Tracker decision.
export const RUN_POLL_INTERVAL_MS = 15000;

export function isActiveRun(run: WorkflowRun): boolean {
  return run.status === 'in_progress' || run.status === 'queued' || run.status === 'waiting';
}

interface UseWorkflowRunsResult {
  runs: WorkflowRun[];
  loading: boolean;
  error: string;
  loaded: boolean;
  isLive: boolean;
  refresh: (silent?: boolean) => Promise<WorkflowRun[] | undefined>;
}

/**
 * Fetches and auto-polls GitHub Actions workflow runs for the configured repo.
 * Polling starts automatically whenever any run is active and stops once
 * everything settles, so multiple consumers (Run History, Dashboard tracker)
 * can share one poller instead of each hitting the API independently.
 */
export function useWorkflowRuns(config: EnhancedConfig, autoLoad = true): UseWorkflowRunsResult {
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hasCredentials = !!(config.githubToken && config.ownerName && config.repoName);

  const fetchRuns = useCallback(async (silent = false) => {
    if (!hasCredentials) return undefined;
    if (!silent) setLoading(true);
    setError('');
    try {
      const data = await getWorkflowRuns(config.githubToken, config.ownerName, config.repoName);
      setRuns(data);
      setLoaded(true);
      return data;
    } catch (e) {
      if (!silent) setError((e as Error).message);
      return undefined;
    } finally {
      if (!silent) setLoading(false);
    }
  }, [config.githubToken, config.ownerName, config.repoName, hasCredentials]);

  useEffect(() => {
    if (autoLoad && hasCredentials && !loaded && !loading) {
      fetchRuns();
    }
  }, [autoLoad, hasCredentials, loaded, loading, fetchRuns]);

  // Auto-poll while any run is active; stop as soon as everything settles.
  useEffect(() => {
    if (!loaded) return;
    const hasActive = runs.some(isActiveRun);

    if (hasActive && !pollRef.current) {
      setIsLive(true);
      pollRef.current = setInterval(async () => {
        const updated = await fetchRuns(true);
        if (updated && !updated.some(isActiveRun)) {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setIsLive(false);
        }
      }, RUN_POLL_INTERVAL_MS);
    } else if (!hasActive && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
      setIsLive(false);
    }

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [loaded, runs, fetchRuns]);

  return { runs, loading, error, loaded, isLive, refresh: fetchRuns };
}
