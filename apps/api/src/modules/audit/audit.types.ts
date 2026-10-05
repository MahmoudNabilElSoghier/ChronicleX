import type { Action, Resource } from '../../generated/prisma/client';

export interface AuditWriteInput {
  userId: string | null;
  action: Action;
  resource: Resource;
  resourceId: string | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  event?: string;
}
