'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { useBulkUploadStatus } from '@/lib/upload/use-bulk-status';

interface ActiveJobsApi {
  jobs: string[];
  track: (jobId: string) => void;
  untrack: (jobId: string) => void;
}

const ActiveJobsContext = React.createContext<ActiveJobsApi | null>(null);

/**
 * Navigation behavior (deliberate choice):
 * native `beforeunload` fires ONLY on tab close / browser refresh, NOT on
 * Next.js client-side navigation (sidebar links, router.push, back button).
 * Intercepting client-side nav was rejected as too invasive. Instead:
 * - the sidebar Upload badge shows the live active-job count, and
 * - each tracked job toasts on completion,
 * so the user always knows a job is running and can return via /upload.
 * BullMQ jobs survive navigation regardless (server-side queue).
 */

function JobWatcher({ jobId, onDone }: { jobId: string; onDone: (jobId: string) => void }): null {
  const { data } = useBulkUploadStatus(jobId);
  const done = data?.status === 'done' || data?.status === 'failed' || data?.status === 'cancelled';
  React.useEffect(() => {
    if (done) {
      if (data?.status === 'done') {
        toast.success(`Bulk job finished: ${data.succeeded}/${data.total} uploaded`);
      } else if (data?.status === 'failed') {
        toast.error('Bulk job finished with failures');
      }
      onDone(jobId);
    }
  }, [done, data, jobId, onDone]);
  return null;
}

export function ActiveJobsProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [jobs, setJobs] = React.useState<string[]>([]);
  const track = React.useCallback((jobId: string) => {
    setJobs((prev) => (prev.includes(jobId) ? prev : [...prev, jobId]));
  }, []);
  const untrack = React.useCallback((jobId: string) => {
    setJobs((prev) => prev.filter((j) => j !== jobId));
  }, []);

  React.useEffect(() => {
    if (jobs.length === 0) return;
    const warn = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [jobs.length]);

  const api = React.useMemo(() => ({ jobs, track, untrack }), [jobs, track, untrack]);
  return (
    <ActiveJobsContext.Provider value={api}>
      {jobs.map((jobId) => (
        <JobWatcher key={jobId} jobId={jobId} onDone={untrack} />
      ))}
      {children}
    </ActiveJobsContext.Provider>
  );
}

export function useActiveJobs(): ActiveJobsApi | null {
  return React.useContext(ActiveJobsContext);
}
