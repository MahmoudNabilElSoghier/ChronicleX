import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './client';

function jsonResponse(body: unknown, status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'x',
    json: () => Promise.resolve(body),
  } as Response;
}

describe('ApiClient', () => {
  beforeEach(() => {
    api.setAccessToken('stale.token');
  });

  it('on 401 refreshes once and retries the original request', async () => {
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: 'expired' }, 401))
      .mockResolvedValueOnce(jsonResponse({ accessToken: 'fresh.token' }, 200))
      .mockResolvedValueOnce(jsonResponse({ id: 'u1' }, 200));
    globalThis.fetch = fetchMock;

    const res = await api.request<{ id: string }>('/auth/me');
    expect(res).toEqual({ id: 'u1' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const retryHeaders = fetchMock.mock.calls[2][1].headers as Headers;
    expect(retryHeaders.get('Authorization')).toBe('Bearer fresh.token');
    expect(api.getAccessToken()).toBe('fresh.token');
  });

  it('failed refresh clears the token and throws 401', async () => {
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: 'expired' }, 401))
      .mockResolvedValueOnce(jsonResponse({ message: 'gone' }, 401));
    globalThis.fetch = fetchMock;

    await expect(api.request('/auth/me')).rejects.toMatchObject({ status: 401 });
    expect(api.getAccessToken()).toBeNull();
  });

  it('parses NestJS error bodies into ApiError', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      jsonResponse({ statusCode: 409, message: 'dup', code: 'DUPLICATE_SERIAL' }, 409),
    );
    const err = await api.request('/entries').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err as ApiError).toMatchObject({ status: 409, code: 'DUPLICATE_SERIAL' });
  });

  it('fetchBlob re-types the blob as application/pdf', async () => {
    const untitled = new Blob(['%PDF-body'], { type: '' });
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      blob: () => Promise.resolve(untitled),
    });
    const blob = await api.fetchBlob('/entries/e1/file');
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.filename).toBeUndefined();
  });

  it('fetchBlob exposes the Content-Disposition filename as blob.filename', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="entries-filtered-42-2026-10-09.zip"',
      }),
      blob: () => Promise.resolve(new Blob(['PK'], { type: 'application/zip' })),
    });
    const blob = await api.fetchBlob('/entries/bundle-download', {
      method: 'POST',
      body: JSON.stringify({ mode: 'filtered' }),
    });
    expect(blob.filename).toBe('entries-filtered-42-2026-10-09.zip');
    expect(blob.type).toBe('application/zip');
  });

  it('does NOT set Content-Type for FormData bodies (boundary must survive)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ jobId: 'j1' }, 202));
    globalThis.fetch = fetchMock;
    const form = new FormData();
    form.append('companyId', 'c1');
    await api.request('/entries/bulk-upload', { method: 'POST', body: form });
    const headers = fetchMock.mock.calls[0][1].headers as Headers;
    expect(headers.get('Content-Type')).toBeNull();
  });

  it('sets application/json for string bodies', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ ok: true }, 200));
    globalThis.fetch = fetchMock;
    await api.request('/auth/login', { method: 'POST', body: JSON.stringify({ a: 1 }), skipAuth: true });
    const headers = fetchMock.mock.calls[0][1].headers as Headers;
    expect(headers.get('Content-Type')).toBe('application/json');
  });
});
