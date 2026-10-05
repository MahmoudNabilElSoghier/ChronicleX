import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsService } from '../rbac/permissions.service';
import { ScopeMatcher } from '../rbac/scope-matcher';

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly scopes: ScopeMatcher,
  ) {}

  async companies(userId: string): Promise<Record<string, unknown>[]> {
    const grants = await this.permissions.getEffectiveGrants(userId);
    const view = grants.filter((g) => g.action === 'VIEW' && g.resource === 'COMPANY');
    if (view.length === 0) {
      throw new ForbiddenException('Insufficient permissions');
    }
    if (view.some((g) => g.scopeType === 'GROUP')) {
      return this.prisma.company.findMany({
        select: { id: true, code: true, nameAr: true, nameEn: true },
        orderBy: { code: 'asc' },
      });
    }
    // Names only (no entry data): PROJECT-scoped callers see their parent
    // company for filter context. Entry counts never expand this way.
    const companyIds = [...new Set(view.filter((g) => g.scopeType === 'COMPANY').map((g) => g.scopeId))];
    const projectIds = [...new Set(view.filter((g) => g.scopeType === 'PROJECT').map((g) => g.scopeId))];
    const parents = projectIds.length
      ? await this.prisma.project.findMany({
          where: { id: { in: projectIds } },
          select: { companyId: true },
        })
      : [];
    const ids = [...new Set([...companyIds, ...parents.map((p) => p.companyId)])];
    if (ids.length === 0) return [];
    return this.prisma.company.findMany({
      where: { id: { in: ids } },
      select: { id: true, code: true, nameAr: true, nameEn: true },
      orderBy: { code: 'asc' },
    });
  }

  async projects(userId: string, companyId: string | undefined): Promise<Record<string, unknown>[]> {
    const grants = await this.permissions.getEffectiveGrants(userId);
    const view = grants.filter((g) => g.action === 'VIEW' && g.resource === 'PROJECT');
    if (view.length === 0) {
      throw new ForbiddenException('Insufficient permissions');
    }
    const select = { id: true, code: true, nameAr: true, nameEn: true, companyId: true };
    if (view.some((g) => g.scopeType === 'GROUP')) {
      return this.prisma.project.findMany({
        where: companyId ? { companyId } : {},
        select,
        orderBy: { code: 'asc' },
      });
    }
    const projectIds = [...new Set(view.filter((g) => g.scopeType === 'PROJECT').map((g) => g.scopeId))];
    const companyIds = [...new Set(view.filter((g) => g.scopeType === 'COMPANY').map((g) => g.scopeId))];
    if (companyId) {
      // Least privilege: PROJECT-only callers see just their own rows here.
      const ownInCompany =
        projectIds.length > 0
          ? await this.prisma.project.count({ where: { companyId, id: { in: projectIds } } })
          : 0;
      if (!companyIds.includes(companyId) && ownInCompany === 0) return [];
      const where: { companyId: string; id?: { in: string[] } } = { companyId };
      if (projectIds.length > 0 && !companyIds.includes(companyId)) {
        where.id = { in: projectIds };
      }
      return this.prisma.project.findMany({ where, select, orderBy: { code: 'asc' } });
    }
    const or: Array<Record<string, unknown>> = [];
    if (projectIds.length > 0) or.push({ id: { in: projectIds } });
    if (companyIds.length > 0) or.push({ companyId: { in: companyIds } });
    if (or.length === 0) return [];
    return this.prisma.project.findMany({
      where: { OR: or } as never,
      select,
      orderBy: { code: 'asc' },
    });
  }
}
