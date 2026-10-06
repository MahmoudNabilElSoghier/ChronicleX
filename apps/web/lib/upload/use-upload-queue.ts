'use client';

import * as React from 'react';
import { ApiError } from '@/lib/api/client';
import { uploadApi, type BulkStatus, type PreviewResult } from '@/lib/api/entries';
import { useBulkUploadStatus } from '@/lib/upload/use-bulk-status';
import { parseFilename, type ParseErrorCode, type ParseResult } from '@/lib/upload/filename-parser';

export type UploadItemStatus = 'pending' | 'uploading' | 'queued' | 'done' | 'failed';

/**
 * Two-phase pre-upload validation:
 * - pending_scope: filename parses, but scope (company/project/year) is not
 *   chosen yet — uniqueness cannot be known without it.
 * - pending_check: scope chosen, pre-flight request in flight.
 * - deferred: batch is over HASH_CAP — client hashing/preview skipped to
 *   keep drop instant; the server validates duplicates during upload.
 * - valid: server pre-flight confirmed no conflicts.
 * - invalid: bad filename, duplicate serial or duplicate hash (reason).
 */
export type CheckState = 'pending_scope' | 'pending_check' | 'deferred' | 'valid' | 'invalid';
export type CheckReason = ParseErrorCode | 'duplicate_serial' | 'duplicate_hash' | 'invalid_filename';

export interface UploadItem {
  id: string;
  file: File;
  name: string;
  size: number;
  parse: ParseResult;
  status: UploadItemStatus;
  progress: number;
  check: CheckState;
  checkReason?: CheckReason | undefined;
  entryId?: string;
  existingEntryId?: string;
  errorCode?: string;
  errorMessage?: string;
  serial?: string;
}

export interface SubmitParams {
  companyId: string;
  projectId: string;
  year: number;
}

export interface QueueScope {
  companyId: string;
  projectId: string;
  year: string;
}

export const LAST_BATCH_KEY = 'bulk-upload:last';
/**
 * Max files we hash + pre-flight client-side. Hashing N large PDFs on the
 * main thread costs seconds of jank, so bigger batches skip it entirely
 * (deferred to server-side validation at upload time).
 */
export const HASH_CAP = 20;
const PREVIEW_DEBOUNCE_MS = 400;

export function scopeIsComplete(scope?: QueueScope): boolean {
  return (
    scope !== undefined &&
    scope.companyId !== '' &&
    scope.projectId !== '' &&
    /^\d{4}$/.test(scope.year)
  );
}

function toItem(file: File, initialCheck: CheckState): UploadItem {
  const parse = parseFilename(file.name);
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    file,
    name: file.name,
    size: file.size,
    parse,
    status: 'pending',
    progress: 0,
    check: parse.ok ? initialCheck : 'invalid',
    ...(parse.ok ? { serial: parse.serial } : { checkReason: parse.code }),
  };
}

/** SHA-256 per file, parallel to items. null when WebCrypto is unavailable. */
async function computeFileHashes(items: UploadItem[]): Promise<string[] | null> {
  if (items.length > HASH_CAP) return null;
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  try {
    return await Promise.all(
      items.map(async (i) => {
        const buf = await i.file.arrayBuffer();
        const digest = await subtle.digest('SHA-256', buf);
        return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
      }),
    );
  } catch {
    return null;
  }
}

function readLastBatch(): string | null {
  try {
    return window.sessionStorage.getItem(LAST_BATCH_KEY);
  } catch {
    return null;
  }
}

function writeLastBatch(value: Record<string, unknown> | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(LAST_BATCH_KEY);
    else window.sessionStorage.setItem(LAST_BATCH_KEY, JSON.stringify(value));
  } catch {
    // storage unavailable (private mode) — restore-on-mount just won't work
  }
}

export function useUploadQueue(scope?: QueueScope): {
  items: UploadItem[];
  addFiles: (files: File[]) => void;
  removeItem: (id: string) => void;
  clear: () => void;
  retryItem: (id: string) => void;
  totalValid: number;
  totalInvalid: number;
  submit: (params: SubmitParams) => Promise<void>;
  jobId: string | null;
  jobStatus: BulkStatus | undefined;
  isSubmitting: boolean;
} {
  const [items, setItems] = React.useState<UploadItem[]>([]);
  const [jobId, setJobId] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const { data: jobStatus } = useBulkUploadStatus(jobId);

  const scopeComplete = scopeIsComplete(scope);
  const scopeKey = scope ? `${scope.companyId}|${scope.projectId}|${scope.year}` : '';
  const overCap = items.length > HASH_CAP;

  const itemsRef = React.useRef(items);
  itemsRef.current = items;
  const scopeRef = React.useRef(scopeComplete);
  scopeRef.current = scopeComplete;
  const scopeValueRef = React.useRef(scope);
  scopeValueRef.current = scope;
  // Bumped whenever a preview becomes stale (scope changed, file set
  // changed) so late responses are dropped instead of mis-applied.
  const seqRef = React.useRef(0);

  const patch = React.useCallback((id: string, patch: Partial<UploadItem>) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }, []);

  const addFiles = React.useCallback((files: File[]) => {
    const complete = scopeRef.current;
    setItems((prev) => {
      const overCap = prev.length + files.length > HASH_CAP;
      const initial: CheckState = !complete
        ? 'pending_scope'
        : overCap
          ? 'deferred'
          : 'pending_check';
      return [...prev, ...files.map((f) => toItem(f, initial))];
    });
  }, []);

  const removeItem = React.useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  // "Clear list" and "Start new batch" both drop the persisted last batch.
  const clear = React.useCallback(() => {
    setItems([]);
    setJobId(null);
    writeLastBatch(null);
  }, []);

  const retryItem = React.useCallback((id: string) => {
    setItems((prev) =>
      prev.map((i) => {
        if (i.id !== id) return i;
        const next = { ...i, status: 'pending' as const, progress: 0 };
        delete next.errorCode;
        delete next.errorMessage;
        return next;
      }),
    );
  }, []);

  const runPreview = React.useCallback(
    async (s: QueueScope, snapshot: UploadItem[], seq: number): Promise<void> => {
      try {
        const fileNames = snapshot.map((i) => i.name);
        const fileHashes = await computeFileHashes(snapshot);
        if (seq !== seqRef.current) return;
        const res = await uploadApi.preview({
          companyId: s.companyId,
          projectId: s.projectId,
          year: Number(s.year),
          fileNames,
          ...(fileHashes ? { fileHashes } : {}),
        });
        if (seq !== seqRef.current) return;
        const results: PreviewResult[] = res?.results ?? [];
        setItems((prev) =>
          prev.map((item) => {
            const idx = snapshot.findIndex((snap) => snap.id === item.id);
            const r: PreviewResult | undefined = idx >= 0 ? results[idx] : undefined;
            if (!r || !item.parse.ok) return item;
            if (r.status === 'ok') {
              return { ...item, check: 'valid' as const, checkReason: undefined };
            }
            return {
              ...item,
              check: 'invalid' as const,
              checkReason: r.status,
              ...(r.existingEntryId ? { existingEntryId: r.existingEntryId } : {}),
            };
          }),
        );
      } catch {
        // Pre-flight unavailable — rows stay pending_check; the server
        // still validates every file at submit time.
      }
    },
    [],
  );

  // Scope change: reset checks (old results belonged to the old scope)
  // and invalidate in-flight previews. Over-cap batches go straight to
  // 'deferred' — no instant checking is performed for them.
  const prevScopeKey = React.useRef(scopeKey);
  React.useEffect(() => {
    if (prevScopeKey.current === scopeKey) return;
    prevScopeKey.current = scopeKey;
    seqRef.current += 1;
    setItems((prev) =>
      prev.map((i) =>
        i.parse.ok
          ? {
              ...i,
              check: !scopeComplete
                ? ('pending_scope' as const)
                : overCap
                  ? ('deferred' as const)
                  : ('pending_check' as const),
              checkReason: undefined,
            }
          : i,
      ),
    );
  }, [scopeKey, scopeComplete, overCap]);

  // Preview on file change AND scope change, debounced 400ms.
  // Batches over HASH_CAP skip hashing + preview entirely (deferred to
  // server-side validation) and never enter pending_check.
  const fileSignature = items.map((i) => i.name).join('\n');
  React.useEffect(() => {
    const seq = ++seqRef.current;
    if (!scopeComplete || items.length === 0) return;
    if (overCap) {
      setItems((prev) =>
        prev.some((i) => i.parse.ok && i.check === 'pending_check')
          ? prev.map((i) =>
              i.parse.ok && i.check === 'pending_check'
                ? { ...i, check: 'deferred' as const, checkReason: undefined }
                : i,
            )
          : prev,
      );
      return;
    }
    // Crossing back under the cap: resume instant checking for the rows
    // that were deferred.
    setItems((prev) =>
      prev.some((i) => i.parse.ok && i.check === 'deferred')
        ? prev.map((i) =>
            i.parse.ok && i.check === 'deferred'
              ? { ...i, check: 'pending_check' as const }
              : i,
          )
        : prev,
    );
    const timer = setTimeout(() => {
      const snapshot = itemsRef.current;
      const s = scopeValueRef.current;
      if (!s || !scopeIsComplete(s)) return;
      if (snapshot.length > HASH_CAP) return;
      if (!snapshot.some((i) => i.parse.ok)) return;
      void runPreview(s, snapshot, seq);
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // scopeKey/fileSignature are the identity of the effect inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, fileSignature, scopeComplete, overCap, runPreview]);

  // Restore the last batch after reload/navigation back. A 404 means the
  // job report expired (24h TTL) — drop the key and show empty state.
  React.useEffect(() => {
    const stored = readLastBatch();
    if (!stored) return;
    let restoredId: string;
    try {
      const parsed = JSON.parse(stored) as { jobId?: unknown };
      if (typeof parsed.jobId !== 'string') throw new Error('bad shape');
      restoredId = parsed.jobId;
    } catch {
      writeLastBatch(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await uploadApi.bulkStatus(restoredId);
        if (!cancelled && res) setJobId(restoredId);
      } catch (err: unknown) {
        if (err instanceof ApiError && err.status === 404) writeLastBatch(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = React.useCallback(
    async (params: SubmitParams): Promise<void> => {
      const valid = items.filter(
        (i) =>
          i.parse.ok &&
          i.check !== 'invalid' &&
          (i.status === 'pending' || i.status === 'failed'),
      );
      if (valid.length === 0) return;
      setIsSubmitting(true);
      try {
        if (valid.length === 1) {
          const item = valid[0] as UploadItem;
          patch(item.id, { status: 'uploading', progress: 0 });
          const form = new FormData();
          form.set('file', item.file);
          form.set('companyId', params.companyId);
          form.set('projectId', params.projectId);
          form.set('year', String(params.year));
          try {
            const res = await uploadApi.single(form, (loaded, total) =>
              patch(item.id, { progress: Math.round((loaded / Math.max(total, 1)) * 100) }),
            );
            patch(item.id, { status: 'done', progress: 100, entryId: res.id });
          } catch (err) {
            const apiErr = err as ApiError;
            const details = apiErr.details as { existingEntryId?: string } | undefined;
            patch(item.id, {
              status: 'failed',
              errorCode: apiErr.code ?? 'UNKNOWN',
              errorMessage: apiErr.message,
              ...(typeof details?.existingEntryId === 'string'
                ? { existingEntryId: details.existingEntryId }
                : {}),
            });
            throw err;
          }
        } else {
          const form = new FormData();
          for (const item of valid) {
            form.append('files', item.file);
            patch(item.id, { status: 'queued' });
          }
          form.set('companyId', params.companyId);
          form.set('projectId', params.projectId);
          form.set('year', String(params.year));
          const accepted = await uploadApi.bulk(form);
          setJobId(accepted.jobId);
          writeLastBatch({
            jobId: accepted.jobId,
            companyId: params.companyId,
            projectId: params.projectId,
            year: params.year,
            startedAt: new Date().toISOString(),
          });
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [items, patch],
  );

  const totalValid = items.filter((i) => i.parse.ok).length;
  const totalInvalid = items.length - totalValid;

  return {
    items, addFiles, removeItem, clear, retryItem,
    totalValid, totalInvalid, submit, jobId, jobStatus, isSubmitting,
  };
}
