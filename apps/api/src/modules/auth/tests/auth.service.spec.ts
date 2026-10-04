import { UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthService } from '../auth.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { TokenService } from '../token.service';

describe('AuthService', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const redis = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    deleteByPattern: jest.fn(),
  };
  const tokens = {
    signAccess: jest.fn().mockReturnValue('access.jwt'),
    signRefresh: jest.fn().mockReturnValue('refresh.jwt'),
    verify: jest.fn(),
    refreshTtlSeconds: 604800,
  };

  const svc = new AuthService(
    prisma as unknown as PrismaService,
    redis as unknown as RedisService,
    tokens as unknown as TokenService,
  );

  const activeHash = { current: '' };
  beforeAll(async () => {
    activeHash.current = await argon2.hash('Password123');
  });
  beforeEach(() => jest.clearAllMocks());

  const activeUser = () => ({
    id: 'u1',
    email: 'a@b.c',
    passwordHash: activeHash.current,
    nameAr: 'ن',
    nameEn: 'N',
    isActive: true,
  });

  it('login: valid creds returns accessToken + user, no refresh in body handling', async () => {
    prisma.user.findUnique.mockResolvedValue(activeUser());
    const res = await svc.login('a@b.c', 'Password123', '1.2.3.4', 'ua');
    expect(res.accessToken).toBe('access.jwt');
    expect(res.refreshToken).toBe('refresh.jwt');
    expect(res.user).toMatchObject({ id: 'u1', email: 'a@b.c' });
    expect(res).not.toHaveProperty('passwordHash');
    expect(redis.set).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ resource: 'AUTH' }) }),
    );
  });

  it('login: wrong password → 401 + audit, no tokens stored', async () => {
    prisma.user.findUnique.mockResolvedValue(activeUser());
    await expect(svc.login('a@b.c', 'WrongPass1', null, null)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(redis.set).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ newValues: { event: 'LOGIN_FAILED', email: 'a@b.c' } }),
      }),
    );
  });

  it('login: inactive user → 401', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...activeUser(), isActive: false });
    await expect(svc.login('a@b.c', 'Password123', null, null)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('login: unknown user → 401 with timing delay + audit (no password logged)', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const start = Date.now();
    await expect(svc.login('ghost@b.c', 'Password123', '9.9.9.9', 'ua')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(Date.now() - start).toBeGreaterThanOrEqual(150);
    const call = prisma.auditLog.create.mock.calls[0][0];
    expect(call.data.newValues).toEqual({ event: 'LOGIN_FAILED', email: 'ghost@b.c' });
    expect(JSON.stringify(call)).not.toContain('Password123');
  });

  it('refresh: valid session rotates JTIs and issues new tokens', async () => {
    tokens.verify.mockReturnValue({ sub: 'u1', jti: 'old' });
    redis.get.mockResolvedValue(JSON.stringify({ rotatedTo: null, userAgent: 'ua', ip: '1.1.1.1' }));
    prisma.user.findUnique.mockResolvedValue(activeUser());
    const res = await svc.refresh('old.jwt', '1.1.1.1', 'ua');
    expect(res.accessToken).toBe('access.jwt');
    expect(redis.set).toHaveBeenCalledTimes(2);
    expect(redis.set.mock.calls[0][2]).toBe(60);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ newValues: expect.objectContaining({ event: 'TOKEN_ROTATED' }) }),
      }),
    );
  });

  it('refresh: expired/unknown JTI → 401, does NOT delete other sessions', async () => {
    tokens.verify.mockReturnValue({ sub: 'u1', jti: 'expired' });
    redis.get.mockResolvedValue(null);
    await expect(svc.refresh('expired.jwt', null, null)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(redis.deleteByPattern).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          newValues: expect.objectContaining({ event: 'REFRESH_TOKEN_EXPIRED_OR_UNKNOWN' }),
        }),
      }),
    );
  });

  it('refresh: unverifiable signature → 401, no invalidation, no audit', async () => {
    tokens.verify.mockImplementationOnce(() => {
      throw new Error('invalid signature');
    });
    await expect(svc.refresh('forged.jwt', null, null)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(redis.deleteByPattern).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('refresh: reused (rotated) JTI → 401 + sessions invalidated', async () => {
    tokens.verify.mockReturnValue({ sub: 'u1', jti: 'old' });
    redis.get.mockResolvedValue(JSON.stringify({ rotatedTo: 'new', userAgent: 'ua', ip: null }));
    await expect(svc.refresh('old.jwt', null, null)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(redis.deleteByPattern).toHaveBeenCalledWith('refresh:u1:*');
  });

  it('logout: valid token deletes the Redis session key', async () => {
    tokens.verify.mockReturnValue({ sub: 'u1', jti: 'j1' });
    await svc.logout('rt.jwt', '2.2.2.2', 'ua');
    expect(redis.del).toHaveBeenCalledWith('refresh:u1:j1');
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ newValues: expect.objectContaining({ event: 'LOGOUT' }) }),
      }),
    );
  });

  it('me: valid token returns user + roles/scopes', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...activeUser(),
      roles: [{ role: { name: 'COMPANY_ADMIN' }, scopeType: 'COMPANY', scopeId: 'c1' }],
    });
    const me = await svc.me('u1');
    expect(me.roles).toEqual([{ name: 'COMPANY_ADMIN', scopeType: 'COMPANY', scopeId: 'c1' }]);
    expect(me).not.toHaveProperty('passwordHash');
  });
});
