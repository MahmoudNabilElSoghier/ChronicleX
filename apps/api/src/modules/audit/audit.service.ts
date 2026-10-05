import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsService } from '../rbac/permissions.service';
import type { AuditWriteInput } from './audit.types';
import type { ListAuditLogsDto } from './dto/list-audit-logs.dto';

const DEFAULT_BLOCKLIST = [
  'password',
  'passwordhash',
  'token',
  'refreshtoken',
  'accesstoken',
  'authorization',
  'cookie',
  'secret',
];

/** Deep-redact keys matching the blocklist (case-insensitive). Pure function. */
export function redact(value: unknown, extra: string[] = []): unknown {
  const blocked = new Set([...DEFAULT_BLOCKLIST, ...extra.map((k) => k.toLowerCase())]);
  if (Array.isArray(value)) {
    return value.map((v) => redact(v, extra));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = blocked.has(k.toLowerCase()) ? '[REDACTED]' : redact(v, extra);
    }
    return out;
  }
  return value;
}

@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  async write(entry: AuditWriteInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: entry.userId,
          action: entry.action,
          resource: entry.resource,
          resourceId: entry.resourceId,
          ...(entry.oldValues === null || entry.oldValues === undefined
            ? {}
            : { oldValues: redact(entry.oldValues) as Prisma.InputJsonValue }),
          ...(entry.newValues === null || entry.newValues === undefined
            ? {}
            : {
                newValues: redact({
                  ...entry.newValues,
                  ...(entry.event ? { event: entry.event } : {}),
                }) as Prisma.InputJsonValue,
              }),
          ipAddress: entry.ipAddress,
          userAgent: entry.userAgent,
        },
      });
    } catch (err) {
      // Audit must never break the request. Loud on stderr, swallowed.
      // eslint-disable-next-line no-console
      console.error('[AuditService] write failed:', err instanceof Error ? err.message : err);
    }
  }

  /**
   * Paginated audit reads. Currently GROUP-VIEW-AUDIT holders only
   * (SUPER_ADMIN in practice).
   *
   * TODO(scoped-audit-reads): COMPANY_ADMIN holds VIEW AUDIT at company
   * scope. Serve them rows limited to users within their company by joining
   * AuditLog.user → UserRole → scope. Until then, non-GROUP callers get 403.
   */
  async list(query: ListAuditLogsDto, userId: string): Promise<Record<string, unknown>> {
    const grants = await this.permissions.getEffectiveGrants(userId);
    const allowed = grants.some(
      (g) => g.action === 'VIEW' && g.resource === 'AUDIT' && g.scopeType === 'GROUP',
    );
    if (!allowed) {
      throw new ForbiddenException('Insufficient permissions');
    }
    const where: Prisma.AuditLogWhereInput = {};
    if (query.userId) where.userId = query.userId;
    if (query.resource) where.resource = query.resource;
    if (query.action) where.action = query.action;
    if (query.resourceId) where.resourceId = query.resourceId;
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    const limit = query.limit;
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items.length > 0 ? items[items.length - 1] : undefined;
    return {
      items,
      nextCursor: hasMore && last ? last.id : null,
      hasMore,
    };
  }
}
