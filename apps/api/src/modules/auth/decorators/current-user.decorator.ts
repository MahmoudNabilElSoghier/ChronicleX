import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser } from '../types';

/** Returns req.user populated by the global AuthGuard. */
export const CurrentUser = createParamDecorator(
  (
    data: keyof AuthenticatedUser | undefined,
    ctx: ExecutionContext,
  ): AuthenticatedUser | string | boolean => {
    const req = ctx.switchToHttp().getRequest() as { user: AuthenticatedUser };
    if (data) return req.user[data];
    return req.user;
  },
);
