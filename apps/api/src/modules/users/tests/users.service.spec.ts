import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { PermissionsService } from '../../rbac/permissions.service';
import { UsersService } from '../users.service';

const ACTOR = { userId: 'admin1', ip: '1.2.3.4', userAgent: 'ua' };
const SUPER_GRANTS = [{ action: 'UPDATE', resource: 'USER', scopeType: 'GROUP', scopeId: '' }];
const COMPANY_GRANTS_C1 = [
  { action: 'VIEW', resource: 'USER', scopeType: 'COMPANY', scopeId: 'c1' },
  { action: 'UPDATE', resource: 'USER', scopeType: 'COMPANY', scopeId: 'c1' },
];

describe('UsersService', () => {
  const prisma = {
    user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    userRole: { findMany: jest.fn(), findFirst: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
    role: { findUnique: jest.fn(), findMany: jest.fn() },
    project: { findUnique: jest.fn() },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const permissions = { getEffectiveGrants: jest.fn(), invalidateUser: jest.fn() };
  const redis = { deleteByPattern: jest.fn() };

  const svc = new UsersService(
    prisma as unknown as PrismaService,
    permissions as unknown as PermissionsService,
    redis as unknown as RedisService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    permissions.getEffectiveGrants.mockResolvedValue(SUPER_GRANTS);
  });

  it('create hashes the password and never stores plaintext', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockImplementation((args: { data: Record<string, unknown> }) => {
      const { passwordHash: _dropped, ...rest } = args.data;
      void _dropped;
      return Promise.resolve({ id: 'u9', createdAt: new Date(), ...rest });
    });
    const res = (await svc.create(
      {
        email: 'n@x.y', nameAr: 'ن', nameEn: 'N', password: 'Secret123',
        initialRoles: [{ roleId: 'r1', scopeType: 'COMPANY', scopeId: 'c1' }],
      },
      ACTOR,
    )) as Record<string, unknown>;
    const hash = prisma.user.create.mock.calls[0][0].data.passwordHash as string;
    expect(hash).not.toContain('Secret123');
    expect(await argon2.verify(hash, 'Secret123')).toBe(true);
    expect(res).not.toHaveProperty('passwordHash');
  });

  it('create with initial roles writes UserRole rows without pre-populating cache', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'u9' });
    prisma.userRole.upsert.mockResolvedValue({});
    await svc.create(
      {
        email: 'n@x.y', nameAr: 'ن', nameEn: 'N', password: 'Secret123',
        initialRoles: [{ roleId: 'r1', scopeType: 'COMPANY', scopeId: 'c1' }],
      },
      ACTOR,
    );
    expect(prisma.userRole.upsert).toHaveBeenCalledTimes(1);
    expect(permissions.invalidateUser).not.toHaveBeenCalled();
  });

  it('create with an ungrantable role → 403', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    permissions.getEffectiveGrants.mockResolvedValue([]);
    await expect(
      svc.create(
        {
          email: 'n@x.y', nameAr: 'ن', nameEn: 'N', password: 'Secret123',
          initialRoles: [{ roleId: 'r1', scopeType: 'COMPANY', scopeId: 'c9' }],
        },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('create with duplicate email → 409', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'taken' });
    await expect(
      svc.create(
        {
          email: 't@x.y', nameAr: 'ن', nameEn: 'N', password: 'Secret123',
          initialRoles: [{ roleId: 'r1', scopeType: 'COMPANY', scopeId: 'c1' }],
        },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('create without initial roles → 400', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      svc.create(
        { email: 'n@x.y', nameAr: 'ن', nameEn: 'N', password: 'Secret123', initialRoles: [] },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('update name touches no caches', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u2' });
    prisma.user.update.mockResolvedValue({ id: 'u2', nameAr: 'جديد' });
    await svc.update('u2', { nameAr: 'جديد' });
    expect(redis.deleteByPattern).not.toHaveBeenCalled();
    expect(permissions.invalidateUser).not.toHaveBeenCalled();
  });

  it('deactivate purges sessions and grants cache', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u2' });
    prisma.user.update.mockResolvedValue({ id: 'u2', isActive: false });
    await svc.update('u2', { isActive: false });
    expect(redis.deleteByPattern).toHaveBeenCalledWith('refresh:u2:*');
    expect(permissions.invalidateUser).toHaveBeenCalledWith('u2');
  });

  it('change password with correct current rotates hash and sessions', async () => {
    const oldHash = await argon2.hash('OldPassword1');
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', isActive: true, passwordHash: oldHash });
    prisma.user.update.mockResolvedValue({});
    await svc.changePassword('u1', { currentPassword: 'OldPassword1', newPassword: 'NewPassword22' }, ACTOR);
    const newHash = prisma.user.update.mock.calls[0][0].data.passwordHash as string;
    expect(await argon2.verify(newHash, 'NewPassword22')).toBe(true);
    expect(redis.deleteByPattern).toHaveBeenCalledWith('refresh:u1:*');
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ newValues: expect.objectContaining({ event: 'PASSWORD_CHANGED' }) }),
      }),
    );
  });

  it('change password with wrong current → 401', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1', isActive: true, passwordHash: await argon2.hash('OldPassword1'),
    });
    await expect(
      svc.changePassword('u1', { currentPassword: 'Nope123456', newPassword: 'NewPassword22' }, ACTOR),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('SUPER_ADMIN grant succeeds and invalidates cache', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u2' });
    prisma.role.findUnique.mockResolvedValue({ id: 'r1', name: 'ARCHIVIST' });
    prisma.userRole.upsert.mockResolvedValue({});
    await svc.grantRole('u2', { roleId: 'r1', scopeType: 'COMPANY', scopeId: 'c1' }, ACTOR);
    expect(permissions.invalidateUser).toHaveBeenCalledWith('u2');
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ newValues: expect.objectContaining({ event: 'ROLE_GRANTED' }) }),
      }),
    );
  });

  it('COMPANY_ADMIN granting outside their company → 403', async () => {
    permissions.getEffectiveGrants.mockResolvedValue(COMPANY_GRANTS_C1);
    prisma.user.findUnique.mockResolvedValue({ id: 'u2' });
    prisma.role.findUnique.mockResolvedValue({ id: 'r1', name: 'ARCHIVIST' });
    await expect(
      svc.grantRole('u2', { roleId: 'r1', scopeType: 'COMPANY', scopeId: 'c9' }, ACTOR),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.userRole.upsert).not.toHaveBeenCalled();
  });

  it('self-revoke allowed while another active SUPER_ADMIN exists, blocked for the last', async () => {
    prisma.role.findUnique.mockResolvedValue({ id: 'rs', name: 'SUPER_ADMIN' });
    prisma.userRole.deleteMany.mockResolvedValue({ count: 1 });
    const twoAdmins = [
      { role: { name: 'SUPER_ADMIN' }, user: { id: 'admin1', isActive: true } },
      { role: { name: 'SUPER_ADMIN' }, user: { id: 'admin2', isActive: true } },
    ];
    // Admin #1 revokes self → 200 (admin2 remains).
    prisma.userRole.findFirst.mockResolvedValue({ userId: 'admin1' });
    prisma.userRole.findMany.mockResolvedValue(twoAdmins);
    await svc.revokeRole('admin1', 'rs', 'GROUP', '', ACTOR);
    expect(prisma.userRole.deleteMany).toHaveBeenCalledTimes(1);
    // Admin #2 revokes self → 400 (would remove the final grant).
    prisma.userRole.findMany.mockResolvedValue([
      { role: { name: 'SUPER_ADMIN' }, user: { id: 'admin2', isActive: true } },
    ]);
    await expect(
      svc.revokeRole('admin2', 'rs', 'GROUP', '', { ...ACTOR, userId: 'admin2' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('single SUPER_ADMIN self-revoke → 400', async () => {
    prisma.userRole.findFirst.mockResolvedValue({ userId: 'admin1' });
    prisma.role.findUnique.mockResolvedValue({ id: 'rs', name: 'SUPER_ADMIN' });
    prisma.userRole.findMany.mockResolvedValue([
      { role: { name: 'SUPER_ADMIN' }, user: { id: 'admin1', isActive: true } },
    ]);
    await expect(svc.revokeRole('admin1', 'rs', 'GROUP', '', ACTOR)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.userRole.deleteMany).not.toHaveBeenCalled();
  });

  it('normal revoke deletes the row and invalidates cache', async () => {
    prisma.userRole.findFirst.mockResolvedValue({ userId: 'u2' });
    prisma.role.findUnique.mockResolvedValue({ id: 'r1', name: 'ARCHIVIST' });
    prisma.userRole.deleteMany.mockResolvedValue({ count: 1 });
    await svc.revokeRole('u2', 'r1', 'COMPANY', 'c1', ACTOR);
    expect(prisma.userRole.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u2', roleId: 'r1', scopeType: 'COMPANY', scopeId: 'c1' },
    });
    expect(permissions.invalidateUser).toHaveBeenCalledWith('u2');
  });

  it('list filters COMPANY_ADMIN to their company', async () => {
    permissions.getEffectiveGrants.mockResolvedValue(COMPANY_GRANTS_C1);
    prisma.user.findMany.mockResolvedValue([]);
    await svc.list({ limit: 50 } as never, 'admin1');
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              roles: expect.objectContaining({
                some: expect.objectContaining({
                  OR: [{ scopeType: 'COMPANY', scopeId: 'c1' }],
                }),
              }),
            }),
          ]),
        }),
      }),
    );
  });

  it('listRoles returns roles ordered by name', async () => {
    prisma.role.findMany.mockResolvedValue([
      { id: 'r1', name: 'ARCHIVIST', description: null },
    ]);
    await expect(svc.listRoles()).resolves.toEqual([
      { id: 'r1', name: 'ARCHIVIST', description: null },
    ]);
    expect(prisma.role.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { name: 'asc' } }),
    );
  });

  it('findOne returns roles with roleId', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u2',
      email: 'u@x.y',
      roles: [{ role: { id: 'r1', name: 'ARCHIVIST' }, scopeType: 'COMPANY', scopeId: 'c1' }],
    });
    const res = (await svc.findOne('u2')) as {
      roles: { roleId: string; name: string; scopeType: string; scopeId: string }[];
    };
    expect(res.roles).toEqual([
      { roleId: 'r1', name: 'ARCHIVIST', scopeType: 'COMPANY', scopeId: 'c1' },
    ]);
  });
});
