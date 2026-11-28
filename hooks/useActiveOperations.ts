import { useState, useCallback, useRef, useEffect } from 'react';
import { EnhancedConfig, WorkflowRun } from '../types';
import { getWorkflowRuns } from '../utils/github';
import { isActiveRun } from './useWorkflowRuns';

export type OperationStatus = 'dispatching' | 'in_progress' | 'success' | 'failure' | 'not_found';

export interface PendingOperation {
  id: string;
  url: string;
  dispatchedAt: number;
  matchedRun?: WorkflowRun;
  status: OperationStatus;
}

// Fast polling while we're still waiting to see the dispatched run appear in
// the Actions list (GitHub can take a few seconds to register it).
const FAST_POLL_MS = 4000;
// Once matched and running, fall back to the standard 15s interval so this
// tracker doesn't poll any harder than Run History does.
const ACTIVE_POLL_MS = 15000;
// Give up trying to match a dispatch to a run after this long — surfaces as
// "not_found" rather than polling forever on a silently-failed dispatch.
const MATCH_TIMEOUT_MS = 90000;

function isIngestRun(run: WorkflowRun): boolean {
  return run.path?.includes('ingest.yml') || run.name.toLowerCase().includes('ingest');
}

function resolveStatus(run: WorkflowRun): OperationStatus {
  if (isActiveRun(run) || run.status !== 'completed') return 'in_progress';
  if (run.conclusion === 'success') return 'success';
  if (run.conclusion === 'failure') return 'failure';
  // cancelled/skipped/null conclusion on a completed run — treat as failure
  // for tracker purposes rather than leaving it stuck in a false "running" state.
  return 'failure';
}

/**
 * Tracks Quick Ingest dispatches from the moment they're fired through to
 * completion. Correlates a dispatch to its resulting Actions run by matching
 * the newest ingest-workflow run created at/after the dispatch timestamp —
 * workflow_dispatch doesn't return a run id synchronously, so this timestamp
 * heuristic is the practical option without redeploying the workflow with a
 * custom run-name. Safe for single-operator use; not built for concurrent
 * dispatches racing within the same few seconds.
 */
const ACTIVE_OPS_STORAGE_KEY = 'spacepipe_active_operations_v1';
const ACTIVE_OPS_EVENT = 'spacepipe:active-operations-updated';

function readStoredOps(): PendingOperation[] {
  try {
    const raw = localStorage.getItem(ACTIVE_OPS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, 10) : [];
  } catch {
    return [];
  }
}

function writeStoredOps(ops: PendingOperation[]): void {
  try {
    localStorage.setItem(ACTIVE_OPS_STORAGE_KEY, JSON.stringify(ops.slice(0, 10)));
  } catch {}
}

/**
 * Records a newly dispatched workflow URL so DashboardOverview / Command Center
 * picks it up immediately even when triggered from another tab (e.g. SubmitSpacePanel).
 */
export function recordActiveOperationDispatch(url: string): string {
  const op: PendingOperation = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    url,
    dispatchedAt: Date.now(),
    status: 'dispatching',
  };
  const next = [op, ...readStoredOps()].slice(0, 10);
  writeStoredOps(next);
  try {
    window.dispatchEvent(new CustomEvent(ACTIVE_OPS_EVENT, { detail: next }));
  } catch {}
  return op.id;
}

export function useActiveOperations(config: EnhancedConfig) {
  const [operations, setOperations] = useState<PendingOperation[]>(() => readStoredOps());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const opsRef = useRef<PendingOperation[]>(operations);
  opsRef.current = operations;

  useEffect(() => {
    const onExternalUpdate = (ev: Event) => {
      const detail = (ev as CustomEvent<PendingOperation[]>).detail;
      if (Array.isArray(detail)) {
        setOperations(detail);
        if (!timerRef.current && detail.some(op => op.status !== 'success' && op.status !== 'failure' && op.status !== 'not_found')) {
          timerRef.current = setTimeout(() => { void tickRef.current?.(); }, 3000);
        }
      }
    };
    window.addEventListener(ACTIVE_OPS_EVENT, onExternalUpdate);
    return () => window.removeEventListener(ACTIVE_OPS_EVENT, onExternalUpdate);
  }, []);

  const tickRef = useRef<(() => Promise<void>) | null>(null);

  const hasCredentials = !!(config.githubToken && config.ownerName && config.repoName);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const tick = useCallback(async () => {
    clearTimer();
    const current = opsRef.current;
    const unresolved = current.filter(
      op => op.status !== 'success' && op.status !== 'failure' && op.status !== 'not_found'
    );
    if (!hasCredentials || unresolved.length === 0) return;

    let runs: WorkflowRun[] = [];
    try {
      runs = await getWorkflowRuns(config.githubToken, config.ownerName, config.repoName);
    } catch {
      // Swallow transient polling errors (rate limits, blips) — this is a
      // background tracker, not a user-initiated fetch; next tick retries.
    }

    const ingestRuns = runs.filter(isIngestRun);

    const next = current.map(op => {
      if (op.status === 'success' || op.status === 'failure' || op.status === 'not_found') return op;

      if (!op.matchedRun) {
        const candidate = ingestRuns
          .filter(
            r =>
              (!r.event || r.event === 'workflow_dispatch') &&
              new Date(r.created_at).getTime() >= op.dispatchedAt - 5000
          )
          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0];

        if (candidate) {
          return { ...op, matchedRun: candidate, status: resolveStatus(candidate) };
        }
        if (Date.now() - op.dispatchedAt > MATCH_TIMEOUT_MS) {
          return { ...op, status: 'not_found' as const };
        }
        return op;
      }

      const updated = runs.find(r => r.id === op.matchedRun!.id) || op.matchedRun;
      return { ...op, matchedRun: updated, status: resolveStatus(updated) };
    });

    setOperations(next);
    writeStoredOps(next);

    const stillUnresolved = next.some(
      op => op.status !== 'success' && op.status !== 'failure' && op.status !== 'not_found'
    );
    if (stillUnresolved) {
      const anyMatched = next.some(op => op.matchedRun);
      timerRef.current = setTimeout(tick, anyMatched ? ACTIVE_POLL_MS : FAST_POLL_MS);
    }
  }, [hasCredentials, config.githubToken, config.ownerName, config.repoName]);
  tickRef.current = tick;

  // On mount, reconcile against any ingest run that's already active in the
  // cloud (e.g. dispatched just before a page refresh) even though we have
  // no local dispatch record for it.
  useEffect(() => {
    if (!hasCredentials) return;
    (async () => {
      try {
        const runs = await getWorkflowRuns(config.githubToken, config.ownerName, config.repoName);
        const activeIngest = runs.filter(r => isIngestRun(r) && isActiveRun(r));
        if (activeIngest.length === 0) return;
        setOperations(prev => {
          const known = new Set(prev.map(op => op.matchedRun?.id).filter(Boolean));
          const reconciled: PendingOperation[] = activeIngest
            .filter(r => !known.has(r.id))
            .map(r => ({
              id: `reconciled-${r.id}`,
              url: r.head_commit?.message?.split('\n')[0] || 'Ingest run',
              dispatchedAt: new Date(r.created_at).getTime(),
              matchedRun: r,
              status: resolveStatus(r),
            }));
          if (reconciled.length === 0) return prev;
          if (!timerRef.current) timerRef.current = setTimeout(tick, ACTIVE_POLL_MS);
          return [...reconciled, ...prev];
        });
      } catch {
        // Best-effort reconciliation only — a failure here just means a
        // pre-existing run won't show until the user visits Run History.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasCredentials]);

  useEffect(() => () => clearTimer(), []);

  const trackDispatch = useCallback((url: string) => {
    const id = recordActiveOperationDispatch(url);
    setOperations(readStoredOps());
    if (!timerRef.current) {
      timerRef.current = setTimeout(tick, 3000);
    }
    return id;
  }, [tick]);

  const dismissOperation = useCallback((id: string) => {
    setOperations(prev => {
      const next = prev.filter(op => op.id !== id);
      writeStoredOps(next);
      return next;
    });
  }, []);

  return { operations, trackDispatch, dismissOperation };
}
