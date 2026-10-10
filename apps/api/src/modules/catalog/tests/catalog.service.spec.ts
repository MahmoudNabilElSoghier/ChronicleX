import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PermissionsService } from '../../rbac/permissions.service';
import { ScopeMatcher } from '../../rbac/scope-matcher';
import { CatalogService } from '../catalog.service';

const COMPANY_C1 = [{ action: 'VIEW', resource: 'COMPANY', scopeType: 'COMPANY', scopeId: 'c1' }];
const PROJECT_P1 = [{ action: 'VIEW', resource: 'PROJECT', scopeType: 'PROJECT', scopeId: 'p1' }];
const GROUP_ALL = [
  { action: 'VIEW', resource: 'COMPANY', scopeType: 'GROUP', scopeId: '' },
  { action: 'VIEW', resource: 'PROJECT', scopeType: 'GROUP', scopeId: '' },
  { action: 'VIEW', resource: 'ENTRY', scopeType: 'GROUP', scopeId: '' },
];
const SUPER_UPDATE = [
  { action: 'UPDATE', resource: 'COMPANY', scopeType: 'GROUP', scopeId: '' },
];
const COMPANY_ADMIN_C1 = [
  { action: 'UPDATE', resource: 'COMPANY', scopeType: 'COMPANY', scopeId: 'c1' },
];

function p2002(): Error {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('CatalogService', () => {
  const prisma = {
    company: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
    project: { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    entry: { groupBy: jest.fn(), count: jest.fn() },
  };
  const permissions = { getEffectiveGrants: jest.fn() };
  const scopes = new ScopeMatcher(permissions as unknown as PermissionsService);
  const svc = new CatalogService(
    prisma as unknown as PrismaService,
    permissions as unknown as PermissionsService,
    scopes,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.company.findUnique.mockResolvedValue(null);
    prisma.project.findUnique.mockResolvedValue(null);
  });

  it('COMPANY_ADMIN sees only their company', async () => {
    permissions.getEffectiveGrants.mockResolvedValue(COMPANY_C1);
    prisma.company.findMany.mockResolvedValue([{ id: 'c1' }]);
    await svc.companies('u1');
    expect(prisma.company.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['c1'] }, deletedAt: null },
      }),
    );
  });

  it('PROJECT_ADMIN p1 sees only parent company c1', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([
      { action: 'VIEW', resource: 'COMPANY', scopeType: 'PROJECT', scopeId: 'p1' },
    ]);
    prisma.project.findMany.mockResolvedValue([{ companyId: 'c1' }]);
    prisma.company.findMany.mockResolvedValue([{ id: 'c1' }]);
    await svc.companies('u2');
    expect(prisma.company.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['c1'] }, deletedAt: null },
      }),
    );
  });

  it('GROUP viewer sees all live companies (deletedAt filtered)', async () => {
    permissions.getEffectiveGrants.mockResolvedValue(GROUP_ALL);
    prisma.company.findMany.mockResolvedValue([]);
    await svc.companies('root');
    expect(prisma.company.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null } }),
    );
  });

  it('PROJECT_ADMIN sees own project rows only (deletedAt filtered)', async () => {
    permissions.getEffectiveGrants.mockResolvedValue(PROJECT_P1);
    prisma.project.findMany.mockResolvedValue([{ id: 'p1' }]);
    await svc.projects('u2', undefined);
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ deletedAt: null }, { OR: [{ id: { in: ['p1'] } }] }] },
      }),
    );
  });

  it('PROJECT_ADMIN p1 asking for company c1 sees p1 only (deletedAt filtered)', async () => {
    permissions.getEffectiveGrants.mockResolvedValue(PROJECT_P1);
    prisma.project.count.mockResolvedValue(1);
    prisma.project.findMany.mockResolvedValue([{ id: 'p1' }]);
    await svc.projects('u2', 'c1');
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 'c1', deletedAt: null, id: { in: ['p1'] } },
      }),
    );
  });

  it('no VIEW grant → 403 without touching the DB', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([]);
    await expect(svc.companies('u9')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.company.findMany).not.toHaveBeenCalled();
  });

  // --- Company mutations -----------------------------------------------------

  it('createCompany (SUPER_ADMIN) persists and returns the row', async () => {
    permissions.getEffectiveGrants.mockResolvedValue(SUPER_UPDATE);
    prisma.company.create.mockResolvedValue({ id: 'c9', code: 9900, nameAr: 'Ar', nameEn: 'En' });
    const res = await svc.createCompany('u1', { code: 9900, nameAr: 'Ar', nameEn: 'En' });
    expect(res).toEqual({ id: 'c9', code: 9900, nameAr: 'Ar', nameEn: 'En' });
    expect(prisma.company.create).toHaveBeenCalledWith({
      data: { code: 9900, nameAr: 'Ar', nameEn: 'En' },
      select: { id: true, code: true, nameAr: true, nameEn: true },
    });
  });

  it('createCompany duplicate code → 409 (P2002)', async () => {
    permissions.getEffectiveGrants.mockResolvedValue(SUPER_UPDATE);
    prisma.company.create.mockRejectedValue(p2002());
    await expect(
      svc.createCompany('u1', { code: 2000, nameAr: 'Ar', nameEn: 'En' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('createCompany by COMPANY-scoped holder →403, nothing persisted', async () => {
    permissions.getEffectiveGrants.mockResolvedValue(COMPANY_ADMIN_C1);
    await expect(
      svc.createCompany('u2', { code: 9900, nameAr: 'Ar', nameEn: 'En' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.company.create).not.toHaveBeenCalled();
  });

  it('updateCompany renames only and never touches code', async () => {
    permissions.getEffectiveGrants.mockResolvedValue(SUPER_UPDATE);
    prisma.company.findUnique.mockResolvedValue({ id: 'c1' });
    prisma.company.update.mockResolvedValue({ id: 'c1', code: 2000, nameAr: 'New', nameEn: 'NewEn' });
    await svc.updateCompany('u1', 'c1', { nameAr: 'New', nameEn: 'NewEn' });
    expect(prisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1' },
        data: { nameAr: 'New', nameEn: 'NewEn' },
      }),
    );
    expect(prisma.company.update.mock.calls[0][0].data).not.toHaveProperty('code');
  });

  it('updateCompany unknown id →404', async () => {
    permissions.getEffectiveGrants.mockResolvedValue(SUPER_UPDATE);
    await expect(svc.updateCompany('u1', 'nope', { nameAr: 'X' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('deleteCompany with zero active projects soft-deletes', async () => {
    permissions.getEffectiveGrants.mockResolvedValue(SUPER_UPDATE);
    prisma.company.findUnique.mockResolvedValue({ id: 'c1' });
    prisma.project.count.mockResolvedValue(0);
    prisma.company.update.mockResolvedValue({ id: 'c1' });
    await svc.deleteCompany('u1', 'c1');
    expect(prisma.project.count).toHaveBeenCalledWith({
      where: { companyId: 'c1', deletedAt: null },
    });
    expect(prisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1' },
        data: { deletedAt: expect.any(Date) },
      }),
    );
  });

  it('deleteCompany with active projects →400 with the count', async () => {
    permissions.getEffectiveGrants.mockResolvedValue(SUPER_UPDATE);
    prisma.company.findUnique.mockResolvedValue({ id: 'c1' });
    prisma.project.count.mockResolvedValue(2);
    await expect(svc.deleteCompany('u1', 'c1')).rejects.toThrow(
      'لا يمكن حذف الشركة — تحتوي على 2 مشروع نشط',
    );
    expect(prisma.company.update).not.toHaveBeenCalled();
  });

  it('deleteCompany by COMPANY-scoped holder →403', async () => {
    permissions.getEffectiveGrants.mockResolvedValue(COMPANY_ADMIN_C1);
    prisma.company.findUnique.mockResolvedValue({ id: 'c1' });
    await expect(svc.deleteCompany('u2', 'c1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.company.update).not.toHaveBeenCalled();
  });

  // --- Project mutations -----------------------------------------------------

  it('SUPER_ADMIN creates a project in any company', async () => {
    permissions.getEffectiveGrants.mockResolvedValue(SUPER_UPDATE);
    prisma.company.findUnique.mockResolvedValue({ id: 'c1' });
    prisma.project.create.mockResolvedValue({ id: 'p9', code: 'NEW', companyId: 'c1' });
    const res = await svc.createProject('u1', {
      code: 'NEW',
      nameAr: 'Ar',
      nameEn: 'En',
      companyId: 'c1',
    });
    expect(res).toEqual({ id: 'p9', code: 'NEW', companyId: 'c1' });
  });

  it('COMPANY_ADMIN creates a project inside their own company → OK', async () => {
    permissions.getEffectiveGrants.mockResolvedValue(COMPANY_ADMIN_C1);
    prisma.company.findUnique.mockResolvedValue({ id: 'c1' });
    prisma.project.create.mockResolvedValue({ id: 'p9', code: 'NEW', companyId: 'c1' });
    await svc.createProject('u2', {
      code: 'NEW',
      nameAr: 'Ar',
      nameEn: 'En',
      companyId: 'c1',
    });
    expect(prisma.project.create).toHaveBeenCalled();
  });

  it('COMPANY_ADMIN creates a project in ANOTHER company →403', async () => {
    permissions.getEffectiveGrants.mockResolvedValue(COMPANY_ADMIN_C1);
    await expect(
      svc.createProject('u2', { code: 'NEW', nameAr: 'Ar', nameEn: 'En', companyId: 'c2' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.project.create).not.toHaveBeenCalled();
  });

  it('createProject duplicate code in company →409', async () => {
    permissions.getEffectiveGrants.mockResolvedValue(SUPER_UPDATE);
    prisma.company.findUnique.mockResolvedValue({ id: 'c1' });
    prisma.project.create.mockRejectedValue(p2002());
    await expect(
      svc.createProject('u1', { code: 'SSC', nameAr: 'Ar', nameEn: 'En', companyId: 'c1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('createProject under a deleted/unknown company →404', async () => {
    permissions.getEffectiveGrants.mockResolvedValue(SUPER_UPDATE);
    prisma.company.findUnique.mockResolvedValue(null);
    await expect(
      svc.createProject('u1', { code: 'NEW', nameAr: 'Ar', nameEn: 'En', companyId: 'gone' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updateProject renames only; scope enforced on the parent company', async () => {
    permissions.getEffectiveGrants.mockResolvedValue(COMPANY_ADMIN_C1);
    prisma.project.findUnique.mockResolvedValue({ id: 'p1', companyId: 'c1' });
    prisma.project.update.mockResolvedValue({ id: 'p1' });
    await svc.updateProject('u2', 'p1', { nameAr: 'New' });
    expect(prisma.project.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { nameAr: 'New' } }),
    );
    expect(prisma.project.update.mock.calls[0][0].data).not.toHaveProperty('code');
  });

  it('updateProject outside the scope →403', async () => {
    permissions.getEffectiveGrants.mockResolvedValue(COMPANY_ADMIN_C1);
    prisma.project.findUnique.mockResolvedValue({ id: 'p1', companyId: 'c2' });
    await expect(svc.updateProject('u2', 'p1', { nameAr: 'X' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it('deleteProject with zero entries soft-deletes', async () => {
    permissions.getEffectiveGrants.mockResolvedValue(SUPER_UPDATE);
    prisma.project.findUnique.mockResolvedValue({ id: 'p1', companyId: 'c1' });
    prisma.entry.count.mockResolvedValue(0);
    prisma.project.update.mockResolvedValue({ id: 'p1' });
    await svc.deleteProject('u1', 'p1');
    // Count is unfiltered on purpose: soft-deleted entries still block.
    expect(prisma.entry.count).toHaveBeenCalledWith({ where: { projectId: 'p1' } });
    expect(prisma.project.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { deletedAt: expect.any(Date) } }),
    );
  });

  it('deleteProject with entries →400 with the count', async () => {
    permissions.getEffectiveGrants.mockResolvedValue(SUPER_UPDATE);
    prisma.project.findUnique.mockResolvedValue({ id: 'p1', companyId: 'c1' });
    prisma.entry.count.mockResolvedValue(5);
    await expect(svc.deleteProject('u1', 'p1')).rejects.toThrow(
      'لا يمكن حذف المشروع — يحتوي على 5 قيد مسجل',
    );
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it('deleteProject outside the scope →403', async () => {
    permissions.getEffectiveGrants.mockResolvedValue(COMPANY_ADMIN_C1);
    prisma.project.findUnique.mockResolvedValue({ id: 'p1', companyId: 'c2' });
    await expect(svc.deleteProject('u2', 'p1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.project.update).not.toHaveBeenCalled();
  });
});
