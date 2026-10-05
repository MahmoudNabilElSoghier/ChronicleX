import { PrismaService } from '../../../prisma/prisma.service';
import { PermissionsService } from '../../rbac/permissions.service';
import { ScopeMatcher } from '../../rbac/scope-matcher';
import { DashboardService } from '../dashboard.service';

describe('DashboardService scoping', () => {
  const prisma = {
    company: { count: jest.fn().mockResolvedValue(0) },
    project: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn() },
    entry: {
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const permissions = { getEffectiveGrants: jest.fn() };
  const scopes = new ScopeMatcher(permissions as unknown as PermissionsService);
  const svc = new DashboardService(
    prisma as unknown as PrismaService,
    permissions as unknown as PermissionsService,
    scopes,
  );

  beforeEach(() => jest.clearAllMocks());

  it('PROJECT_ADMIN p1 counts p1 entries only, never the whole company', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([
      { action: 'VIEW', resource: 'ENTRY', scopeType: 'PROJECT', scopeId: 'p1' },
    ]);
    const res = (await svc.summary('u1')) as {
      entries: { total: number };
    };
    expect(res.entries.total).toBe(0);
    expect(prisma.entry.count).toHaveBeenCalledWith({
      where: { AND: [{ OR: [{ projectId: { in: ['p1'] } }] }, { deletedAt: null }] },
    });
    // No company-wide leakage: companies counts only direct grants (none here).
    expect(prisma.company.count).toHaveBeenCalledWith({ where: { id: { in: [] } } });
    // No parent-company lookup query at all.
    expect(prisma.project.findMany).not.toHaveBeenCalled();
  });

  it('COMPANY_ADMIN c1 counts all c1 entries', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([
      { action: 'VIEW', resource: 'ENTRY', scopeType: 'COMPANY', scopeId: 'c1' },
    ]);
    prisma.entry.count.mockResolvedValue(42);
    const res = (await svc.summary('u2')) as {
      entries: { total: number };
    };
    expect(res.entries.total).toBe(42);
    expect(prisma.entry.count).toHaveBeenCalledWith({
      where: { AND: [{ OR: [{ companyId: { in: ['c1'] } }] }, { deletedAt: null }] },
    });
    expect(prisma.company.count).toHaveBeenCalledWith({ where: { id: { in: ['c1'] } } });
  });
});
