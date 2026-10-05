import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import type { Prisma, ScopeType } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { PermissionsService } from '../rbac/permissions.service';
import type { AssignRoleDto } from './dto/assign-role.dto';
import type { ChangePasswordDto } from './dto/change-password.dto';
import type { CreateUserDto } from './dto/create-user.dto';
import type { ListUsersDto } from './dto/list-users.dto';
import type { UpdateUserDto } from './dto/update-user.dto';

export interface Actor {
  userId: string;
  ip: string | null;
  userAgent: string | null;
}

const PUBLIC_SELECT = {
  id: true,
  email: true,
  nameAr: true,
  nameEn: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly redis: RedisService,
  ) {}

  private async audit(
    userId: string,
    resourceId: string,
    event: string,
    actor: Actor,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'UPDATE',
        resource: 'USER',
        resourceId,
        newValues: { event, ...extra },
        ipAddress: actor.ip,
        userAgent: actor.userAgent,
      },
    });
  }

  private async purgeSessions(userId: string): Promise<void> {
    await this.redis.deleteByPattern(`refresh:${userId}:*`);
  }

  /**
   * Can the caller hand out a role at (scopeType, scopeId)?
   * GROUP → GROUP UPDATE USER only. COMPANY → plus that company's grant.
   * PROJECT → plus the parent company's or the project's own grant.
   */
  private async canGrant(
    callerId: string,
    scopeType: ScopeType,
    scopeId: string,
  ): Promise<boolean> {
    const grants = await this.permissions.getEffectiveGrants(callerId);
    const has = (action: 'UPDATE', scope: { scopeType: ScopeType; scopeId: string }): boolean =>
      grants.some(
        (g) =>
          g.action === action &&
          g.resource === 'USER' &&
          (g.scopeType === 'GROUP' ||
            (g.scopeType === scope.scopeType && g.scopeId === scope.scopeId)),
      );
    if (scopeType === 'GROUP') {
      return has('UPDATE', { scopeType: 'GROUP', scopeId: '' });
    }
    if (scopeType === 'COMPANY') {
      return has('UPDATE', { scopeType: 'COMPANY', scopeId });
    }
    const project = await this.prisma.project.findUnique({
      where: { id: scopeId },
      select: { companyId: true },
    });
    if (!project) return false;
    return (
      has('UPDATE', { scopeType: 'PROJECT', scopeId }) ||
      has('UPDATE', { scopeType: 'COMPANY', scopeId: project.companyId })
    );
  }

  private normalizeScopeId(scopeType: ScopeType, scopeId: string | undefined): string {
    if (scopeType === 'GROUP') return '';
    return scopeId ?? '';
  }

  async list(query: ListUsersDto, actorId: string): Promise<Record<string, unknown>> {
    const grants = await this.permissions.getEffectiveGrants(actorId);
    const view = grants.filter((g) => g.action === 'VIEW' && g.resource === 'USER');
    if (view.length === 0) {
      throw new ForbiddenException('Insufficient permissions');
    }
    const and: Prisma.UserWhereInput[] = [];
    if (!view.some((g) => g.scopeType === 'GROUP')) {
      const or: Prisma.UserRoleWhereInput[] = [];
      for (const g of view) {
        if (g.scopeType === 'COMPANY' || g.scopeType === 'PROJECT') {
          or.push({ scopeType: g.scopeType, scopeId: g.scopeId });
        }
      }
      if (or.length === 0) {
        throw new ForbiddenException('Insufficient permissions');
      }
      and.push({ roles: { some: { OR: or } } });
    }
    if (query.email) and.push({ email: { contains: query.email, mode: 'insensitive' } });
    if (query.name) {
      and.push({
        OR: [
          { nameAr: { contains: query.name, mode: 'insensitive' } },
          { nameEn: { contains: query.name, mode: 'insensitive' } },
        ],
      });
    }
    if (query.isActive !== undefined) and.push({ isActive: query.isActive });
    if (query.hasRole) and.push({ roles: { some: { role: { name: query.hasRole } } } });

    const limit = query.limit;
    const rows = await this.prisma.user.findMany({
      where: { AND: and },
      select: {
        ...PUBLIC_SELECT,
        roles: { select: { role: { select: { name: true } }, scopeType: true, scopeId: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map((u) => ({
      ...u,
      roles: u.roles.map((r) => ({ name: r.role.name, scopeType: r.scopeType, scopeId: r.scopeId })),
    }));
    const last = items.length > 0 ? items[items.length - 1] : undefined;
    return { items, nextCursor: hasMore && last ? last.id : null };
  }

  async findOne(id: string): Promise<Record<string, unknown>> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        ...PUBLIC_SELECT,
        roles: { select: { role: { select: { name: true } }, scopeType: true, scopeId: true } },
      },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return {
      ...user,
      roles: user.roles.map((r) => ({ name: r.role.name, scopeType: r.scopeType, scopeId: r.scopeId })),
    };
  }

  async create(dto: CreateUserDto, actor: Actor): Promise<Record<string, unknown>> {
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      throw new ConflictException('Email already registered');
    }
    // Role-less users are invisible to COMPANY_ADMIN (USER chain = [GROUP]).
    // Require at least one grant at creation; explicit revocation later is
    // the only path to a role-less user.
    if (!dto.initialRoles || dto.initialRoles.length === 0) {
      throw new BadRequestException('At least one initial role is required');
    }
    for (const r of dto.initialRoles) {
      const scopeId = this.normalizeScopeId(r.scopeType, r.scopeId);
      if (!(await this.canGrant(actor.userId, r.scopeType, scopeId))) {
        throw new ForbiddenException('Insufficient permissions to grant one of the roles');
      }
    }
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash: await argon2.hash(dto.password),
        nameAr: dto.nameAr,
        nameEn: dto.nameEn,
        isActive: true,
      },
      select: { ...PUBLIC_SELECT },
    });
    for (const r of dto.initialRoles) {
      const scopeId = this.normalizeScopeId(r.scopeType, r.scopeId);
      await this.prisma.userRole.upsert({
        where: {
          userId_roleId_scopeType_scopeId: {
            userId: user.id,
            roleId: r.roleId,
            scopeType: r.scopeType,
            scopeId,
          },
        },
        update: {},
        create: { userId: user.id, roleId: r.roleId, scopeType: r.scopeType, scopeId },
      });
    }
    // Grants are lazy-cached on first read; nothing to pre-populate.
    return user as unknown as Record<string, unknown>;
  }

  async update(id: string, dto: UpdateUserDto): Promise<Record<string, unknown>> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const data: { nameAr?: string; nameEn?: string; isActive?: boolean } = {};
    if (dto.nameAr !== undefined) data.nameAr = dto.nameAr;
    if (dto.nameEn !== undefined) data.nameEn = dto.nameEn;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    const updated = await this.prisma.user.update({
      where: { id },
      data,
      select: { ...PUBLIC_SELECT },
    });
    if (dto.isActive === false) {
      await this.purgeSessions(id);
      await this.permissions.invalidateUser(id);
    }
    return updated as unknown as Record<string, unknown>;
  }

  async changePassword(userId: string, dto: ChangePasswordDto, actor: Actor): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!(await argon2.verify(user.passwordHash, dto.currentPassword))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (dto.newPassword === dto.currentPassword) {
      throw new BadRequestException('New password must differ from the current one');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await argon2.hash(dto.newPassword) },
    });
    await this.purgeSessions(userId);
    await this.audit(userId, userId, 'PASSWORD_CHANGED', actor);
  }

  async grantRole(targetId: string, dto: AssignRoleDto, actor: Actor): Promise<Record<string, unknown>> {
    const target = await this.prisma.user.findUnique({ where: { id: targetId }, select: { id: true } });
    if (!target) {
      throw new NotFoundException('User not found');
    }
    const role = await this.prisma.role.findUnique({ where: { id: dto.roleId } });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    const scopeId = this.normalizeScopeId(dto.scopeType, dto.scopeId);
    if (!(await this.canGrant(actor.userId, dto.scopeType, scopeId))) {
      throw new ForbiddenException('Insufficient permissions to grant this role');
    }
    const row = await this.prisma.userRole.upsert({
      where: {
        userId_roleId_scopeType_scopeId: {
          userId: targetId,
          roleId: dto.roleId,
          scopeType: dto.scopeType,
          scopeId,
        },
      },
      update: {},
      create: { userId: targetId, roleId: dto.roleId, scopeType: dto.scopeType, scopeId },
    });
    await this.permissions.invalidateUser(targetId);
    await this.audit(targetId, targetId, 'ROLE_GRANTED', actor, {
      roleId: dto.roleId,
      scopeType: dto.scopeType,
      scopeId,
    });
    return row as unknown as Record<string, unknown>;
  }

  async revokeRole(
    targetId: string,
    roleId: string,
    scopeType: ScopeType,
    scopeId: string | undefined,
    actor: Actor,
  ): Promise<void> {
    const normalized = this.normalizeScopeId(scopeType, scopeId);
    if (!(await this.canGrant(actor.userId, scopeType, normalized))) {
      throw new ForbiddenException('Insufficient permissions to revoke this role');
    }
    const existing = await this.prisma.userRole.findFirst({
      where: { userId: targetId, roleId, scopeType, scopeId: normalized },
    });
    if (!existing) {
      throw new NotFoundException('Role assignment not found');
    }
    // Lockout guard: block only when the caller would remove the FINAL
    // system-wide SUPER_ADMIN grant. Self-revoke is fine while at least one
    // other ACTIVE user still holds SUPER_ADMIN at GROUP scope.
    if (targetId === actor.userId && scopeType === 'GROUP') {
      const role = await this.prisma.role.findUnique({ where: { id: roleId } });
      if (role?.name === 'SUPER_ADMIN') {
        const holders = await this.prisma.userRole.findMany({
          where: { scopeType: 'GROUP' },
          include: { role: true, user: { select: { id: true, isActive: true } } },
        });
        const others = new Set(
          holders
            .filter((r) => r.role.name === 'SUPER_ADMIN' && r.user.isActive && r.user.id !== actor.userId)
            .map((r) => r.user.id),
        );
        if (others.size === 0) {
          throw new BadRequestException('Cannot revoke the last SUPER_ADMIN grant');
        }
      }
    }
    await this.prisma.userRole.deleteMany({
      where: { userId: targetId, roleId, scopeType, scopeId: normalized },
    });
    await this.permissions.invalidateUser(targetId);
    await this.audit(targetId, targetId, 'ROLE_REVOKED', actor, {
      roleId,
      scopeType,
      scopeId: normalized,
    });
  }
}
