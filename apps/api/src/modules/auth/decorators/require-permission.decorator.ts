import { SetMetadata } from '@nestjs/common';
import type { Action, Resource } from '../../../generated/prisma/client';
import type { ScopeHint } from '../../rbac/types';

export const REQUIRED_PERMISSION = 'requiredPermission';

export interface RequiredPermission {
  action: Action;
  resource: Resource;
  scopeHint?: ScopeHint;
}

/**
 * Require (action, resource) on the resolved scope chain.
 * Omit scopeHint for resource-less checks (AUDIT, AUTH).
 */
export const RequirePermission = (
  action: Action,
  resource: Resource,
  scopeHint?: ScopeHint,
): MethodDecorator & ClassDecorator => {
  const metadata: RequiredPermission = { action, resource };
  if (scopeHint) metadata.scopeHint = scopeHint;
  return SetMetadata(REQUIRED_PERMISSION, metadata);
};
