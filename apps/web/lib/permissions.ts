import type { CurrentUser } from '@chroniclex/shared';

const DELETE_ROLES = new Set(['SUPER_ADMIN', 'COMPANY_ADMIN', 'PROJECT_ADMIN']);
const RESTORE_ROLES = new Set(['SUPER_ADMIN', 'COMPANY_ADMIN', 'PROJECT_ADMIN']);
const USERS_ROLES = new Set(['SUPER_ADMIN', 'COMPANY_ADMIN']);
const AUDIT_ROLES = new Set(['SUPER_ADMIN']);

/**
 * UI-only gating. The backend AuthGuard + PermissionsGuard enforce for real;
 * these helpers merely hide actions the server would reject with 403.
 */
export function userRoleNames(user: CurrentUser | null): Set<string> {
  return new Set((user?.roles ?? []).map((r) => r.name));
}

export function canDeleteEntries(user: CurrentUser | null): boolean {
  for (const name of userRoleNames(user)) {
    if (DELETE_ROLES.has(name)) return true;
  }
  return false;
}

export function canRestoreEntries(user: CurrentUser | null): boolean {
  for (const name of userRoleNames(user)) {
    if (RESTORE_ROLES.has(name)) return true;
  }
  return false;
}

export function canSeeUsers(user: CurrentUser | null): boolean {
  for (const name of userRoleNames(user)) {
    if (USERS_ROLES.has(name)) return true;
  }
  return false;
}

export function canSeeAudit(user: CurrentUser | null): boolean {
  for (const name of userRoleNames(user)) {
    if (AUDIT_ROLES.has(name)) return true;
  }
  return false;
}
