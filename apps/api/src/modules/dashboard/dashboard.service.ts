import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsService } from '../rbac/permissions.service';
import { ScopeMatcher } from '../rbac/scope-matcher';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly scopes: ScopeMatcher,
  ) {}

  async summary(userId: string): Promise<Record<string, unknown>> {
    const grants = await this.permissions.getEffectiveGrants(userId);
    const view = grants.filter((g) => g.action === 'VIEW' && g.resource === 'ENTRY');

    // Entries use the exact same scope filter as the list endpoint.
    // No parent-company expansion: a PROJECT-scoped caller must not see
    // COMPANY-wide counts the list page would hide (information leak).
    const entryWhere: Prisma.EntryWhereInput = {
      AND: [await this.scopes.buildEntryWhere(userId), { deletedAt: null }],
    };

    // Company/project cards count only directly granted scopes.
    const directProjects = view.filter((g) => g.scopeType === 'PROJECT').map((g) => g.scopeId);
    const directCompanies = view.filter((g) => g.scopeType === 'COMPANY').map((g) => g.scopeId);
    const companyWhere: Prisma.CompanyWhereInput = view.some((g) => g.scopeType === 'GROUP')
      ? {}
      : { id: { in: directCompanies } };
    const projectWhere: Prisma.ProjectWhereInput = view.some((g) => g.scopeType === 'GROUP')
      ? {}
      : {
          OR: [
            { id: { in: directProjects } },
            ...(directCompanies.length ? [{ companyId: { in: directCompanies } }] : []),
          ],
        };

    const [companies, projects, total, byYear, byTypePrefix, recentUploads] = await Promise.all([
      this.prisma.company.count({ where: companyWhere }),
      this.prisma.project.count({ where: projectWhere }),
      this.prisma.entry.count({ where: entryWhere }),
      this.prisma.entry.groupBy({
        by: ['year'],
        where: entryWhere,
        _count: { year: true },
        orderBy: { year: 'desc' },
        take: 5,
      }),
      this.prisma.entry.groupBy({
        by: ['typePrefix'],
        where: entryWhere,
        _count: { typePrefix: true },
        orderBy: { typePrefix: 'asc' },
      }),
      this.prisma.entry.findMany({
        where: entryWhere,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 10,
        select: {
          id: true,
          serial: true,
          fileName: true,
          createdAt: true,
          company: { select: { nameAr: true } },
          project: { select: { nameAr: true } },
          uploader: { select: { nameAr: true } },
        },
      }),
    ]);

    return {
      companies,
      projects,
      entries: {
        total,
        byYear: byYear.map((r) => ({ year: r.year, count: r._count.year })),
        byTypePrefix: byTypePrefix.map((r) => ({ prefix: r.typePrefix, count: r._count.typePrefix })),
      },
      recentUploads,
    };
  }
}
