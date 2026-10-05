import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ar from '@/messages/ar.json';
import { Sidebar } from '@/components/layout/sidebar';
import { ActiveJobsProvider, useActiveJobs } from '@/lib/upload/active-jobs-context';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/ar/upload',
}));

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({ user: null, status: 'unauthenticated', login: vi.fn(), logout: vi.fn() }),
  useRequireAuth: () => null,
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
});
