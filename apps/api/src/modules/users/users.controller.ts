import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Action, Resource, ScopeType } from '../../generated/prisma/client';
import { Audit } from '../audit/audit.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import type { AuthenticatedUser } from '../auth/types';
import { PermissionsGuard } from '../rbac/guards/permissions.guard';
import { AssignRoleDto } from './dto/assign-role.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersDto } from './dto/list-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(PermissionsGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('roles')
  @RequirePermission('VIEW', 'USER')
  async listRoles(): Promise<unknown> {
    return { items: await this.users.listRoles() };
  }

  @Get()
  @RequirePermission('VIEW', 'USER')
  async list(
    @Query() query: ListUsersDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<unknown> {
    return this.users.list(query, user.id);
  }

  @Post('me/change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<void> {
    await this.users.changePassword(user.id, dto, {
      userId: user.id,
      ip,
      userAgent: userAgent ?? null,
    });
  }

  @Get(':id')
  @RequirePermission('VIEW', 'USER', { source: 'params', key: 'id' })
  async findOne(@Param('id') id: string): Promise<unknown> {
    return this.users.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('CREATE', 'USER')
  @Audit({ action: Action.CREATE, resource: Resource.USER, idParam: null })
  async create(
    @Body() dto: CreateUserDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<unknown> {
    return this.users.create(dto, { userId: user.id, ip, userAgent: userAgent ?? null });
  }

  @Patch(':id')
  @RequirePermission('UPDATE', 'USER', { source: 'params', key: 'id' })
  @Audit({ action: Action.UPDATE, resource: Resource.USER })
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto): Promise<unknown> {
    return this.users.update(id, dto);
  }

  @Post(':id/roles')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('UPDATE', 'USER', { source: 'params', key: 'id' })
  async grantRole(
    @Param('id') id: string,
    @Body() dto: AssignRoleDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<unknown> {
    return this.users.grantRole(id, dto, { userId: user.id, ip, userAgent: userAgent ?? null });
  }

  @Delete(':id/roles/:roleId')
  @RequirePermission('UPDATE', 'USER', { source: 'params', key: 'id' })
  async revokeRole(
    @Param('id') id: string,
    @Param('roleId') roleId: string,
    @Query('scopeType') scopeType: ScopeType,
    @Query('scopeId') scopeId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<void> {
    await this.users.revokeRole(id, roleId, scopeType, scopeId, {
      userId: user.id,
      ip,
      userAgent: userAgent ?? null,
    });
  }
}
