import { describe, expect, it } from 'vitest';
import type { ScopeType } from '@chroniclex/shared';
import { canGrantRole, type CallerGrant } from './grantable';

const SUPER: CallerGrant = { name: 'SUPER_ADMIN', scopeType: 'GROUP', scopeId: '' };
const COMPANY_C1: CallerGrant = { name: 'COMPANY_ADMIN', scopeType: 'COMPANY', scopeId: 'c1' };
const PROJECT_P1: CallerGrant = { name: 'PROJECT_ADMIN', scopeType: 'PROJECT', scopeId: 'p1' };
const ARCHIVIST: CallerGrant = { name: 'ARCHIVIST', scopeType: 'PROJECT', scopeId: 'p1' };
const VIEWER: CallerGrant = { name: 'VIEWER', scopeType: 'PROJECT', scopeId: 'p1' };

const ctx = { companyOfProject: { p1: 'c1', p2: 'c2' } as Record<string, string> };

function asCaller(roles: CallerGrant[]): { id: string; roles: CallerGrant[] } {
  return { id: 'caller', roles };
}

function grant(roleName: string, scopeType: ScopeType, scopeId: string): Parameters<typeof canGrantRole>[2] {
  return { roleName, scopeType, scopeId };
}

describe('canGrantRole', () => {
  it('GROUP scope: only GROUP SUPER_ADMIN', () => {
    expect(canGrantRole(asCaller([SUPER]), 'other', grant('X', 'GROUP', ''), ctx)).toBe(true);
    expect(canGrantRole(asCaller([COMPANY_C1]), 'other', grant('X', 'GROUP', ''), ctx)).toBe(false);
    expect(canGrantRole(asCaller([PROJECT_P1]), 'other', grant('X', 'GROUP', ''), ctx)).toBe(false);
    expect(canGrantRole(asCaller([ARCHIVIST]), 'other', grant('X', 'GROUP', ''), ctx)).toBe(false);
    expect(canGrantRole(asCaller([VIEWER]), 'other', grant('X', 'GROUP', ''), ctx)).toBe(false);
  });

  it('COMPANY scope: SUPER_ADMIN or that COMPANY_ADMIN', () => {
    expect(canGrantRole(asCaller([SUPER]), 'other', grant('X', 'COMPANY', 'c1'), ctx)).toBe(true);
    expect(canGrantRole(asCaller([COMPANY_C1]), 'other', grant('X', 'COMPANY', 'c1'), ctx)).toBe(true);
    expect(
      canGrantRole(
        asCaller([{ name: 'COMPANY_ADMIN', scopeType: 'COMPANY', scopeId: 'c9' }]),
        'other',
        grant('X', 'COMPANY', 'c1'),
        ctx,
      ),
    ).toBe(false);
    expect(canGrantRole(asCaller([PROJECT_P1]), 'other', grant('X', 'COMPANY', 'c1'), ctx)).toBe(false);
    expect(canGrantRole(asCaller([ARCHIVIST]), 'other', grant('X', 'COMPANY', 'c1'), ctx)).toBe(false);
    expect(canGrantRole(asCaller([VIEWER]), 'other', grant('X', 'COMPANY', 'c1'), ctx)).toBe(false);
  });

  it('PROJECT scope: SUPER_ADMIN, parent COMPANY_ADMIN, or own PROJECT_ADMIN', () => {
    expect(canGrantRole(asCaller([SUPER]), 'other', grant('X', 'PROJECT', 'p1'), ctx)).toBe(true);
    expect(canGrantRole(asCaller([COMPANY_C1]), 'other', grant('X', 'PROJECT', 'p1'), ctx)).toBe(true);
    expect(canGrantRole(asCaller([COMPANY_C1]), 'other', grant('X', 'PROJECT', 'p2'), ctx)).toBe(false);
    expect(canGrantRole(asCaller([PROJECT_P1]), 'other', grant('X', 'PROJECT', 'p1'), ctx)).toBe(true);
    expect(canGrantRole(asCaller([PROJECT_P1]), 'other', grant('X', 'PROJECT', 'p2'), ctx)).toBe(false);
    expect(canGrantRole(asCaller([ARCHIVIST]), 'other', grant('X', 'PROJECT', 'p1'), ctx)).toBe(false);
    expect(canGrantRole(asCaller([VIEWER]), 'other', grant('X', 'PROJECT', 'p1'), ctx)).toBe(false);
  });

  it('self-grant of SUPER_ADMIN at GROUP is hidden even for SUPER_ADMINs', () => {
    expect(
      canGrantRole({ id: 'me', roles: [SUPER] }, 'me', grant('SUPER_ADMIN', 'GROUP', ''), ctx),
    ).toBe(false);
    expect(
      canGrantRole({ id: 'me', roles: [SUPER] }, 'someone-else', grant('SUPER_ADMIN', 'GROUP', ''), ctx),
    ).toBe(true);
  });
});
