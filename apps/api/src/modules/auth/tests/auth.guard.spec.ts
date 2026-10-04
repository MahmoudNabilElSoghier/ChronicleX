import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '../guards/auth.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { TokenService } from '../token.service';

function ctxWith(req: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
  } as unknown as ExecutionContext;
}

describe('AuthGuard', () => {
  const reflector = { getAllAndOverride: jest.fn() };
  const tokens = { verify: jest.fn() };
  const prisma = { user: { findUnique: jest.fn() } };
  const guard = new AuthGuard(
    reflector as unknown as Reflector,
    tokens as unknown as TokenService,
    prisma as unknown as PrismaService,
  );

  const activeUser = {
    id: 'u1',
    email: 'a@b.c',
    nameAr: 'ن',
    nameEn: 'N',
    isActive: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    reflector.getAllAndOverride.mockReturnValue(undefined);
  });

  it('@Public route allows without a token', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    await expect(guard.canActivate(ctxWith({ headers: {} }))).resolves.toBe(true);
    expect(tokens.verify).not.toHaveBeenCalled();
  });

  it('valid token + active user allows and populates req.user', async () => {
    tokens.verify.mockReturnValue({ sub: 'u1' });
    prisma.user.findUnique.mockResolvedValue(activeUser);
    const req: Record<string, unknown> = { headers: { authorization: 'Bearer good.jwt' } };
    await expect(guard.canActivate(ctxWith(req))).resolves.toBe(true);
    expect(req.user).toEqual({
      id: 'u1',
      email: 'a@b.c',
      nameAr: 'ن',
      nameEn: 'N',
      isActive: true,
    });
  });

  it('valid token + inactive user → 401', async () => {
    tokens.verify.mockReturnValue({ sub: 'u1' });
    prisma.user.findUnique.mockResolvedValue({ ...activeUser, isActive: false });
    await expect(
      guard.canActivate(ctxWith({ headers: { authorization: 'Bearer good.jwt' } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('expired token (verify throws) → 401', async () => {
    tokens.verify.mockImplementation(() => {
      throw new Error('jwt expired');
    });
    await expect(
      guard.canActivate(ctxWith({ headers: { authorization: 'Bearer old.jwt' } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('missing Authorization header → 401', async () => {
    await expect(guard.canActivate(ctxWith({ headers: {} }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(tokens.verify).not.toHaveBeenCalled();
  });
});
