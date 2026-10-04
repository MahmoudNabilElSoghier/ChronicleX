// Shared TS types — extended in later phases.
export type Locale = 'ar' | 'en';
export interface HealthStatus {
  status: 'ok';
  version: string;
  uptime: number;
  timestamp: string;
}
