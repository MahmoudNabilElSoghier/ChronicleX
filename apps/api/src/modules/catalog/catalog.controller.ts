import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types';
import { PermissionsGuard } from '../rbac/guards/permissions.guard';
import { CatalogService } from './catalog.service';

@Controller()
@UseGuards(PermissionsGuard)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('companies')
  @RequirePermission('VIEW', 'COMPANY')
  async companies(@CurrentUser() user: AuthenticatedUser): Promise<unknown> {
    return { items: await this.catalog.companies(user.id) };
  }

  @Get('projects')
  @RequirePermission('VIEW', 'PROJECT')
  async projects(
    @CurrentUser() user: AuthenticatedUser,
    @Query('companyId') companyId: string | undefined,
  ): Promise<unknown> {
    return { items: await this.catalog.projects(user.id, companyId) };
  }
}
