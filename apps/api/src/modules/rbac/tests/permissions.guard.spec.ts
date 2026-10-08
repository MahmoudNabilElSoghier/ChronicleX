import {
  ExecutionContext,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC } from '../../auth/decorators/public.decorator';
import {
  REQUIRED_PERMISSION,
} from '../../auth/decorators/require-permission.decorator';
import { PermissionsGuard } from '../guards/permissions.guard';
import { PermissionsService } from '../permissions.service';
import { ScopeResolver } from '../scope-resolver.service';
import type { Grant, ScopeChain } from '../types';

function ctxWith(req: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
  } as unknown as ExecutionContext;
}

const chain = (projectId: string, companyId: string): ScopeChain => [
  { scopeType: 'PROJECT', scopeId: projectId },
  { scopeType: 'COMPANY', scopeId: companyId },
  { scopeType: 'GROUP', scopeId: '' },
];

const grant = (
  action: Grant['action'],
  resource: Grant['resource'],
  scopeType: Grant['scopeType'],
  scopeId: string,
): Grant => ({ action, resource, scopeType, scopeId });

describe('PermissionsGuard', () => {
  const reflector = { getAllAndOverride: jest.fn() };
  const permissions = { getEffectiveGrants: jest.fn() };
  const scopes = { resolve: jest.fn() };
  const guard = new PermissionsGuard(
    reflector as unknown as Reflector,
    permissions as unknown as PermissionsService,
    scopes as unknown as ScopeResolver,
  );

  const required = { action: 'VIEW' as const, resource: 'ENTRY' as const, scopeHint: undefined };
  let isPublic = false;
  let requiredOverride: unknown = Symbol('use-default');

  beforeEach(() => {
    jest.clearAllMocks();
    isPublic = false;
    requiredOverride = Symbol('use-default');
    reflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === IS_PUBLIC) return isPublic;
      if (key === REQUIRED_PERMISSION) {
        return typeof requiredOverride === 'symbol' ? required : requiredOverride;
      }
      return undefined;
    });
  });

  const setRequired = (value: unknown): void => {
    requiredOverride = value;
  };

  const reqFor = (user: Record<string, unknown> | undefined): Record<string, unknown> => ({ user });

  it('SUPER_ADMIN (GROUP) allows everything', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([grant('DELETE', 'USER', 'GROUP', '')]);
    scopes.resolve.mockResolvedValue(chain('p9', 'c9'));
    setRequired({ action: 'DELETE', resource: 'USER' });
    await expect(guard.canActivate(ctxWith(reqFor({ id: 'root' })))).resolves.toBe(true);
  });

  it('COMPANY_ADMIN c1 allows VIEW ENTRY in own company chain', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([grant('VIEW', 'ENTRY', 'COMPANY', 'c1')]);
    scopes.resolve.mockResolvedValue(chain('p1', 'c1'));
    setRequired({ action: 'VIEW', resource: 'ENTRY', scopeHint: { source: 'params', key: 'id' } });
    await expect(guard.canActivate(ctxWith(reqFor({ id: 'u1' })))).resolves.toBe(true);
  });

  it('COMPANY_ADMIN c1 denies VIEW ENTRY in foreign company chain', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([grant('VIEW', 'ENTRY', 'COMPANY', 'c1')]);
    scopes.resolve.mockResolvedValue(chain('p2', 'c2'));
    setRequired({ action: 'VIEW', resource: 'ENTRY', scopeHint: { source: 'params', key: 'id' } });
    await expect(guard.canActivate(ctxWith(reqFor({ id: 'u1' })))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('PROJECT_ADMIN p1 allows CREATE ENTRY on p1', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([grant('CREATE', 'ENTRY', 'PROJECT', 'p1')]);
    scopes.resolve.mockResolvedValue(chain('p1', 'c1'));
    setRequired({ action: 'CREATE', resource: 'ENTRY', scopeHint: { source: 'params', key: 'id' } });
    await expect(guard.canActivate(ctxWith(reqFor({ id: 'u2' })))).resolves.toBe(true);
  });

  it('PROJECT_ADMIN p1 denies CREATE ENTRY on p2', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([grant('CREATE', 'ENTRY', 'PROJECT', 'p1')]);
    scopes.resolve.mockResolvedValue(chain('p2', 'c2'));
    setRequired({ action: 'CREATE', resource: 'ENTRY', scopeHint: { source: 'params', key: 'id' } });
    await expect(guard.canActivate(ctxWith(reqFor({ id: 'u2' })))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('ARCHIVIST denies DELETE ENTRY', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([
      grant('CREATE', 'ENTRY', 'PROJECT', 'p1'),
      grant('UPDATE', 'ENTRY', 'PROJECT', 'p1'),
      grant('VIEW', 'ENTRY', 'PROJECT', 'p1'),
    ]);
    scopes.resolve.mockResolvedValue(chain('p1', 'c1'));
    setRequired({ action: 'DELETE', resource: 'ENTRY' });
    await expect(guard.canActivate(ctxWith(reqFor({ id: 'u3' })))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('VIEWER denies CREATE ENTRY', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([grant('VIEW', 'ENTRY', 'PROJECT', 'p1')]);
    scopes.resolve.mockResolvedValue(chain('p1', 'c1'));
    setRequired({ action: 'CREATE', resource: 'ENTRY', scopeHint: { source: 'params', key: 'id' } });
    await expect(guard.canActivate(ctxWith(reqFor({ id: 'u4' })))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('missing @RequirePermission allows', async () => {
    setRequired(undefined);
    await expect(guard.canActivate(ctxWith(reqFor({ id: 'u1' })))).resolves.toBe(true);
    expect(permissions.getEffectiveGrants).not.toHaveBeenCalled();
  });

  it('req.user undefined throws InternalServerErrorException', async () => {
    await expect(guard.canActivate(ctxWith(reqFor(undefined)))).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it('throws 500 when @Public and @RequirePermission are both present', async () => {
    isPublic = true;
    await expect(guard.canActivate(ctxWith(reqFor({ id: 'u1' })))).rejects.toThrow(
      '@RequirePermission cannot be used on a @Public route',
    );
    expect(permissions.getEffectiveGrants).not.toHaveBeenCalled();
  });

  it('PROJECT_ADMIN p1, no scopeHint → allow (row filtering is the handler job)', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([grant('VIEW', 'ENTRY', 'PROJECT', 'p1')]);
    setRequired({ action: 'VIEW', resource: 'ENTRY' });
    await expect(guard.canActivate(ctxWith(reqFor({ id: 'u2' })))).resolves.toBe(true);
    expect(scopes.resolve).not.toHaveBeenCalled();
  });

  it('PROJECT_ADMIN p1, hint on own entry → allow', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([grant('VIEW', 'ENTRY', 'PROJECT', 'p1')]);
    scopes.resolve.mockResolvedValue(chain('p1', 'c1'));
    setRequired({ action: 'VIEW', resource: 'ENTRY', scopeHint: { source: 'params', key: 'id' } });
    await expect(guard.canActivate(ctxWith(reqFor({ id: 'u2' })))).resolves.toBe(true);
  });

  it('PROJECT_ADMIN p1, hint on foreign entry → deny', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([grant('VIEW', 'ENTRY', 'PROJECT', 'p1')]);
    scopes.resolve.mockResolvedValue(chain('p2', 'c2'));
    setRequired({ action: 'VIEW', resource: 'ENTRY', scopeHint: { source: 'params', key: 'id' } });
    await expect(guard.canActivate(ctxWith(reqFor({ id: 'u2' })))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('VIEWER with no grants, no hint → deny', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([]);
    setRequired({ action: 'VIEW', resource: 'ENTRY' });
    await expect(guard.canActivate(ctxWith(reqFor({ id: 'u4' })))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('user without EXPORT ENTRY → 403 (POST /entries/export)', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([grant('VIEW', 'ENTRY', 'PROJECT', 'p1')]);
    setRequired({ action: 'EXPORT', resource: 'ENTRY' });
    await expect(guard.canActivate(ctxWith(reqFor({ id: 'u4' })))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(scopes.resolve).not.toHaveBeenCalled();
  });

  it('ARCHIVIST with EXPORT ENTRY, no scopeHint → allow (row filtering is the handler job)', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([grant('EXPORT', 'ENTRY', 'PROJECT', 'p1')]);
    setRequired({ action: 'EXPORT', resource: 'ENTRY' });
    await expect(guard.canActivate(ctxWith(reqFor({ id: 'u3' })))).resolves.toBe(true);
    expect(scopes.resolve).not.toHaveBeenCalled();
  });

  it('ARCHIVIST with VIEW ENTRY (no EXPORT) → allow POST /entries/bundle-download', async () => {
    // The bundle route is @RequirePermission('VIEW', 'ENTRY') with no
    // scopeHint: it downloads files the caller can already see, so a
    // VIEW-only ARCHIVIST may use it without the EXPORT permission.
    permissions.getEffectiveGrants.mockResolvedValue([
      grant('CREATE', 'ENTRY', 'PROJECT', 'p1'),
      grant('UPDATE', 'ENTRY', 'PROJECT', 'p1'),
      grant('VIEW', 'ENTRY', 'PROJECT', 'p1'),
    ]);
    setRequired({ action: 'VIEW', resource: 'ENTRY' });
    await expect(guard.canActivate(ctxWith(reqFor({ id: 'u3' })))).resolves.toBe(true);
    expect(scopes.resolve).not.toHaveBeenCalled();
  });
});
