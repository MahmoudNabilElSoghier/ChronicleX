export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions extends RequestInit {
  skipAuth?: boolean;
}

function baseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  return url.replace(/\/$/, '');
}

let refreshPromise: Promise<string> | null = null;

/**
 * Standalone, deduplicated refresh for every transport (fetch + XHR).
 * Module-level promise so concurrent callers share one refresh round-trip.
 */
export async function refreshAccessToken(): Promise<string> {
  if (refreshPromise) {
    return refreshPromise;
  }
  refreshPromise = (async () => {
    try {
      const res = await fetch(`${baseUrl()}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        throw new Error('refresh failed');
      }
      const body = (await res.json()) as { accessToken: string };
      api.setAccessToken(body.accessToken);
      return body.accessToken;
    } catch {
      api.setAccessToken(null);
      throw new ApiError(401, 'UNAUTHENTICATED', 'Session expired');
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

class ApiClient {
  private accessToken: string | null = null;

  setAccessToken(token: string | null): void {
    this.accessToken = token;
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  private async parseError(res: Response): Promise<never> {
    let body: { statusCode?: number; message?: string | string[]; code?: string } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      // non-JSON error body
    }
    const message = Array.isArray(body.message) ? body.message.join(', ') : (body.message ?? res.statusText);
    throw new ApiError(res.status, body.code ?? `HTTP_${res.status}`, message, body);
  }

  async request<T>(path: string, init: RequestOptions = {}, retried = false): Promise<T> {
    const headers = new Headers(init.headers);
    // Only JSON bodies get an explicit content type. FormData/Blob must keep
    // the browser-generated multipart boundary.
    if (!headers.has('Content-Type') && typeof init.body === 'string') {
      headers.set('Content-Type', 'application/json');
    }
    if (this.accessToken && !init.skipAuth) {
      headers.set('Authorization', `Bearer ${this.accessToken}`);
    }
    const res = await fetch(`${baseUrl()}${path}`, { ...init, headers, credentials: 'include' });
    if (res.status === 401 && !init.skipAuth && !retried) {
      try {
        await refreshAccessToken();
      } catch {
        throw new ApiError(401, 'UNAUTHENTICATED', 'Session expired');
      }
      return this.request<T>(path, init, true);
    }
    if (!res.ok) {
      await this.parseError(res);
    }
    if (res.status === 204) {
      return undefined as T;
    }
    return (await res.json()) as T;
  }

  async fetchBlob(path: string, init: RequestInit = {}, retried = false): Promise<Blob> {
    const headers = new Headers(init.headers);
    // JSON bodies need an explicit content type (same rule as request()).
    if (!headers.has('Content-Type') && typeof init.body === 'string') {
      headers.set('Content-Type', 'application/json');
    }
    if (this.accessToken) {
      headers.set('Authorization', `Bearer ${this.accessToken}`);
    }
    const res = await fetch(`${baseUrl()}${path}`, { ...init, headers, credentials: 'include' });
    if (res.status === 401 && !retried) {
      try {
        await refreshAccessToken();
      } catch {
        throw new ApiError(401, 'UNAUTHENTICATED', 'Session expired');
      }
      return this.fetchBlob(path, init, true);
    }
    if (!res.ok) {
      await this.parseError(res);
    }
    const raw = await res.blob();
    // Re-type defensively: some S3/streamed responses arrive without a
    // Content-Type, and Chrome refuses to render untyped blobs as PDF.
    // A declared type (text/csv from the export endpoint) wins.
    return new Blob([raw], { type: raw.type || 'application/pdf' });
  }

}

export const api = new ApiClient();

export function apiBaseUrl(): string {
  return baseUrl();
}
