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
});
