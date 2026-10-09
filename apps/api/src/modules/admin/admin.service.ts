import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CatalogService } from '../catalog/catalog.service';
import { ScopeMatcher } from '../rbac/scope-matcher';

export interface StructureProject {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  entryCount: number;
  lastUploadAt: string | null;
}

export interface StructureCompany {
  id: string;
  code: number;
  nameAr: string;
  nameEn: string;
  entryCount: number;
  lastUploadAt: string | null;
  projects: StructureProject[];
}

/** Shape CatalogService.companies() selects (Record<string, unknown> in its signature). */
type CompanyRow = { id: string; code: number; nameAr: string; nameEn: string };

type ProjectAgg = { entryCount: number; lastUploadAt: Date | null };

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly scopes: ScopeMatcher,
  ) {}

  /**
   * Companies → projects tree with entry counts + last upload, scoped to
   * what the caller's VIEW COMPANY grants allow (CatalogService.companies)
   * and to their entry-level scope (buildEntryWhere). Counts exclude
   * soft-deleted entries — same rule as the dashboard cards. One groupBy
   * over projects feeds every aggregate.
   */
  async structure(userId: string): Promise<{ companies: StructureCompany[] }> {
    const companies = (await this.catalog.companies(userId)) as CompanyRow[];
    if (companies.length === 0) return { companies: [] };

    const projects = await this.prisma.project.findMany({
      where: { companyId: { in: companies.map((c) => c.id) } },
      select: { id: true, companyId: true, code: true, nameAr: true, nameEn: true },
      orderBy: { code: 'asc' },
    });

    const aggByProject = new Map<string, ProjectAgg>();
    if (projects.length > 0) {
      const grouped = await this.prisma.entry.groupBy({
        by: ['projectId'],
        where: {
          AND: [
            await this.scopes.buildEntryWhere(userId),
            { deletedAt: null },
            { projectId: { in: projects.map((p) => p.id) } },
          ],
        },
        _count: { _all: true },
        _max: { createdAt: true },
      });
      for (const g of grouped) {
        aggByProject.set(g.projectId, {
          entryCount: g._count._all,
          lastUploadAt: g._max.createdAt,
        });
      }
    }

    const projectRows: (StructureProject & { companyId: string })[] = projects.map((p) => {
      const agg = aggByProject.get(p.id);
      return {
        id: p.id,
        companyId: p.companyId,
        code: p.code,
        nameAr: p.nameAr,
        nameEn: p.nameEn,
        entryCount: agg?.entryCount ?? 0,
        lastUploadAt: agg?.lastUploadAt ? agg.lastUploadAt.toISOString() : null,
      };
    });

    return {
      companies: companies.map((c) => {
        const own = projectRows.filter((p) => p.companyId === c.id);
        const last = own.reduce<Date | null>(
          (max, p) =>
            p.lastUploadAt === null
              ? max
              : max === null || new Date(p.lastUploadAt) > max
                ? new Date(p.lastUploadAt)
                : max,
          null,
        );
        return {
          id: c.id,
          code: c.code,
          nameAr: c.nameAr,
          nameEn: c.nameEn,
          entryCount: own.reduce((sum, p) => sum + p.entryCount, 0),
          lastUploadAt: last ? last.toISOString() : null,
          projects: own.map(({ companyId: _companyId, ...project }) => project),
        };
      }),
    };
  }
}
