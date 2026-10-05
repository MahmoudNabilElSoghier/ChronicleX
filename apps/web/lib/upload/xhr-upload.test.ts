import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/client';
import { xhrUpload } from './xhr-upload';

class FakeUpload {
  onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null = null;
}

class FakeXhr {
  static last: FakeXhr | null = null;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  withCredentials = false;
  upload = new FakeUpload();
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 200;
  statusText = 'OK';
  responseText = '';
  sentBody: unknown = null;

  constructor() {
    FakeXhr.last = this;
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(key: string, value: string): void {
    this.headers[key] = value;
  }

  send(body: unknown): void {
    this.sentBody = body;
  }

  respond(status: number, body: string): void {
    this.status = status;
    this.responseText = body;
    this.onload?.();
  }
}

describe('xhrUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('XMLHttpRequest', FakeXhr as unknown as typeof XMLHttpRequest);
  });

  it('fires onProgress and resolves parsed JSON', async () => {
    const onProgress = vi.fn();
    const promise = xhrUpload<{ id: string }>({
      url: 'http://x/entries',
      method: 'POST',
      headers: {},
      body: new FormData(),
      onProgress: (loaded, total) => onProgress(loaded, total),
    });
    const xhr = FakeXhr.last as unknown as FakeXhr;
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
    xhr.respond(201, JSON.stringify({ id: 'e1' }));
    await expect(promise).resolves.toEqual({ id: 'e1' });
    expect(onProgress).toHaveBeenCalledWith(50, 100);
  });

  it('on 401 refreshes and retries once', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ accessToken: 'fresh.token' }),
    });
    const promise = xhrUpload<{ id: string }>({
      url: 'http://x/entries',
      method: 'POST',
      headers: { Authorization: 'Bearer stale' },
      body: new FormData(),
    });
    (FakeXhr.last as unknown as FakeXhr).respond(401, JSON.stringify({ message: 'expired' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/refresh'),
      expect.objectContaining({ method: 'POST' }),
    );
    (FakeXhr.last as unknown as FakeXhr).respond(201, JSON.stringify({ id: 'e2' }));
    await expect(promise).resolves.toEqual({ id: 'e2' });
  });

  it('parses NestJS error bodies into ApiError', async () => {
    const promise = xhrUpload({
      url: 'http://x/entries',
      method: 'POST',
      headers: {},
      body: new FormData(),
    });
    (FakeXhr.last as unknown as FakeXhr).respond(
      409,
      JSON.stringify({ statusCode: 409, message: 'dup', code: 'DUPLICATE_SERIAL' }),
    );
    const err = await promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err as ApiError).toMatchObject({ status: 409, code: 'DUPLICATE_SERIAL' });
  });
});
