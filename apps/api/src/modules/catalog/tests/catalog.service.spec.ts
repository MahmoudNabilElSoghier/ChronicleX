import { ForbiddenException } from '@nestjs/common';
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

describe('CatalogService', () => {
  const prisma = {
    company: { findMany: jest.fn() },
    project: { findMany: jest.fn(), count: jest.fn() },
    entry: { groupBy: jest.fn() },
  };
  const permissions = { getEffectiveGrants: jest.fn() };
  const scopes = new ScopeMatcher(permissions as unknown as PermissionsService);
  const svc = new CatalogService(
    prisma as unknown as PrismaService,
    permissions as unknown as PermissionsService,
    scopes,
  );

  beforeEach(() => jest.clearAllMocks());

  it('COMPANY_ADMIN sees only their company', async () => {
    permissions.getEffectiveGrants.mockResolvedValue(COMPANY_C1);
    prisma.company.findMany.mockResolvedValue([{ id: 'c1' }]);
    await svc.companies('u1');
    expect(prisma.company.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['c1'] } } }),
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
      expect.objectContaining({ where: { id: { in: ['c1'] } } }),
    );
  });

  it('GROUP viewer sees all companies', async () => {    permissions.getEffectiveGrants.mockResolvedValue(GROUP_ALL);
    prisma.company.findMany.mockResolvedValue([]);
    await svc.companies('root');
    expect(prisma.company.findMany).toHaveBeenCalledWith(
      expect.not.objectContaining({ where: expect.anything() }),
    );
  });

  it('PROJECT_ADMIN sees own project rows only', async () => {
    permissions.getEffectiveGrants.mockResolvedValue(PROJECT_P1);
    prisma.project.findMany.mockResolvedValue([{ id: 'p1' }]);
    await svc.projects('u2', undefined);
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { OR: [{ id: { in: ['p1'] } }] } }),
    );
  });

  it('PROJECT_ADMIN p1 asking for company c1 sees p1 only', async () => {
    permissions.getEffectiveGrants.mockResolvedValue(PROJECT_P1);
    prisma.project.count.mockResolvedValue(1);
    prisma.project.findMany.mockResolvedValue([{ id: 'p1' }]);
    await svc.projects('u2', 'c1');
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'c1', id: { in: ['p1'] } } }),
    );
  });

  it('no VIEW grant → 403 without touching the DB', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([]);
    await expect(svc.companies('u9')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.company.findMany).not.toHaveBeenCalled();
  });
});
