import { Body, Controller, Get, Headers, Ip, Put, UseGuards } from '@nestjs/common';
import { Audit } from '../audit/audit.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import type { AuthenticatedUser } from '../auth/types';
import { PermissionsGuard } from '../rbac/guards/permissions.guard';
import { Action, Resource } from '../../generated/prisma/client';
import { UpdatePrefixesDto } from './dto/update-prefixes.dto';
import { SettingsService } from './settings.service';

/**
 * Runtime settings. Reads require VIEW COMPANY (every role has it in
 * practice — the upload UI needs the prefix list); writes additionally
 * require a GROUP-scoped UPDATE COMPANY grant, enforced in the service.
 */
@Controller('settings')
@UseGuards(PermissionsGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('entry-prefixes')
  @RequirePermission('VIEW', 'COMPANY')
  async getEntryPrefixes(): Promise<{ prefixes: string[] }> {
    return this.settings.readEntryPrefixes();
  }

  @Put('entry-prefixes')
  @RequirePermission('UPDATE', 'COMPANY')
  @Audit({ action: Action.UPDATE, resource: Resource.COMPANY, idParam: null })
  async updateEntryPrefixes(
    @Body() dto: UpdatePrefixesDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<{ prefixes: string[] }> {
    return this.settings.updateEntryPrefixes(dto.prefixes, {
      userId: user.id,
      ip,
      userAgent: userAgent ?? null,
    });
  }
}
