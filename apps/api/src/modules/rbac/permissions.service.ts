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

  // Phase 4 TODO closed: users.service calls invalidateUser() on every
  // grant/revoke/deactivate path. RoleService (Phase 8) must call
  // invalidateRole() whenever RolePermission rows change.
  /** Drop one user's cached grants. Call on any mutation of their access. */
  async invalidateUser(userId: string): Promise<void> {
    await this.redis.del(this.cacheKey(userId));
  }

  /** Drop every cached grant set. Nuclear option for permission-model changes. */
  async invalidateAll(): Promise<void> {
    await this.redis.deleteByPattern('user:grants:*');
  }

  /** Drop cached grants of all users holding a role (after its perms change). */
  async invalidateRole(roleId: string): Promise<void> {
    const rows = await this.prisma.userRole.findMany({
      where: { roleId },
      select: { userId: true },
    });
    const ids = [...new Set(rows.map((r) => r.userId))];
    for (const id of ids) {
      await this.redis.del(this.cacheKey(id));
    }
  }
}
