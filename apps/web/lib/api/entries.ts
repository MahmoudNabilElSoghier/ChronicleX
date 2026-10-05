import { api } from './client';

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
