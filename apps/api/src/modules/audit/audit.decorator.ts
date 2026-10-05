import { SetMetadata } from '@nestjs/common';
import type { Action, Resource } from '../../generated/prisma/client';

export const AUDIT_SPEC = 'auditSpec';

export interface AuditSpec {
  action: Action;
  resource: Resource;
  /** params key holding the resource id. Default 'id'. Null = no id on this route. */
  idParam?: string | null;
  /** default true for UPDATE / DELETE / RESTORE */
  captureOld?: boolean;
  /** default true for CREATE / UPDATE / RESTORE */
  captureNew?: boolean;
  /** extra field names to redact (merged with the default blocklist) */
  redact?: string[];
}

export const Audit = (spec: AuditSpec): MethodDecorator & ClassDecorator =>
  SetMetadata(AUDIT_SPEC, spec);
