import { Controller, Get, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types';
import { PermissionsGuard } from '../rbac/guards/permissions.guard';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(PermissionsGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @RequirePermission('VIEW', 'ENTRY')
  async summary(@CurrentUser() user: AuthenticatedUser): Promise<unknown> {
    return this.dashboard.summary(user.id);
  }
}
