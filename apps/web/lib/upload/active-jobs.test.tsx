import { render, screen, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ar from '@/messages/ar.json';
import { Sidebar } from '@/components/layout/sidebar';
import { ActiveJobsProvider, useActiveJobs } from '@/lib/upload/active-jobs-context';

const bulk = vi.hoisted(() => {
  let status = 'processing';
  const subs = new Set<() => void>();
  return {
    get: (): string => status,
    set: (s: string): void => {
      status = s;
      subs.forEach((f) => f());
    },
    subscribe: (f: () => void): (() => void) => {
      subs.add(f);
      return () => {
        subs.delete(f);
      };
    },
  };
});

// Deterministic external store instead of real polling: tests flip the
// status and expect the watcher/badge/unload behavior to follow.
vi.mock('@/lib/upload/use-bulk-status', async () => {
  const ReactMod = await import('react');
  return {
    useBulkUploadStatus: (jobId: string | null) => {
      const status = ReactMod.useSyncExternalStore(bulk.subscribe, bulk.get, bulk.get);
      if (jobId === null) return { data: undefined, isLoading: false };
      return {
        data: {
          jobId,
          status,
          total: 1,
          processed: status === 'done' ? 1 : 0,
          succeeded: status === 'done' ? 1 : 0,
          failed: status === 'failed' ? 1 : 0,
          createdAt: new Date().toISOString(),
          results: [],
          resultsTruncated: false,
        },
        isLoading: false,
      };
    },
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/ar/upload',
}));

vi.mock('@/lib/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/entries',
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({
    user: {
      id: 'u1', email: 'a@b.c', nameAr: 'م', nameEn: 'A', isActive: true,
      roles: [{ name: 'ARCHIVIST', scopeType: 'PROJECT', scopeId: 'p1' }],
    },
    status: 'authenticated',
    login: vi.fn(),
    logout: vi.fn(),
  }),
  useRequireAuth: () => ({ id: 'u1' }),
}));

function Tracker({ jobId }: { jobId: string }): null {
  const jobs = useActiveJobs();
  React.useEffect(() => {
    jobs?.track(jobId);
  }, [jobs, jobId]);
  return null;
}

function renderSidebar(trackJob: boolean): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="ar" messages={ar}>
        <ActiveJobsProvider>
          {trackJob ? <Tracker jobId="job1" /> : null}
          <Sidebar />
        </ActiveJobsProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe('active jobs wiring', () => {
  beforeEach(() => {
    bulk.set('processing');
    vi.clearAllMocks();
  });

  it('registers a beforeunload listener while a bulk job is active', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    renderSidebar(true);
    await waitFor(() => expect(addSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function)));
    addSpy.mockRestore();
  });

  it('sidebar Upload badge shows the active job count', async () => {
    renderSidebar(true);
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument());
  });

  it('no badge without active jobs', () => {
    renderSidebar(false);
    expect(screen.queryByText('1')).not.toBeInTheDocument();
  });

  it('badge drops to 0 once the job completes', async () => {
    renderSidebar(true);
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument());
    act(() => {
      bulk.set('done');
    });
    await waitFor(() => expect(screen.queryByText('1')).not.toBeInTheDocument());
  });

  it('beforeunload listener is removed when no job is active anymore', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    renderSidebar(true);
    await waitFor(() => expect(addSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function)));
    act(() => {
      bulk.set('done');
    });
    await waitFor(() =>
      expect(removeSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function)),
    );
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
