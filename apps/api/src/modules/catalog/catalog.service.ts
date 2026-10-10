import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { PermissionsService } from '../rbac/permissions.service';
import { ScopeMatcher } from '../rbac/scope-matcher';
import type { CreateCompanyDto, CreateProjectDto, UpdateCompanyDto, UpdateProjectDto } from './dto/catalog.dto';

const COMPANY_SELECT = { id: true, code: true, nameAr: true, nameEn: true } as const;
const PROJECT_SELECT = {
  id: true,
  code: true,
  nameAr: true,
  nameEn: true,
  companyId: true,
} as const;

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
        where: { deletedAt: null },
        select: COMPANY_SELECT,
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
      where: { id: { in: ids }, deletedAt: null },
      select: COMPANY_SELECT,
      orderBy: { code: 'asc' },
    });
  }

  async projects(userId: string, companyId: string | undefined): Promise<Record<string, unknown>[]> {
    const grants = await this.permissions.getEffectiveGrants(userId);
    const view = grants.filter((g) => g.action === 'VIEW' && g.resource === 'PROJECT');
    if (view.length === 0) {
      throw new ForbiddenException('Insufficient permissions');
    }
    if (view.some((g) => g.scopeType === 'GROUP')) {
      return this.prisma.project.findMany({
        where: { ...(companyId ? { companyId } : {}), deletedAt: null },
        select: PROJECT_SELECT,
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
      const where: { companyId: string; deletedAt: null; id?: { in: string[] } } = {
        companyId,
        deletedAt: null,
      };
      if (projectIds.length > 0 && !companyIds.includes(companyId)) {
        where.id = { in: projectIds };
      }
      return this.prisma.project.findMany({ where, select: PROJECT_SELECT, orderBy: { code: 'asc' } });
    }
    const or: Array<Record<string, unknown>> = [];
    if (projectIds.length > 0) or.push({ id: { in: projectIds } });
    if (companyIds.length > 0) or.push({ companyId: { in: companyIds } });
    if (or.length === 0) return [];
    return this.prisma.project.findMany({
      where: { AND: [{ deletedAt: null }, { OR: or }] } as never,
      select: PROJECT_SELECT,
      orderBy: { code: 'asc' },
    });
  }

  // --- Mutations -------------------------------------------------------------
  // All six routes sit behind @RequirePermission('UPDATE', 'COMPANY'), which
  // passes for company-scoped holders too. These helpers add the finer rule:
  // company rows are group-wide (SUPER_ADMIN only); project rows may also be
  // managed by a COMPANY-scoped UPDATE COMPANY grant on the parent company.

  /** Company rows are group-wide: only a GROUP-scoped UPDATE COMPANY passes. */
  private async requireGroupWideUpdate(userId: string): Promise<void> {
    const grants = await this.permissions.getEffectiveGrants(userId);
    const groupWide = grants.some(
      (g) => g.action === 'UPDATE' && g.resource === 'COMPANY' && g.scopeType === 'GROUP',
    );
    if (!groupWide) {
      throw new ForbiddenException('Insufficient permissions');
    }
  }

  private async requireCompanyScopeUpdate(userId: string, companyId: string): Promise<void> {
    const grants = await this.permissions.getEffectiveGrants(userId);
    const matching = grants.filter((g) => g.action === 'UPDATE' && g.resource === 'COMPANY');
    if (matching.length === 0) {
      throw new ForbiddenException('Insufficient permissions');
    }
    if (matching.some((g) => g.scopeType === 'GROUP')) return;
    if (matching.some((g) => g.scopeType === 'COMPANY' && g.scopeId === companyId)) return;
    throw new ForbiddenException('Insufficient permissions');
  }

  private static isDuplicateCode(err: unknown): boolean {
    return (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    );
  }

  async createCompany(userId: string, dto: CreateCompanyDto): Promise<Record<string, unknown>> {
    await this.requireGroupWideUpdate(userId);
    try {
      return await this.prisma.company.create({
        data: { code: dto.code, nameAr: dto.nameAr, nameEn: dto.nameEn },
        select: COMPANY_SELECT,
      });
    } catch (err) {
      if (CatalogService.isDuplicateCode(err)) {
        throw new ConflictException('Company code already exists');
      }
      throw err;
    }
  }

  async updateCompany(
    userId: string,
    id: string,
    dto: UpdateCompanyDto,
  ): Promise<Record<string, unknown>> {
    await this.requireGroupWideUpdate(userId);
    const existing = await this.prisma.company.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Company not found');
    return this.prisma.company.update({
      where: { id },
      data: {
        ...(dto.nameAr !== undefined ? { nameAr: dto.nameAr } : {}),
        ...(dto.nameEn !== undefined ? { nameEn: dto.nameEn } : {}),
      },
      select: COMPANY_SELECT,
    });
  }

  /** Soft delete. Refused while any active (non-deleted) project remains. */
  async deleteCompany(userId: string, id: string): Promise<Record<string, unknown>> {
    await this.requireGroupWideUpdate(userId);
    const existing = await this.prisma.company.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Company not found');
    const activeProjects = await this.prisma.project.count({
      where: { companyId: id, deletedAt: null },
    });
    if (activeProjects > 0) {
      throw new BadRequestException(
        `لا يمكن حذف الشركة — تحتوي على ${activeProjects} مشروع نشط`,
      );
    }
    return this.prisma.company.update({
      where: { id },
      data: { deletedAt: new Date() },
      select: COMPANY_SELECT,
    });
  }

  async createProject(
    userId: string,
    dto: CreateProjectDto,
  ): Promise<Record<string, unknown>> {
    await this.requireCompanyScopeUpdate(userId, dto.companyId);
    const company = await this.prisma.company.findUnique({
      where: { id: dto.companyId },
      select: { id: true },
    });
    if (!company) throw new NotFoundException('Company not found');
    try {
      return await this.prisma.project.create({
        data: {
          code: dto.code,
          nameAr: dto.nameAr,
          nameEn: dto.nameEn,
          companyId: dto.companyId,
        },
        select: PROJECT_SELECT,
      });
    } catch (err) {
      if (CatalogService.isDuplicateCode(err)) {
        throw new ConflictException('Project code already exists in this company');
      }
      throw err;
    }
  }

  async updateProject(
    userId: string,
    id: string,
    dto: UpdateProjectDto,
  ): Promise<Record<string, unknown>> {
    const existing = await this.prisma.project.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Project not found');
    await this.requireCompanyScopeUpdate(userId, existing.companyId);
    return this.prisma.project.update({
      where: { id },
      data: {
        ...(dto.nameAr !== undefined ? { nameAr: dto.nameAr } : {}),
        ...(dto.nameEn !== undefined ? { nameEn: dto.nameEn } : {}),
      },
      select: PROJECT_SELECT,
    });
  }

  /**
   * Soft delete. Refused while ANY entry references the project — including
   * soft-deleted entries: the serial/year registry must stay intact.
   */
  async deleteProject(userId: string, id: string): Promise<Record<string, unknown>> {
    const existing = await this.prisma.project.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Project not found');
    await this.requireCompanyScopeUpdate(userId, existing.companyId);
    const entries = await this.prisma.entry.count({ where: { projectId: id } });
    if (entries > 0) {
      throw new BadRequestException(
        `لا يمكن حذف المشروع — يحتوي على ${entries} قيد مسجل`,
      );
    }
    return this.prisma.project.update({
      where: { id },
      data: { deletedAt: new Date() },
      select: PROJECT_SELECT,
    });
  }
}
