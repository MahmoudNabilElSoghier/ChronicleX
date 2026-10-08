import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ar from '@/messages/ar.json';
import { type QueueScope, LAST_BATCH_KEY, useUploadQueue } from './use-upload-queue';

vi.mock('@/lib/api/entries', () => ({
  uploadApi: {
    single: vi.fn(),
    bulk: vi.fn(),
    bulkStatus: vi.fn(),
    bulkCancel: vi.fn(),
    preview: vi.fn(),
  },
  entriesApi: {},
  catalogApi: {},
}));

import { uploadApi } from '@/lib/api/entries';

const singleMock = vi.mocked(uploadApi.single);
const bulkMock = vi.mocked(uploadApi.bulk);
const bulkStatusMock = vi.mocked(uploadApi.bulkStatus);
const previewMock = vi.mocked(uploadApi.preview);
let digestMock = vi.fn();

const SCOPE: QueueScope = { companyId: 'c1', projectId: 'p1', year: '2025' };

function pdf(name: string): File {
  return new File(['%PDF'], name, { type: 'application/pdf' });
}

function renderQueue(scope?: QueueScope): {
  result: { current: ReturnType<typeof useUploadQueue> };
} {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }): JSX.Element => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useUploadQueue(scope), { wrapper });
}

async function flushPreview(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(450);
    // let the debounced preview promise chain resolve inside act
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

describe('useUploadQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.useRealTimers();
    // Node's webcrypto digest does not settle under vi.useFakeTimers();
    // stub it so hash enrichment (and the preview call) stays deterministic.
    digestMock = vi.fn().mockResolvedValue(new ArrayBuffer(32));
    Object.defineProperty(globalThis.crypto, 'subtle', {
      configurable: true,
      value: { digest: digestMock },
    });
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

  it('check state: pending_scope → pending_check → valid around scope + preview', async () => {
    previewMock.mockResolvedValue({ results: [{ index: 0, status: 'ok' }] });
    vi.useFakeTimers();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }): JSX.Element => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(
      ({ scope }: { scope: QueueScope | undefined }) => useUploadQueue(scope),
      { wrapper, initialProps: { scope: undefined as QueueScope | undefined } },
    );

    act(() => {
      result.current.addFiles([pdf('6200000000.pdf')]);
    });
    expect(result.current.items[0]?.check).toBe('pending_scope');

    rerender({ scope: SCOPE });
    expect(result.current.items[0]?.check).toBe('pending_check');

    await flushPreview();
    expect(previewMock).toHaveBeenCalledTimes(1);
    expect(previewMock).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'c1',
        projectId: 'p1',
        year: 2025,
        fileNames: ['6200000000.pdf'],
      }),
    );
    expect(result.current.items[0]?.check).toBe('valid');
  });

  it('5 files: hashes computed and preview called with fileHashes', async () => {
    previewMock.mockResolvedValue({
      results: [0, 1, 2, 3, 4].map((index) => ({ index, status: 'ok' as const })),
    });
    vi.useFakeTimers();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }): JSX.Element => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useUploadQueue(SCOPE), { wrapper });

    act(() => {
      result.current.addFiles(
        ['6200000000.pdf', '6200000001.pdf', '6200000002.pdf', '6300000003.pdf', '6300000004.pdf'].map(pdf),
      );
    });
    await flushPreview();

    expect(digestMock).toHaveBeenCalledTimes(5);
    expect(previewMock).toHaveBeenCalledTimes(1);
    expect(previewMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fileNames: [
          '6200000000.pdf',
          '6200000001.pdf',
          '6200000002.pdf',
          '6300000003.pdf',
          '6300000004.pdf',
        ],
        fileHashes: expect.any(Array),
      }),
    );
    expect(result.current.items.every((i) => i.check === 'valid')).toBe(true);
  });

  it('3 files: preview flags 2 duplicate_hash → summary counts 1 valid, 2 invalid', async () => {
    previewMock.mockResolvedValue({
      results: [
        { index: 0, status: 'ok' },
        { index: 1, status: 'duplicate_hash', existingEntryId: 'e1' },
        { index: 2, status: 'duplicate_hash', existingEntryId: 'e2' },
      ],
    });
    vi.useFakeTimers();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }): JSX.Element => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useUploadQueue(SCOPE), { wrapper });

    act(() => {
      result.current.addFiles([
        pdf('6200000000.pdf'),
        pdf('6200000001.pdf'),
        pdf('6300000002.pdf'),
      ]);
    });
    await flushPreview();

    expect(result.current.checkCounts).toEqual({
      valid: 1,
      invalid: 2,
      pending: 0,
      deferred: 0,
    });
    expect(result.current.submittable).toBe(1);
    // the summary bar composes exactly this from the ar message + counts
    const summaryText = ar.upload.bulk.summary
      .replace('{valid}', String(result.current.checkCounts.valid))
      .replace('{invalid}', String(result.current.checkCounts.invalid));
    expect(summaryText).toBe('1 صالح، 2 خطأ');
  });

  it('preview duplicate_serial marks the row invalid and submit skips it', async () => {
    previewMock.mockResolvedValue({
      results: [{ index: 0, status: 'duplicate_serial', existingEntryId: 'e9' }],
    });
    vi.useFakeTimers();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }): JSX.Element => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useUploadQueue(SCOPE), { wrapper });

    act(() => {
      result.current.addFiles([pdf('6200000000.pdf')]);
    });
    expect(result.current.items[0]?.check).toBe('pending_check');

    await flushPreview();
    expect(result.current.items[0]?.check).toBe('invalid');
    expect(result.current.items[0]?.checkReason).toBe('duplicate_serial');
    expect(result.current.items[0]?.existingEntryId).toBe('e9');

    vi.useRealTimers();
    await act(async () => {
      await result.current.submit({ companyId: 'c1', projectId: 'p1', year: 2025 });
    });
    expect(singleMock).not.toHaveBeenCalled();
    expect(bulkMock).not.toHaveBeenCalled();
  });

  it('scope change resets stale checks back to pending', async () => {
    previewMock.mockResolvedValue({ results: [{ index: 0, status: 'ok' }] });
    vi.useFakeTimers();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }): JSX.Element => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(
      ({ scope }: { scope: QueueScope | undefined }) => useUploadQueue(scope),
      { wrapper, initialProps: { scope: SCOPE as QueueScope | undefined } },
    );
    act(() => {
      result.current.addFiles([pdf('6200000000.pdf')]);
    });
    await flushPreview();
    expect(result.current.items[0]?.check).toBe('valid');

    rerender({ scope: { companyId: '', projectId: '', year: '' } });
    expect(result.current.items[0]?.check).toBe('pending_scope');
    rerender({ scope: SCOPE });
    expect(result.current.items[0]?.check).toBe('pending_check');
  });

  it('bulk submit persists the last batch; clear() removes it', async () => {
    bulkMock.mockResolvedValue({
      jobId: 'job1', status: 'processing', total: 2, immediateFailures: 0, statusUrl: '/x',
    });
    const { result } = renderQueue(SCOPE);
    act(() => {
      result.current.addFiles([pdf('6200000000.pdf'), pdf('6300000001.pdf')]);
    });
    await act(async () => {
      await result.current.submit({ companyId: 'c1', projectId: 'p1', year: 2025 });
    });
    const raw = sessionStorage.getItem(LAST_BATCH_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toMatchObject({
      jobId: 'job1',
      companyId: 'c1',
      projectId: 'p1',
      year: 2025,
    });
    act(() => {
      result.current.clear();
    });
    expect(sessionStorage.getItem(LAST_BATCH_KEY)).toBeNull();
    expect(result.current.jobId).toBeNull();
  });

  it('restores the persisted job on mount when the report still exists', async () => {
    bulkStatusMock.mockResolvedValue({
      jobId: 'job1', status: 'done', total: 1, processed: 1, succeeded: 1, failed: 0,
      createdAt: new Date().toISOString(), results: [], resultsTruncated: false,
    });
    sessionStorage.setItem(LAST_BATCH_KEY, JSON.stringify({ jobId: 'job1' }));
    const { result } = renderQueue();
    await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); });
    expect(result.current.jobId).toBe('job1');
    expect(bulkStatusMock).toHaveBeenCalledWith('job1');
  });

  it('drops the persisted key when the job report expired (404)', async () => {
    const { ApiError } = await import('@/lib/api/client');
    bulkStatusMock.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'gone'));
    sessionStorage.setItem(LAST_BATCH_KEY, JSON.stringify({ jobId: 'job1' }));
    const { result } = renderQueue();
    await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); });
    expect(result.current.jobId).toBeNull();
    expect(sessionStorage.getItem(LAST_BATCH_KEY)).toBeNull();
  });
});
