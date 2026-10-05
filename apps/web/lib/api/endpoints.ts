import type { CurrentUser, LoginResponse } from '@chroniclex/shared';
import { api } from './client';

export const authApi = {
  login: (email: string, password: string): Promise<LoginResponse> =>
    api.request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      skipAuth: true,
    }),
  logout: (): Promise<void> => api.request<void>('/auth/logout', { method: 'POST' }),
  me: (): Promise<CurrentUser> => api.request<CurrentUser>('/auth/me'),
};

export interface DashboardSummary {
  companies: number;
  projects: number;
  entries: {
    total: number;
    byYear: { year: number; count: number }[];
    byTypePrefix: { prefix: string; count: number }[];
  };
  recentUploads: {
    id: string;
    serial: string;
    fileName: string;
    createdAt: string;
    company: { nameAr: string };
    project: { nameAr: string };
    uploadedBy: { nameAr: string };
  }[];
}

export const dashboardApi = {
  summary: (): Promise<DashboardSummary> => api.request<DashboardSummary>('/dashboard/summary'),
};

export const usersApi = {
  // Phase 7b-4
  list: (query: string): Promise<unknown> => api.request(`/users${query}`),
};

export const entriesApi = {
  // Phase 7b-2 / 7b-3
  list: (query: string): Promise<unknown> => api.request(`/entries${query}`),
};

export const auditApi = {
  // Phase 7b-4
  list: (query: string): Promise<unknown> => api.request(`/audit-logs${query}`),
};
