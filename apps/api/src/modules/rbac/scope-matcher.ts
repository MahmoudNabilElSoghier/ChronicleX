import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Action, Prisma, Resource } from '../../generated/prisma/client';
import { PermissionsService } from './permissions.service';
import type { ScopeChain } from './types';

export interface ScopeTarget {
  projectId?: string;
  companyId?: string;
}

/**
 * Single home for "does this user have (action, resource) on this target?"
 * and for Entry read-scoping. Services call this AFTER request parsing —
 * guards cannot see multipart bodies (see modules/auth/README.md).
 */
@Injectable()
export class ScopeMatcher {
  constructor(private readonly permissions: PermissionsService) {}

  private chainOf(target: ScopeTarget): ScopeChain {
    const chain: ScopeChain = [];
    if (target.projectId) chain.push({ scopeType: 'PROJECT', scopeId: target.projectId });
    if (target.companyId) chain.push({ scopeType: 'COMPANY', scopeId: target.companyId });
    chain.push({ scopeType: 'GROUP', scopeId: '' });
    return chain;
  }

  async canAccess(
    userId: string,
    action: Action,
    resource: Resource,
    target: ScopeTarget,
  ): Promise<boolean> {
    const grants = await this.permissions.getEffectiveGrants(userId);
    const chain = this.chainOf(target);
    return grants.some(
      (g) =>
        g.action === action &&
        g.resource === resource &&
        (g.scopeType === 'GROUP' ||
          chain.some((s) => s.scopeType === g.scopeType && s.scopeId === g.scopeId)),
    );
  }

  /** Prisma WHERE fragment scoping Entry reads to the user's VIEW grants. */
  async buildEntryWhere(userId: string): Promise<Prisma.EntryWhereInput> {
    const grants = await this.permissions.getEffectiveGrants(userId);
    const view = grants.filter((g) => g.action === 'VIEW' && g.resource === 'ENTRY');
    if (view.length === 0) {
      throw new ForbiddenException('Insufficient permissions');
    }
    if (view.some((g) => g.scopeType === 'GROUP')) {
      return {};
    }
    const projectIds = view.filter((g) => g.scopeType === 'PROJECT').map((g) => g.scopeId);
    const companyIds = view.filter((g) => g.scopeType === 'COMPANY').map((g) => g.scopeId);
    const or: Prisma.EntryWhereInput[] = [];
    if (projectIds.length > 0) or.push({ projectId: { in: projectIds } });
    if (companyIds.length > 0) or.push({ companyId: { in: companyIds } });
    if (or.length === 0) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return { OR: or };
  }
}
