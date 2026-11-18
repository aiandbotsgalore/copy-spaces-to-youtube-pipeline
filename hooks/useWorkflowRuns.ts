import { useState, useCallback, useEffect, useRef } from 'react';
import { WorkflowRun, EnhancedConfig } from '../types';
import { getWorkflowRuns } from '../utils/github';
import { createMachine } from '../utils/stateMachine';

// 15s while a run is active, matching the Active Operations Tracker decision.
export const RUN_POLL_INTERVAL_MS = 15000;

export function isActiveRun(run: WorkflowRun): boolean {
  return (
    run.status === 'in_progress' ||
    run.status === 'queued' ||
    run.status === 'waiting' ||
    run.status === 'pending' ||
    run.status === 'requested'
  );
}

export type WorkflowRunsStatus = 'idle' | 'loading' | 'polling' | 'settled' | 'error';

type WorkflowEvent = 'START_FETCH' | 'FETCH_SUCCESS' | 'START_POLL' | 'STOP_POLL' | 'FETCH_ERROR';

interface UseWorkflowRunsResult {
  runs: WorkflowRun[];
  status: WorkflowRunsStatus;
  loading: boolean;
  error: string;
  loaded: boolean;
  isLive: boolean;
  refresh: (silent?: boolean) => Promise<WorkflowRun[] | undefined>;
}

/**
 * Fetches and auto-polls GitHub Actions workflow runs for the configured repo.
 * Polling starts automatically whenever any run is active and stops once
 * everything settles, backed by an explicit state machine with Agent Bridge support.
 */
export function useWorkflowRuns(config: EnhancedConfig, autoLoad = true): UseWorkflowRunsResult {
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [status, setStatus] = useState<WorkflowRunsStatus>('idle');
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const machineRef = useRef(
    createMachine<WorkflowRunsStatus, WorkflowEvent>(
      {
        id: 'workflow-runs',
        initial: 'idle',
        states: {
          idle: { START_FETCH: 'loading', FETCH_ERROR: 'error' },
          loading: {
            FETCH_SUCCESS: 'settled',
            START_POLL: 'polling',
            FETCH_ERROR: 'error',
          },
          settled: {
            START_FETCH: 'loading',
            START_POLL: 'polling',
            FETCH_ERROR: 'error',
          },
          polling: {
            STOP_POLL: 'settled',
            START_FETCH: 'polling',
            FETCH_ERROR: 'error',
          },
          error: {
            START_FETCH: 'loading',
          },
        },
        onTransition: (_from, to) => {
          setStatus(to);
        },
      },
      {}
    )
  );

  const hasCredentials = !!(config.githubToken && config.ownerName && config.repoName);

  const fetchRuns = useCallback(async (silent = false) => {
    if (!hasCredentials) return undefined;
    if (!silent) {
      machineRef.current.send('START_FETCH');
    }
    setError('');
    try {
      const data = await getWorkflowRuns(config.githubToken, config.ownerName, config.repoName);
      setRuns(data);
      setLoaded(true);
      const hasActive = data.some(isActiveRun);
      if (hasActive) {
        machineRef.current.send('START_POLL');
      } else {
        machineRef.current.send(machineRef.current.getState() === 'polling' ? 'STOP_POLL' : 'FETCH_SUCCESS');
      }
      return data;
    } catch (e) {
      const msg = (e as Error).message || 'Failed to fetch workflow runs';
      if (!silent) {
        setError(msg);
        machineRef.current.send('FETCH_ERROR');
      }
      return undefined;
    }
  }, [config.githubToken, config.ownerName, config.repoName, hasCredentials]);

  useEffect(() => {
    if (autoLoad && hasCredentials && !loaded && status === 'idle') {
      fetchRuns();
    }
  }, [autoLoad, hasCredentials, loaded, status, fetchRuns]);

  // Auto-poll while any run is active; stop as soon as everything settles.
  useEffect(() => {
    if (!loaded) return;
    const hasActive = runs.some(isActiveRun);

    if (hasActive && !pollRef.current) {
      machineRef.current.send('START_POLL');
      pollRef.current = setInterval(async () => {
        const updated = await fetchRuns(true);
        if (updated && !updated.some(isActiveRun)) {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          machineRef.current.send('STOP_POLL');
        }
      }, RUN_POLL_INTERVAL_MS);
    } else if (!hasActive && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
      machineRef.current.send('STOP_POLL');
    }

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [loaded, runs, fetchRuns]);

  const loading = status === 'loading';
  const isLive = status === 'polling';

  return { runs, status, loading, error, loaded, isLive, refresh: fetchRuns };
}
