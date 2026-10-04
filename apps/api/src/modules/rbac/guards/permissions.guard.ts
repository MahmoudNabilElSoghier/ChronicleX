import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  REQUIRED_PERMISSION,
  RequiredPermission,
} from '../../auth/decorators/require-permission.decorator';
import { IS_PUBLIC } from '../../auth/decorators/public.decorator';
import type { AuthenticatedUser } from '../../auth/types';
import { PermissionsService } from '../permissions.service';
import { ScopeResolver } from '../scope-resolver.service';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
    private readonly scopes: ScopeResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      throw new InternalServerErrorException(
        '@RequirePermission cannot be used on a @Public route',
      );
    }
    const required = this.reflector.getAllAndOverride<RequiredPermission>(REQUIRED_PERMISSION, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const req = context.switchToHttp().getRequest() as Request & { user?: AuthenticatedUser };
    if (!req.user) {
      throw new InternalServerErrorException(
        'PermissionsGuard ran without AuthGuard — configuration error',
      );
    }

    const grants = await this.permissions.getEffectiveGrants(req.user.id);
    const targetChain = await this.scopes.resolve(required.resource, required.scopeHint, req);

    // TODO(perf): if grants array grows >100, switch to a Set keyed by
    // `${action}:${resource}:${scopeType}:${scopeId}`
    for (const grant of grants) {
      if (grant.action !== required.action) continue;
      if (grant.resource !== required.resource) continue;
      if (grant.scopeType === 'GROUP') return true;
      for (const scope of targetChain) {
        if (grant.scopeType === scope.scopeType && grant.scopeId === scope.scopeId) return true;
      }
    }
    throw new ForbiddenException('Insufficient permissions');
  }
}
