import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import type { AuthenticatedUser } from '../auth/types';
import { PermissionsGuard } from '../rbac/guards/permissions.guard';
import { AuditService } from './audit.service';
import { ListAuditLogsDto } from './dto/list-audit-logs.dto';

/** Insert-only reads. No POST/PUT/PATCH/DELETE exists for audit logs. */
@Controller('audit-logs')
@UseGuards(PermissionsGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('VIEW', 'AUDIT')
  async list(
    @Query() query: ListAuditLogsDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<unknown> {
    return this.audit.list(query, user.id);
  }
}
