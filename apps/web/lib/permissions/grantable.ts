import type { ScopeType } from '@chroniclex/shared';

export interface CallerGrant {
  name: string;
  scopeType: ScopeType;
  scopeId: string;
}

export interface GrantTarget {
  roleName: string;
  scopeType: ScopeType;
  scopeId: string;
}

export interface GrantContext {
  /** projectId → parent companyId, for PROJECT-scope checks. */
  companyOfProject: Record<string, string>;
}

function isSuperAdminAtGroup(callerRoles: CallerGrant[]): boolean {
  return callerRoles.some((r) => r.name === 'SUPER_ADMIN' && r.scopeType === 'GROUP');
}

/**
 * Client mirror of UsersService.canGrant (backend is authoritative).
 * Cosmetic only: hides options the server would reject with 403.
 *
 * Self-grant guard: never offer your own user a GROUP SUPER_ADMIN grant
 * in the picker. (Granting it to others is allowed — the backend lockout
 * guard still protects the final grant at revoke time.)
 */
export function canGrantRole(
  caller: { id: string; roles: CallerGrant[] },
  targetUserId: string | null,
  grant: GrantTarget,
  ctx: GrantContext,
): boolean {
  if (
    targetUserId !== null &&
    caller.id === targetUserId &&
    grant.roleName === 'SUPER_ADMIN' &&
    grant.scopeType === 'GROUP'
  ) {
    return false;
  }
  const callerRoles = caller.roles;
  if (grant.scopeType === 'GROUP') {
    return isSuperAdminAtGroup(callerRoles);
  }
  if (grant.scopeType === 'COMPANY') {
    return (
      isSuperAdminAtGroup(callerRoles) ||
      callerRoles.some(
        (r) => r.name === 'COMPANY_ADMIN' && r.scopeType === 'COMPANY' && r.scopeId === grant.scopeId,
      )
    );
  }
  const parentCompany = ctx.companyOfProject[grant.scopeId];
  return (
    isSuperAdminAtGroup(callerRoles) ||
    callerRoles.some(
      (r) =>
        (r.name === 'COMPANY_ADMIN' &&
          r.scopeType === 'COMPANY' &&
          parentCompany !== undefined &&
          r.scopeId === parentCompany) ||
        (r.name === 'PROJECT_ADMIN' && r.scopeType === 'PROJECT' && r.scopeId === grant.scopeId),
    )
  );
}
