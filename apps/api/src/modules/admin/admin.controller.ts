import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import type { AuthenticatedUser } from '../auth/types';
import { PermissionsGuard } from '../rbac/guards/permissions.guard';
import { AdminService } from './admin.service';

@Controller('admin')
@UseGuards(PermissionsGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  /** Read-only hierarchy — no scopeHint: CatalogService.companies scopes it. */
  @Get('structure')
  @RequirePermission('VIEW', 'COMPANY')
  async structure(@CurrentUser() user: AuthenticatedUser): Promise<unknown> {
    return this.admin.structure(user.id);
  }
}
