import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { PermissionsService } from '../permissions.service';

describe('PermissionsService', () => {
  const prisma = { userRole: { findMany: jest.fn() } };
  const redis = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
  const svc = new PermissionsService(
    prisma as unknown as PrismaService,
    redis as unknown as RedisService,
  );

  const dbRows = [
    {
      scopeType: 'COMPANY',
      scopeId: 'c1',
      role: {
        permissions: [
          { permission: { action: 'VIEW', resource: 'ENTRY' } },
          { permission: { action: 'CREATE', resource: 'ENTRY' } },
        ],
      },
    },
  ];

  beforeEach(() => jest.clearAllMocks());

  it('cache miss queries DB, caches flattened grants for 300s', async () => {
    redis.get.mockResolvedValue(null);
    prisma.userRole.findMany.mockResolvedValue(dbRows);
    const grants = await svc.getEffectiveGrants('u1');
    expect(grants).toEqual([
      { action: 'VIEW', resource: 'ENTRY', scopeType: 'COMPANY', scopeId: 'c1' },
      { action: 'CREATE', resource: 'ENTRY', scopeType: 'COMPANY', scopeId: 'c1' },
    ]);
    expect(prisma.userRole.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1' } }),
    );
    expect(redis.set).toHaveBeenCalledWith('user:grants:u1', JSON.stringify(grants), 300);
  });

  it('cache hit returns grants without a DB query', async () => {
    const cached = [{ action: 'VIEW', resource: 'ENTRY', scopeType: 'GROUP', scopeId: '' }];
    redis.get.mockResolvedValue(JSON.stringify(cached));
    await expect(svc.getEffectiveGrants('u9')).resolves.toEqual(cached);
    expect(prisma.userRole.findMany).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('invalidateUser deletes the cache key', async () => {
    await svc.invalidateUser('u1');
    expect(redis.del).toHaveBeenCalledWith('user:grants:u1');
  });
});
