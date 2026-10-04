import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import type { Grant } from './types';

const GRANTS_TTL_SECONDS = 300;

@Injectable()
export class PermissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  private cacheKey(userId: string): string {
    return `user:grants:${userId}`;
  }

  async getEffectiveGrants(userId: string): Promise<Grant[]> {
    const cached = await this.redis.get(this.cacheKey(userId));
    if (cached) {
      return JSON.parse(cached) as Grant[];
    }
    const assignments = await this.prisma.userRole.findMany({
      where: { userId },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    const grants: Grant[] = assignments.flatMap((ur) =>
      ur.role.permissions.map((rp) => ({
        action: rp.permission.action,
        resource: rp.permission.resource,
        scopeType: ur.scopeType,
        scopeId: ur.scopeId,
      })),
    );
    await this.redis.set(this.cacheKey(userId), JSON.stringify(grants), GRANTS_TTL_SECONDS);
    return grants;
  }

  // TODO(Phase 7): call invalidate(userId) from UserRole mutations.
  // When RolePermission rows change, ALL users holding that role must
  // be invalidated — use Redis SCAN on `user:grants:*` and batch-DEL.
  async invalidate(userId: string): Promise<void> {
    await this.redis.del(this.cacheKey(userId));
  }
}
