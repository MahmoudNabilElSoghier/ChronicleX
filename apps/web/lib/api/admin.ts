import { api } from './client';
import type { CurrentUser } from '@chroniclex/shared';

export interface AdminUser {
  id: string;
  email: string;
  nameAr: string;
  nameEn: string;
  isActive: boolean;
  createdAt: string;
  roles: { roleId?: string; name: string; scopeType: string; scopeId: string }[];
}

export interface AdminRole {
  id: string;
  name: string;
  description: string | null;
}

export interface AuditRow {
  id: string;
  action: string;
  resource: string;
  userId: string | null;
  resourceId: string | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface StructureProject {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  entryCount: number;
  lastUploadAt: string | null;
}

export interface StructureCompany {
  id: string;
  code: number;
  nameAr: string;
  nameEn: string;
  entryCount: number;
  lastUploadAt: string | null;
  projects: StructureProject[];
}

function toQuery(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      qs.set(key, String(value));
    }
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export interface CompanyRow {
  id: string;
  code: number;
  nameAr: string;
  nameEn: string;
}

export interface ProjectRow {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  companyId: string;
}

export const adminApi = {
  companies: {
    create: (body: { code: number; nameAr: string; nameEn: string }): Promise<CompanyRow> =>
      api.request<CompanyRow>('/companies', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: { nameAr?: string; nameEn?: string }): Promise<CompanyRow> =>
      api.request<CompanyRow>(`/companies/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (id: string): Promise<CompanyRow> =>
      api.request<CompanyRow>(`/companies/${id}`, { method: 'DELETE' }),
  },
  projects: {
    create: (body: {
      code: string;
      nameAr: string;
      nameEn: string;
      companyId: string;
    }): Promise<ProjectRow> =>
      api.request<ProjectRow>('/projects', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: { nameAr?: string; nameEn?: string }): Promise<ProjectRow> =>
      api.request<ProjectRow>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (id: string): Promise<ProjectRow> =>
      api.request<ProjectRow>(`/projects/${id}`, { method: 'DELETE' }),
  },
  users: {
    list: (params: Record<string, string | number | undefined>): Promise<{
      items: AdminUser[];
      nextCursor: string | null;
    }> => api.request(`/users${toQuery(params)}`),
    get: (id: string): Promise<AdminUser> => api.request(`/users/${id}`),
    create: (body: Record<string, unknown>): Promise<AdminUser> =>
      api.request('/users', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: Record<string, unknown>): Promise<AdminUser> =>
      api.request(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    grantRole: (
      userId: string,
      body: { roleId: string; scopeType: string; scopeId?: string },
    ): Promise<unknown> =>
      api.request(`/users/${userId}/roles`, { method: 'POST', body: JSON.stringify(body) }),
    revokeRole: (userId: string, roleId: string, scopeType: string, scopeId: string): Promise<void> =>
      api.request(
        `/users/${userId}/roles/${roleId}?scopeType=${scopeType}&scopeId=${encodeURIComponent(scopeId)}`,
        { method: 'DELETE' },
      ),
    changePassword: (body: { currentPassword: string; newPassword: string }): Promise<void> =>
      api.request('/users/me/change-password', { method: 'POST', body: JSON.stringify(body) }),
  },
  roles: {
    list: (): Promise<{ items: AdminRole[] }> => api.request('/users/roles'),
  },
  audit: {
    list: (params: Record<string, string | number | undefined>): Promise<{
      items: AuditRow[];
      nextCursor: string | null;
      hasMore: boolean;
    }> => api.request(`/audit-logs${toQuery(params)}`),
  },
  structure: {
    get: (): Promise<{ companies: StructureCompany[] }> =>
      api.request('/admin/structure'),
  },
};

export type { CurrentUser };
