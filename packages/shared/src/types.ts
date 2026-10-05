// Shared TS types — extended in later phases.
export type Locale = 'ar' | 'en';
export interface HealthStatus {
  status: 'ok';
  version: string;
  uptime: number;
  timestamp: string;
}

export type Action = 'CREATE' | 'UPDATE' | 'DELETE' | 'RESTORE' | 'VIEW' | 'EXPORT';
export type Resource = 'ENTRY' | 'PROJECT' | 'COMPANY' | 'USER' | 'AUDIT' | 'AUTH';
export type ScopeType = 'GROUP' | 'COMPANY' | 'PROJECT';

export interface RoleGrant {
  name: string;
  scopeType: ScopeType;
  scopeId: string;
}

export interface CurrentUser {
  id: string;
  email: string;
  nameAr: string;
  nameEn: string;
  isActive: boolean;
  roles: RoleGrant[];
}

export interface LoginResponse {
  accessToken: string;
  user: {
    id: string;
    email: string;
    nameAr: string;
    nameEn: string;
  };
}
