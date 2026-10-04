import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { RefreshPayload, TokenService } from './token.service';

const REFRESH_COOKIE = 'refresh_token';
const ROTATED_GRACE_SECONDS = 60;
const LOGIN_FAIL_DELAY_MS = 200;

interface RefreshSession {
  rotatedTo: string | null;
  userAgent: string | null;
  ip: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface PublicUser {
  id: string;
  email: string;
  nameAr: string;
  nameEn: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly tokens: TokenService,
  ) {}

  private sessionKey(userId: string, jti: string): string {
    return `refresh:${userId}:${jti}`;
  }

  private async audit(
    userId: string | null,
    event: string,
    extra: Record<string, unknown>,
    ip: string | null,
    userAgent: string | null,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'CREATE',
        resource: 'AUTH',
        resourceId: userId,
        newValues: { event, ...extra },
        ipAddress: ip,
        userAgent,
      },
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async login(
    email: string,
    password: string,
    ip: string | null,
    userAgent: string | null,
  ): Promise<{ accessToken: string; refreshToken: string; user: PublicUser }> {
    const normalized = email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalized } });

    if (!user) {
      await this.delay(LOGIN_FAIL_DELAY_MS);
      await this.audit(null, 'LOGIN_FAILED', { email: normalized }, ip, userAgent);
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!user.isActive) {
      await this.audit(user.id, 'LOGIN_FAILED', { email: normalized }, ip, userAgent);
      throw new UnauthorizedException('Invalid credentials');
    }
    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) {
      await this.audit(user.id, 'LOGIN_FAILED', { email: normalized }, ip, userAgent);
      throw new UnauthorizedException('Invalid credentials');
    }

    const jti = randomUUID();
    const session: RefreshSession = { rotatedTo: null, userAgent, ip };
    await this.redis.set(this.sessionKey(user.id, jti), JSON.stringify(session), this.tokens.refreshTtlSeconds);

    const accessToken = this.tokens.signAccess({ sub: user.id, email: user.email, jti: randomUUID() });
    const refreshToken = this.tokens.signRefresh({ sub: user.id, jti });
    await this.audit(user.id, 'LOGIN_SUCCESS', {}, ip, userAgent);
    return {
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, nameAr: user.nameAr, nameEn: user.nameEn },
    };
  }

  async refresh(
    refreshToken: string,
    ip: string | null,
    userAgent: string | null,
  ): Promise<AuthTokens> {
    let payload: RefreshPayload;
    try {
      payload = this.tokens.verify<RefreshPayload>(refreshToken);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const key = this.sessionKey(payload.sub, payload.jti);
    const raw = await this.redis.get(key);
    if (!raw) {
      // Not in Redis: naturally expired (TTL elapsed) or forged with a valid
      // signature. Neither warrants nuking the user's other sessions.
      await this.audit(payload.sub, 'REFRESH_TOKEN_EXPIRED_OR_UNKNOWN',
        { jti: payload.jti }, ip, userAgent);
      throw new UnauthorizedException('Invalid refresh token');
    }
    const session = JSON.parse(raw) as RefreshSession;
    if (session.rotatedTo) {
      // Real reuse: old JTI still carries rotatedTo within the grace window.
      await this.redis.deleteByPattern(`refresh:${payload.sub}:*`);
      await this.audit(payload.sub, 'REFRESH_REUSE_DETECTED',
        { jti: payload.jti, rotatedTo: session.rotatedTo }, ip, userAgent);
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const newJti = randomUUID();
    await this.redis.set(
      key,
      JSON.stringify({ ...session, rotatedTo: newJti } satisfies RefreshSession),
      ROTATED_GRACE_SECONDS,
    );
    await this.redis.set(
      this.sessionKey(user.id, newJti),
      JSON.stringify({ rotatedTo: null, userAgent, ip } satisfies RefreshSession),
      this.tokens.refreshTtlSeconds,
    );

    await this.audit(user.id, 'TOKEN_ROTATED', { fromJti: payload.jti }, ip, userAgent);
    return {
      accessToken: this.tokens.signAccess({ sub: user.id, email: user.email, jti: randomUUID() }),
      refreshToken: this.tokens.signRefresh({ sub: user.id, jti: newJti }),
    };
  }

  async logout(refreshToken: string | undefined, ip: string | null, userAgent: string | null): Promise<void> {
    if (!refreshToken) return;
    try {
      const payload = this.tokens.verify<RefreshPayload>(refreshToken);
      await this.redis.del(this.sessionKey(payload.sub, payload.jti));
      await this.audit(payload.sub, 'LOGOUT', {}, ip, userAgent);
    } catch {
      // Unverifiable token: nothing to revoke. Cookie is still cleared by the controller.
    }
  }

  async me(userId: string): Promise<{
    id: string;
    email: string;
    nameAr: string;
    nameEn: string;
    isActive: boolean;
    roles: Array<{ name: string; scopeType: string; scopeId: string }>;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: { include: { role: true } } },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid token');
    }
    return {
      id: user.id,
      email: user.email,
      nameAr: user.nameAr,
      nameEn: user.nameEn,
      isActive: user.isActive,
      roles: user.roles.map((ur) => ({
        name: ur.role.name,
        scopeType: ur.scopeType,
        scopeId: ur.scopeId,
      })),
    };
  }
}

export { REFRESH_COOKIE };
