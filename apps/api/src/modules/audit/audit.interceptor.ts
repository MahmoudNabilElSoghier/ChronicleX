import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { lastValueFrom, of } from 'rxjs';
import type { AuthenticatedUser } from '../auth/types';
import { AUDIT_SPEC, AuditSpec } from './audit.decorator';
import { AuditService, redact } from './audit.service';
import { ResourceLoaderService } from './resource-loader.service';

const OLD_BY_DEFAULT = new Set(['UPDATE', 'DELETE', 'RESTORE']);
const NEW_BY_DEFAULT = new Set(['CREATE', 'UPDATE', 'RESTORE']);

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
    private readonly loader: ResourceLoaderService,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<ReturnType<CallHandler['handle']>> {
    const spec = this.reflector.getAllAndOverride<AuditSpec>(AUDIT_SPEC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!spec) {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest() as Request & { user?: AuthenticatedUser };
    const userId = req.user?.id ?? null;
    const ip = typeof req.ip === 'string' ? req.ip : null;
    const rawUa = req.headers?.['user-agent'];
    const userAgent = typeof rawUa === 'string' ? rawUa : null;

    const captureOld = spec.captureOld ?? OLD_BY_DEFAULT.has(spec.action);
    const idParam = spec.idParam === undefined ? 'id' : spec.idParam;
    const params = req.params as Record<string, unknown> | undefined;
    const paramId =
      idParam === null
        ? undefined
        : typeof params?.[idParam] === 'string'
          ? (params[idParam] as string)
          : undefined;

    let oldValues: Record<string, unknown> | null = null;
    if (captureOld && paramId) {
      oldValues = await this.loader.load(spec.resource, paramId);
    }

    // Handler errors propagate untouched — nothing was mutated, nothing logged.
    const response = await lastValueFrom(next.handle());

    const captureNew = spec.captureNew ?? NEW_BY_DEFAULT.has(spec.action);
    let resourceId: string | null = paramId ?? null;
    let newValues: Record<string, unknown> | null = null;
    if (captureNew && response !== null && typeof response === 'object') {
      const body = response as Record<string, unknown>;
      newValues = body;
      if (spec.action === 'CREATE' && typeof body.id === 'string') {
        resourceId = body.id;
      }
    }

    if (oldValues === null && newValues === null && resourceId === null) {
      return of(response);
    }

    const write = {
      userId,
      action: spec.action,
      resource: spec.resource,
      resourceId,
      oldValues: oldValues ? (redact(oldValues, spec.redact) as Record<string, unknown>) : null,
      newValues: newValues ? (redact(newValues, spec.redact) as Record<string, unknown>) : null,
      ipAddress: ip,
      userAgent,
    };
    // Fire-and-forget: audit must never add latency. AuditService swallows
    // its own errors; the extra catch guards the scheduling itself.
    setImmediate(() => {
      void this.audit
        .write(write)
        .catch((err) => {
          // Defensive: write() already swallows internally.
          // eslint-disable-next-line no-console
          console.error('[AuditInterceptor] unexpected audit failure', err);
        });
    });
    return of(response);
  }
}
