import { ApiError, refreshAccessToken } from '@/lib/api/client';

/**
 * POST FormData with upload progress (fetch exposes none).
 * Mirrors ApiClient's auth + refresh + error semantics.
 */
export function xhrUpload<T>(args: {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: FormData;
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
}): Promise<T> {
  function send(headers: Record<string, string>, retried: boolean): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(args.method, args.url);
      for (const [key, value] of Object.entries(headers)) {
        xhr.setRequestHeader(key, value);
      }
      xhr.withCredentials = true;
      if (args.onProgress && xhr.upload) {
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            args.onProgress?.(event.loaded, event.total);
          }
        };
      }
      if (args.signal) {
        const abort = (): void => xhr.abort();
        if (args.signal.aborted) {
          abort();
        } else {
          args.signal.addEventListener('abort', abort, { once: true });
        }
      }
      xhr.onload = () => {
        if (xhr.status === 401 && !retried) {
          refreshAccessToken()
            .then((fresh) =>
              send({ ...headers, Authorization: `Bearer ${fresh}` }, true).then(resolve, reject),
            )
            .catch(() => reject(new ApiError(401, 'UNAUTHENTICATED', 'Session expired')));
          return;
        }
          if (xhr.status < 200 || xhr.status >= 300) {
            reject(parseXhrError(xhr));
            return;
          }
          if (xhr.status === 204 || xhr.responseText === '') {
            resolve(undefined as T);
            return;
          }
          try {
            resolve(JSON.parse(xhr.responseText) as T);
          } catch {
            reject(new ApiError(xhr.status, `HTTP_${xhr.status}`, 'Invalid JSON response'));
          }
        };
      xhr.onerror = () => reject(new ApiError(0, 'NETWORK_ERROR', 'Network error'));
      xhr.onabort = () => reject(new ApiError(0, 'ABORTED', 'Upload aborted'));
      xhr.send(args.body);
    });
  }
  return send(args.headers, false);
}

function parseXhrError(xhr: XMLHttpRequest): ApiError {
  try {
    const body = JSON.parse(xhr.responseText) as {
      statusCode?: number;
      message?: string | string[];
      code?: string;
    };
    const message = Array.isArray(body.message) ? body.message.join(', ') : (body.message ?? xhr.statusText);
    return new ApiError(xhr.status, body.code ?? `HTTP_${xhr.status}`, message, body);
  } catch {
    return new ApiError(xhr.status, `HTTP_${xhr.status}`, xhr.statusText || 'Upload failed');
  }
}
