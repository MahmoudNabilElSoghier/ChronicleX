'use client';

import * as React from 'react';
import { ApiError } from '@/lib/api/client';
import { uploadApi, type BulkStatus } from '@/lib/api/entries';
import { useBulkUploadStatus } from '@/lib/upload/use-bulk-status';
import { parseFilename, type ParseResult } from '@/lib/upload/filename-parser';

export type UploadItemStatus = 'pending' | 'uploading' | 'queued' | 'done' | 'failed';

export interface UploadItem {
  id: string;
  file: File;
  name: string;
  size: number;
  parse: ParseResult;
  status: UploadItemStatus;
  progress: number;
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

function toItem(file: File): UploadItem {
  const parse = parseFilename(file.name);
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    file,
    name: file.name,
    size: file.size,
    parse,
    status: 'pending',
    progress: 0,
    ...(parse.ok ? { serial: parse.serial } : {}),
  };
}

export function useUploadQueue(): {
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

  const patch = React.useCallback((id: string, patch: Partial<UploadItem>) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }, []);

  const addFiles = React.useCallback((files: File[]) => {
    setItems((prev) => [...prev, ...files.map(toItem)]);
  }, []);

  const removeItem = React.useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const clear = React.useCallback(() => {
    setItems([]);
    setJobId(null);
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

  const submit = React.useCallback(
    async (params: SubmitParams): Promise<void> => {
      const valid = items.filter((i) => i.parse.ok && (i.status === 'pending' || i.status === 'failed'));
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
