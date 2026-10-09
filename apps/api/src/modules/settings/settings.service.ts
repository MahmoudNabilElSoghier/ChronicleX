import { BadRequestException, ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PermissionsService } from '../rbac/permissions.service';

const ENTRY_PREFIXES_KEY = 'entry-prefixes';

/** Code defaults — used when the DB row is missing (fresh installs). */
export const DEFAULT_ENTRY_PREFIXES = ['62', '63', '67'];

export interface SettingsActor {
  userId: string;
  ip: string | null;
  userAgent: string | null;
}

/** JSON rows can arrive typed as unknown — accept only string[]. */
function asPrefixList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((v): v is string => typeof v === 'string')) return null;
  return value;
}

@Injectable()
export class SettingsService implements OnModuleInit {
  /**
   * Boot-loaded cache backing the SYNCHRONOUS getter. BullMQ processors have
   * no request context, so prefix checks cannot await a DB read per file.
   * PUT keeps it fresh on this instance; GET reads the DB (authoritative).
   */
  private prefixes: string[] = [...DEFAULT_ENTRY_PREFIXES];

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: ENTRY_PREFIXES_KEY } });
    const stored = asPrefixList(row?.value);
    if (stored && stored.length > 0) this.prefixes = stored;
  }

  /** Allowed type prefixes. Sync on purpose — safe from queue processors. */
  getEntryPrefixes(): string[] {
    return this.prefixes;
  }

  /** DB-authoritative read for the GET endpoint (defaults if no row). */
  async readEntryPrefixes(): Promise<{ prefixes: string[] }> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: ENTRY_PREFIXES_KEY } });
    const stored = asPrefixList(row?.value);
    return { prefixes: stored && stored.length > 0 ? stored : [...DEFAULT_ENTRY_PREFIXES] };
  }

  async updateEntryPrefixes(
    prefixes: string[],
    actor: SettingsActor,
  ): Promise<{ prefixes: string[] }> {
    if (prefixes.length === 0 || !prefixes.every((p) => /^\d{2}$/.test(p))) {
      throw new BadRequestException(
        'prefixes must be a non-empty list of 2-digit codes (e.g. "62")',
      );
    }
    // The route guard already required UPDATE COMPANY, but that passes for
    // company-scoped holders too — prefixes are group-wide, so only a
    // GROUP-scoped UPDATE COMPANY grant (SUPER_ADMIN) may change them.
    const grants = await this.permissions.getEffectiveGrants(actor.userId);
    const groupWide = grants.some(
      (g) => g.action === 'UPDATE' && g.resource === 'COMPANY' && g.scopeType === 'GROUP',
    );
    if (!groupWide) {
      throw new ForbiddenException('Insufficient permissions');
    }

    const row = await this.prisma.appSetting.findUnique({ where: { key: ENTRY_PREFIXES_KEY } });
    const stored = asPrefixList(row?.value);
    const previous = stored && stored.length > 0 ? stored : [...DEFAULT_ENTRY_PREFIXES];

    await this.prisma.appSetting.upsert({
      where: { key: ENTRY_PREFIXES_KEY },
      update: { value: prefixes, updatedBy: actor.userId },
      create: { key: ENTRY_PREFIXES_KEY, value: prefixes, updatedBy: actor.userId },
    });
    this.prefixes = [...prefixes];

    await this.audit.write({
      userId: actor.userId,
      action: 'UPDATE',
      resource: 'COMPANY',
      resourceId: null,
      oldValues: { prefixes: previous },
      newValues: { prefixes: [...prefixes] },
      event: 'PREFIXES_CHANGED',
      ipAddress: actor.ip,
      userAgent: actor.userAgent,
    });

    return { prefixes: [...prefixes] };
  }
}
