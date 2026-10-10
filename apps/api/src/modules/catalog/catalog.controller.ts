import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Audit } from '../audit/audit.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types';
import { PermissionsGuard } from '../rbac/guards/permissions.guard';
import { Action, Resource } from '../../generated/prisma/client';
import { CatalogService } from './catalog.service';
import {
  CreateCompanyDto,
  CreateProjectDto,
  UpdateCompanyDto,
  UpdateProjectDto,
} from './dto/catalog.dto';

/**
 * Reads are VIEW-scoped and filtered by the service. Mutations all require
 * UPDATE COMPANY at the guard; the service then splits: company rows are
 * group-wide only, project rows also accept a COMPANY-scoped grant on the
 * parent company.
 */
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

  @Post('companies')
  @RequirePermission('UPDATE', 'COMPANY')
  @Audit({ action: Action.CREATE, resource: Resource.COMPANY, idParam: null })
  async createCompany(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCompanyDto,
  ): Promise<unknown> {
    return this.catalog.createCompany(user.id, dto);
  }

  @Patch('companies/:id')
  @RequirePermission('UPDATE', 'COMPANY')
  @Audit({ action: Action.UPDATE, resource: Resource.COMPANY })
  async updateCompany(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateCompanyDto,
  ): Promise<unknown> {
    return this.catalog.updateCompany(user.id, id, dto);
  }

  @Delete('companies/:id')
  @RequirePermission('UPDATE', 'COMPANY')
  @Audit({ action: Action.DELETE, resource: Resource.COMPANY })
  async deleteCompany(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.catalog.deleteCompany(user.id, id);
  }

  @Post('projects')
  @RequirePermission('UPDATE', 'COMPANY')
  @Audit({ action: Action.CREATE, resource: Resource.PROJECT, idParam: null })
  async createProject(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateProjectDto,
  ): Promise<unknown> {
    return this.catalog.createProject(user.id, dto);
  }

  @Patch('projects/:id')
  @RequirePermission('UPDATE', 'COMPANY')
  @Audit({ action: Action.UPDATE, resource: Resource.PROJECT })
  async updateProject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
  ): Promise<unknown> {
    return this.catalog.updateProject(user.id, id, dto);
  }

  @Delete('projects/:id')
  @RequirePermission('UPDATE', 'COMPANY')
  @Audit({ action: Action.DELETE, resource: Resource.PROJECT })
  async deleteProject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.catalog.deleteProject(user.id, id);
  }
}
