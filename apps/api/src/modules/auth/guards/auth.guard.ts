import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccessPayload, TokenService } from '../token.service';
import { AuthenticatedUser } from '../types';
import { IS_PUBLIC } from '../decorators/public.decorator';

function bearerToken(authHeader: unknown): string {
  const [scheme, token] = typeof authHeader === 'string' ? authHeader.split(' ') : [];
  if (scheme !== 'Bearer' || !token) {
    throw new UnauthorizedException('Missing access token');
  }
  return token;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const classRef = context.getClass();
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [handler, classRef])) {
      return true;
    }
    const req = context.switchToHttp().getRequest() as {
      headers: Record<string, unknown>;
      user?: AuthenticatedUser;
    };
    let payload: AccessPayload;
    try {
      payload = this.tokens.verify<AccessPayload>(bearerToken(req.headers.authorization));
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }
    // Fresh load per request: isActive flips and role changes take effect immediately.
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid access token');
    }
    req.user = {
      id: user.id,
      email: user.email,
      nameAr: user.nameAr,
      nameEn: user.nameEn,
      isActive: user.isActive,
    };
    return true;
  }
}
