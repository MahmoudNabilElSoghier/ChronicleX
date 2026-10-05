import { PrismaService } from '../../../prisma/prisma.service';
import { PermissionsService } from '../../rbac/permissions.service';
import { AuditService, redact } from '../audit.service';

describe('AuditService', () => {
  const prisma = { auditLog: { create: jest.fn() }, project: { findMany: jest.fn() } };
  const permissions = { getEffectiveGrants: jest.fn() };
  const svc = new AuditService(
    prisma as unknown as PrismaService,
    permissions as unknown as PermissionsService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.auditLog.create.mockResolvedValue({});
  });

  it('write creates a row with the correct fields', async () => {
    await svc.write({
      userId: 'u1',
      action: 'CREATE',
      resource: 'ENTRY',
      resourceId: 'e1',
      oldValues: null,
      newValues: { serial: '6200000000' },
      ipAddress: '1.2.3.4',
      userAgent: 'ua',
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        action: 'CREATE',
        resource: 'ENTRY',
        resourceId: 'e1',
        newValues: { serial: '6200000000' },
        ipAddress: '1.2.3.4',
        userAgent: 'ua',
      },
    });
  });

  it('redacts secrets including nested objects', () => {
    expect(
      redact({
        email: 'a@b.c',
        password: 'x',
        nested: { refreshToken: 'y', keep: 1 },
        arr: [{ cookie: 'z' }],
      }),
    ).toEqual({
      email: 'a@b.c',
      password: '[REDACTED]',
      nested: { refreshToken: '[REDACTED]', keep: 1 },
      arr: [{ cookie: '[REDACTED]' }],
    });
    expect(redact({ PASSWORDHASH: 'h' })).toEqual({ PASSWORDHASH: '[REDACTED]' });
  });

  it('write with null userId works', async () => {
    await svc.write({
      userId: null,
      action: 'CREATE',
      resource: 'AUTH',
      resourceId: null,
      oldValues: null,
      newValues: { event: 'LOGIN_FAILED' },
      ipAddress: null,
      userAgent: null,
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: null }) }),
    );
  });

  it('write swallows Prisma errors and logs to stderr', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    prisma.auditLog.create.mockRejectedValue(new Error('db down'));
    await expect(
      svc.write({
        userId: 'u1',
        action: 'CREATE',
        resource: 'ENTRY',
        resourceId: 'e1',
        oldValues: null,
        newValues: null,
        ipAddress: null,
        userAgent: null,
      }),
    ).resolves.toBeUndefined();
    expect(err).toHaveBeenCalledWith('[AuditService] write failed:', 'db down');
    err.mockRestore();
  });

  it('write does not throw on undefined userAgent', async () => {
    await expect(
      svc.write({
        userId: 'u1',
        action: 'VIEW',
        resource: 'ENTRY',
        resourceId: 'e1',
        oldValues: null,
        newValues: null,
        ipAddress: null,
        userAgent: undefined as unknown as null,
      }),
    ).resolves.toBeUndefined();
  });

  describe('buildScopeWhere', () => {
    const companyGrant = { action: 'VIEW', resource: 'AUDIT', scopeType: 'COMPANY', scopeId: 'c1' };

    it('PROJECT-scoped actor is visible to their COMPANY_ADMIN', async () => {
      permissions.getEffectiveGrants.mockResolvedValue([companyGrant]);
      prisma.project.findMany.mockResolvedValue([{ id: 'p1' }]);
      const where = (await svc.buildScopeWhere('admin-c1')) as {
        OR: Array<{ user?: { roles: { some: { OR: unknown[] } } } }>;
      };
      const actorOr = where.OR[0]?.user?.roles.some.OR as Array<Record<string, unknown>>;
      expect(actorOr).toContainEqual({ scopeType: 'COMPANY', scopeId: { in: ['c1'] } });
      expect(actorOr).toContainEqual({ scopeType: 'PROJECT', scopeId: { in: ['p1'] } });
    });

    it('ENTRY resource rows are not matched yet (deferred to Phase 8)', async () => {
      permissions.getEffectiveGrants.mockResolvedValue([companyGrant]);
      prisma.project.findMany.mockResolvedValue([{ id: 'p1' }]);
      const where = (await svc.buildScopeWhere('admin-c1')) as {
        OR: Array<{ OR?: Array<Record<string, unknown>> }>;
      };
      const resourceOr = where.OR[1]?.OR as Array<Record<string, unknown>>;
      // Only COMPANY/PROJECT resources are covered; ENTRY resourceId matching
      // needs the denormalized scope column (Phase 8 TODO in the service).
      expect(resourceOr.some((clause) => 'ENTRY' in clause || clause.resource === 'ENTRY')).toBe(false);
      expect(resourceOr).toContainEqual({ resource: 'COMPANY', resourceId: { in: ['c1'] } });
      expect(resourceOr).toContainEqual({ resource: 'PROJECT', resourceId: { in: ['p1'] } });
    });

    it('COMPANY_ADMIN c2 scope is disjoint from c1', async () => {
      permissions.getEffectiveGrants.mockResolvedValue([
        { action: 'VIEW', resource: 'AUDIT', scopeType: 'COMPANY', scopeId: 'c2' },
      ]);
      prisma.project.findMany.mockResolvedValue([{ id: 'p9' }]);
      const where = (await svc.buildScopeWhere('admin-c2')) as {
        OR: Array<{ user?: { roles: { some: { OR: unknown[] } } } }>;
      };
      const actorOr = where.OR[0]?.user?.roles.some.OR as Array<Record<string, unknown>>;
      expect(actorOr).toContainEqual({ scopeType: 'COMPANY', scopeId: { in: ['c2'] } });
      expect(JSON.stringify(where)).not.toContain('"c1"');
    });

    it('null-userId rows match nothing in the actor clause', async () => {
      // Failed logins / system events have no user relation, so the
      // user.roles.some branch can never match them. Only GROUP callers
      // (empty scope {}) see them.
      permissions.getEffectiveGrants.mockResolvedValue([companyGrant]);
      prisma.project.findMany.mockResolvedValue([]);
      const where = await svc.buildScopeWhere('admin-c1');
      expect(where).toHaveProperty('OR');
      const asRecord = where as { OR: unknown[] };
      expect(asRecord.OR).toHaveLength(2);
    });

    it('GROUP VIEW AUDIT sees everything (empty scope)', async () => {
      permissions.getEffectiveGrants.mockResolvedValue([
        { action: 'VIEW', resource: 'AUDIT', scopeType: 'GROUP', scopeId: '' },
      ]);
      await expect(svc.buildScopeWhere('root')).resolves.toEqual({});
      expect(prisma.project.findMany).not.toHaveBeenCalled();
    });
  });
});
