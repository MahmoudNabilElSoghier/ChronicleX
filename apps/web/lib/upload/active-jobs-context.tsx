'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { useBulkUploadStatus } from '@/lib/upload/use-bulk-status';

interface ActiveJobsApi {
  jobs: string[];
  recentJobs: string[];
  track: (jobId: string) => void;
  untrack: (jobId: string) => void;
}

const ActiveJobsContext = React.createContext<ActiveJobsApi | null>(null);

/** How long a finished job is kept around (badge-less) for the results view. */
const RECENT_TTL_MS = 5 * 60 * 1000;

/**
 * Navigation behavior (deliberate choice):
 * native `beforeunload` fires ONLY on tab close / browser refresh, NOT on
 * Next.js client-side navigation (sidebar links, router.push, back button).
 * Intercepting client-side nav was rejected as too invasive. Instead:
 * - the sidebar Upload badge shows the live active-job count, and
 * - each tracked job toasts on completion,
 * so the user always knows a job is running and can return via /upload.
 * BullMQ jobs survive navigation regardless (server-side queue).
 *
 * Two-map model:
 * - `jobs` (active): polled by JobWatcher, drives the badge and beforeunload.
 *   A job leaves this map the moment it reaches done/failed/cancelled.
 * - `recentJobs`: finished jobs kept for RECENT_TTL_MS so a returning user
 *   can still see the outcome; they do NOT badge and do NOT warn on unload.
 */
function JobWatcher({
  jobId,
  onComplete,
  shouldToast,
}: {
  jobId: string;
  onComplete: (jobId: string) => void;
  shouldToast: (jobId: string) => boolean;
}): null {
  const { data } = useBulkUploadStatus(jobId);
  const done = data?.status === 'done' || data?.status === 'failed' || data?.status === 'cancelled';
  React.useEffect(() => {
    if (done) {
      if (shouldToast(jobId)) {
        if (data?.status === 'done') {
          toast.success(`Bulk job finished: ${data.succeeded}/${data.total} uploaded`);
        } else if (data?.status === 'failed') {
          toast.error('Bulk job finished with failures');
        }
      }
      onComplete(jobId);
    }
  }, [done, data, jobId, onComplete, shouldToast]);
  return null;
}

export function ActiveJobsProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [state, setState] = React.useState<{ active: string[]; recent: string[] }>({
    active: [],
    recent: [],
  });
  const recentTimers = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const toasted = React.useRef<Set<string>>(new Set());

  const clearRecentTimer = React.useCallback((jobId: string) => {
    const timer = recentTimers.current[jobId];
    if (timer !== undefined) {
      clearTimeout(timer);
      delete recentTimers.current[jobId];
    }
  }, []);

  // track: no-op for jobs we already know (active OR finished). This makes
  // consumers whose effects re-run on context identity changes convergent.
  const track = React.useCallback(
    (jobId: string) => {
      setState((prev) => {
        if (prev.active.includes(jobId) || prev.recent.includes(jobId)) return prev;
        return { ...prev, active: [...prev.active, jobId] };
      });
    },
    [],
  );

  const untrack = React.useCallback(
    (jobId: string) => {
      clearRecentTimer(jobId);
      setState((prev) => {
        if (!prev.active.includes(jobId) && !prev.recent.includes(jobId)) return prev;
        return {
          active: prev.active.filter((j) => j !== jobId),
          recent: prev.recent.filter((j) => j !== jobId),
        };
      });
    },
    [clearRecentTimer],
  );

  // Job finished: drop out of the badge/unload scope, keep the id briefly.
  const complete = React.useCallback(
    (jobId: string) => {
      clearRecentTimer(jobId);
      recentTimers.current[jobId] = setTimeout(() => {
        delete recentTimers.current[jobId];
        setState((prev) => ({ ...prev, recent: prev.recent.filter((j) => j !== jobId) }));
      }, RECENT_TTL_MS);
      setState((prev) => {
        if (!prev.active.includes(jobId)) return prev;
        const active = prev.active.filter((j) => j !== jobId);
        const recent = prev.recent.includes(jobId) ? prev.recent : [...prev.recent, jobId];
        return { active, recent };
      });
    },
    [clearRecentTimer],
  );

  const shouldToast = React.useCallback((jobId: string) => {
    if (toasted.current.has(jobId)) return false;
    toasted.current.add(jobId);
    return true;
  }, []);

  React.useEffect(() => {
    const timers = recentTimers.current;
    return () => {
      Object.values(timers).forEach((t) => clearTimeout(t));
    };
  }, []);

  // Warn ONLY while a job is actually running (active), not for finished
  // ones sitting in `recent`.
  React.useEffect(() => {
    if (state.active.length === 0) return;
    const warn = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [state.active.length]);

  const api = React.useMemo(
    () => ({ jobs: state.active, recentJobs: state.recent, track, untrack }),
    [state.active, state.recent, track, untrack],
  );
  return (
    <ActiveJobsContext.Provider value={api}>
      {state.active.map((jobId) => (
        <JobWatcher key={jobId} jobId={jobId} onComplete={complete} shouldToast={shouldToast} />
      ))}
      {children}
    </ActiveJobsContext.Provider>
  );
}

export function useActiveJobs(): ActiveJobsApi | null {
  return React.useContext(ActiveJobsContext);
}
