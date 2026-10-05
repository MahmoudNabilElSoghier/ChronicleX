import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useUploadQueue } from './use-upload-queue';

vi.mock('@/lib/api/entries', () => ({
  uploadApi: {
    single: vi.fn(),
    bulk: vi.fn(),
    bulkStatus: vi.fn(),
    bulkCancel: vi.fn(),
  },
  entriesApi: {},
  catalogApi: {},
}));

import { uploadApi } from '@/lib/api/entries';

const singleMock = vi.mocked(uploadApi.single);
const bulkMock = vi.mocked(uploadApi.bulk);

function pdf(name: string): File {
  return new File(['%PDF'], name, { type: 'application/pdf' });
}

function renderQueue(): { result: { current: ReturnType<typeof useUploadQueue> } } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }): JSX.Element => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useUploadQueue(), { wrapper });
}

describe('useUploadQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('addFiles parses each file', () => {
    const { result } = renderQueue();
    act(() => {
      result.current.addFiles([pdf('6200000000.pdf'), pdf('nope.pdf')]);
    });
    expect(result.current.items).toHaveLength(2);
    expect(result.current.items[0]?.parse.ok).toBe(true);
    expect(result.current.items[1]?.parse.ok).toBe(false);
    expect(result.current.totalValid).toBe(1);
    expect(result.current.totalInvalid).toBe(1);
  });

  it('submit with one valid file uploads via single endpoint', async () => {
    singleMock.mockResolvedValue({ id: 'e1' });
    const { result } = renderQueue();
    act(() => {
      result.current.addFiles([pdf('6200000000.pdf')]);
    });
    await act(async () => {
      await result.current.submit({ companyId: 'c1', projectId: 'p1', year: 2025 });
    });
    expect(singleMock).toHaveBeenCalledTimes(1);
    expect(bulkMock).not.toHaveBeenCalled();
    expect(result.current.items[0]?.status).toBe('done');
    expect(result.current.items[0]?.entryId).toBe('e1');
  });

  it('submit with mixed files sends only valid ones to bulk', async () => {
    bulkMock.mockResolvedValue({
      jobId: 'job1', status: 'processing', total: 2, immediateFailures: 0, statusUrl: '/x',
    });
    const { result } = renderQueue();
    act(() => {
      result.current.addFiles([pdf('6200000000.pdf'), pdf('bad.pdf'), pdf('6300000001.pdf')]);
    });
    await act(async () => {
      await result.current.submit({ companyId: 'c1', projectId: 'p1', year: 2025 });
    });
    expect(bulkMock).toHaveBeenCalledTimes(1);
    const formData = bulkMock.mock.calls[0]?.[0] as FormData;
    expect(formData.getAll('files')).toHaveLength(2);
    expect(result.current.jobId).toBe('job1');
  });
});
