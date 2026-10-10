import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CatalogService } from '../../catalog/catalog.service';
import { PermissionsService } from '../../rbac/permissions.service';
import { ScopeMatcher } from '../../rbac/scope-matcher';
import { AdminService } from '../admin.service';

describe('AdminService.structure', () => {
  const prisma = {
    project: { findMany: jest.fn() },
    entry: { groupBy: jest.fn() },
  };
  const catalog = { companies: jest.fn() };
  const permissions = { getEffectiveGrants: jest.fn() };
  const scopes = new ScopeMatcher(permissions as unknown as PermissionsService);

  const svc = new AdminService(
    prisma as unknown as PrismaService,
    catalog as unknown as CatalogService,
    scopes,
  );

  const C1 = { id: 'c1', code: 2000, nameAr: 'شركة 1', nameEn: 'Co 1' };
  const C2 = { id: 'c2', code: 9205, nameAr: 'شركة 2', nameEn: 'Co 2' };
  const PROJECTS = [
    { id: 'p1', companyId: 'c1', code: 'REHAB', nameAr: 'الرحاب', nameEn: 'Rehab' },
    { id: 'p2', companyId: 'c1', code: 'MAD', nameAr: 'مدينتي', nameEn: 'Madinaty' },
    { id: 'p3', companyId: 'c2', code: 'SSC', nameAr: 'سان ستيفانو', nameEn: 'San Stefano' },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    catalog.companies.mockResolvedValue([C1, C2]);
    prisma.project.findMany.mockResolvedValue(PROJECTS);
    prisma.entry.groupBy.mockResolvedValue([
      { projectId: 'p1', _count: { _all: 3 }, _max: { createdAt: new Date('2025-01-02T00:00:00Z') } },
      { projectId: 'p3', _count: { _all: 2 }, _max: { createdAt: new Date('2025-02-01T00:00:00Z') } },
    ]);
    permissions.getEffectiveGrants.mockResolvedValue([
      { action: 'VIEW', resource: 'COMPANY', scopeType: 'GROUP', scopeId: '' },
      { action: 'VIEW', resource: 'ENTRY', scopeType: 'GROUP', scopeId: '' },
    ]);
  });

  it('builds companies → projects with counts and lastUploadAt', async () => {
    const res = await svc.structure('u1');
    expect(res.companies).toHaveLength(2);
    const c1 = res.companies[0]!;
    expect(c1).toMatchObject({
      id: 'c1',
      code: 2000,
      entryCount: 3,
      lastUploadAt: '2025-01-02T00:00:00.000Z',
    });
    expect(c1.projects).toHaveLength(2);
    expect(c1.projects[0]).toMatchObject({
      id: 'p1',
      code: 'REHAB',
      entryCount: 3,
      lastUploadAt: '2025-01-02T00:00:00.000Z',
    });
    expect(c1.projects[1]).toMatchObject({ id: 'p2', entryCount: 0, lastUploadAt: null });
    expect(res.companies[1]).toMatchObject({
      id: 'c2',
      entryCount: 2,
      lastUploadAt: '2025-02-01T00:00:00.000Z',
    });
    expect(res.companies[1]!.projects).toHaveLength(1);
  });

  it('counts exclude soft-deleted entries and run as one grouped query', async () => {
    await svc.structure('u1');
    expect(prisma.entry.groupBy).toHaveBeenCalledTimes(1);
    const where = prisma.entry.groupBy.mock.calls[0]![0].where as {
      AND: Record<string, unknown>[];
    };
    expect(where.AND).toEqual(
      expect.arrayContaining([
        { deletedAt: null },
        { projectId: { in: ['p1', 'p2', 'p3'] } },
      ]),
    );
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { code: 'asc' },
        where: expect.objectContaining({ deletedAt: null }),
      }),
    );
  });

  it('PROJECT_ADMIN sees only own-project counts in the aggregates', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([
      { action: 'VIEW', resource: 'COMPANY', scopeType: 'PROJECT', scopeId: 'p1' },
      { action: 'VIEW', resource: 'ENTRY', scopeType: 'PROJECT', scopeId: 'p1' },
    ]);
    prisma.entry.groupBy.mockResolvedValue([
      { projectId: 'p1', _count: { _all: 7 }, _max: { createdAt: new Date('2025-03-01T00:00:00Z') } },
    ]);
    const res = await svc.structure('u2');
    const where = prisma.entry.groupBy.mock.calls[0]![0].where as { AND: unknown[] };
    expect(where.AND).toEqual(
      expect.arrayContaining([{ OR: [{ projectId: { in: ['p1'] } }] }]),
    );
    // p2 gets 0 (not visible), so c1 aggregates only p1's 7.
    expect(res.companies[0]).toMatchObject({ entryCount: 7 });
    expect(res.companies[0]!.projects[1]).toMatchObject({ id: 'p2', entryCount: 0 });
    expect(res.companies[1]).toMatchObject({ entryCount: 0, lastUploadAt: null });
  });

  it('empty scope returns an empty tree without touching projects/entries', async () => {
    catalog.companies.mockResolvedValue([]);
    const res = await svc.structure('u3');
    expect(res).toEqual({ companies: [] });
    expect(prisma.project.findMany).not.toHaveBeenCalled();
    expect(prisma.entry.groupBy).not.toHaveBeenCalled();
  });

  it('propagates the 403 from companies() when VIEW COMPANY is missing', async () => {
    catalog.companies.mockRejectedValue(new ForbiddenException('Insufficient permissions'));
    await expect(structureRejects()).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.project.findMany).not.toHaveBeenCalled();

    async function structureRejects(): Promise<unknown> {
      return svc.structure('u4');
    }
  });
});
