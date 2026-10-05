import { api, apiBaseUrl } from './client';
import { xhrUpload } from '@/lib/upload/xhr-upload';

export interface BulkUploadAccepted {
  jobId: string;
  status: string;
  total: number;
  immediateFailures: number;
  statusUrl: string;
}

export interface BulkResult {
  fileUuid: string;
  originalName: string;
  status: 'ok' | 'error';
  entryId?: string;
  existingEntryId?: string;
  errorCode?: string;
  errorMessage?: string;
  serial?: string;
  typePrefix?: string;
}

export interface BulkStatus {
  jobId: string;
  status: 'queued' | 'processing' | 'done' | 'failed' | 'cancelled';
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  createdAt: string;
  results: BulkResult[];
  resultsTruncated: boolean;
}

export interface EntryListItem {
  id: string;
  serial: string;
  typePrefix: string;
  year: number;
  companyId: string;
  projectId: string;
  company: { code: number; nameAr: string; nameEn: string };
  project: { code: string; nameAr: string; nameEn: string };
  fileName: string;
  fileSize: number;
  createdAt: string;
  deletedAt: string | null;
  uploadedBy: { id: string; nameAr: string };
}

export interface EntriesListResponse {
  items: EntryListItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface EntryDetail extends EntryListItem {
  counter: number;
  mimeType: string;
  fileHash: string;
}

export interface AuditEvent {
  id: string;
  action: string;
  resource: string;
  userId: string | null;
  userNameAr: string | null;
  event: string;
  createdAt: string;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
}

export interface EntriesFilters {
  companyId?: string;
  projectId?: string;
  year?: number;
  typePrefix?: string;
  serial?: string;
  q?: string;
  includeDeleted?: boolean;
  cursor?: string;
  limit?: number;
}

function toQuery(filters: EntriesFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '' && value !== false) {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export interface CatalogItem {
  id: string;
  code: number | string;
  nameAr: string;
  nameEn: string;
  companyId?: string;
}

export interface UpdateEntryBody {
  projectId?: string;
  year?: number;
}

export const entriesApi = {
  list: (filters: EntriesFilters): Promise<EntriesListResponse> =>
    api.request<EntriesListResponse>(`/entries${toQuery(filters)}`),
  get: (id: string): Promise<EntryDetail> => api.request<EntryDetail>(`/entries/${id}`),
  getAudit: (id: string): Promise<{ items: AuditEvent[] }> =>
    api.request<{ items: AuditEvent[] }>(`/entries/${id}/audit`),
  download: (id: string): Promise<Blob> => api.fetchBlob(`/entries/${id}/file`),
  remove: (id: string): Promise<void> => api.request<void>(`/entries/${id}`, { method: 'DELETE' }),
  restore: (id: string): Promise<void> =>
    api.request<void>(`/entries/${id}/restore`, { method: 'POST' }),
  update: (id: string, body: UpdateEntryBody): Promise<EntryDetail> =>
    api.request<EntryDetail>(`/entries/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
};

export const catalogApi = {
  companies: (): Promise<{ items: CatalogItem[] }> =>
    api.request<{ items: CatalogItem[] }>('/companies'),
  projects: (companyId?: string): Promise<{ items: CatalogItem[] }> =>
    api.request<{ items: CatalogItem[] }>(companyId ? `/projects?companyId=${companyId}` : '/projects'),
  years: (): Promise<{ years: number[] }> => api.request<{ years: number[] }>('/entries/years'),
};

export const uploadApi = {
  single: (formData: FormData, onProgress: (loaded: number, total: number) => void): Promise<EntryDetail> =>
    xhrUpload<EntryDetail>({
      url: `${apiBaseUrl()}/entries`,
      method: 'POST',
      headers: { Authorization: `Bearer ${api.getAccessToken() ?? ''}` },
      body: formData,
      onProgress,
    }),
  bulk: (formData: FormData): Promise<BulkUploadAccepted> =>
    api.request<BulkUploadAccepted>('/entries/bulk-upload', { method: 'POST', body: formData }),
  bulkStatus: (jobId: string): Promise<BulkStatus> =>
    api.request<BulkStatus>(`/entries/bulk-upload/${jobId}`),
  bulkCancel: (jobId: string): Promise<void> =>
    api.request<void>(`/entries/bulk-upload/${jobId}/cancel`, { method: 'POST' }),
};
