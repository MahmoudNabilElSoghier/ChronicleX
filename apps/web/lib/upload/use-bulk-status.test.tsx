import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { uploadApi } from '@/lib/api/entries';
import { useBulkUploadStatus } from './use-bulk-status';

vi.mock('@/lib/api/entries', () => ({
  uploadApi: { bulkStatus: vi.fn() },
}));

const statusMock = vi.mocked(uploadApi.bulkStatus);

describe('useBulkUploadStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('done job returns rows and polling stops', async () => {
    statusMock.mockResolvedValue({
      jobId: 'job1', status: 'done', total: 2, processed: 2, succeeded: 1, failed: 1,
      createdAt: new Date().toISOString(),
      results: [
        { fileUuid: 'a', originalName: '6200000000.pdf', status: 'ok', entryId: 'e1' },
        {
          fileUuid: 'b', originalName: 'bad.pdf', status: 'error',
          errorCode: 'INVALID_FILENAME', errorMessage: 'bad',
        },
      ],
      resultsTruncated: false,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }): JSX.Element => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useBulkUploadStatus('job1'), { wrapper });
    await waitFor(() => expect(result.current.data?.status).toBe('done'));
    expect(result.current.data?.results).toHaveLength(2);
    const callsAfterDone = statusMock.mock.calls.length;
    await new Promise((r) => setTimeout(r, 1800));
    expect(statusMock.mock.calls.length).toBe(callsAfterDone);
  });
});
