import { Module } from '@nestjs/common';
import { PermissionsGuard } from './guards/permissions.guard';
import { PermissionsService } from './permissions.service';
import { ScopeResolver } from './scope-resolver.service';

@Module({
  providers: [PermissionsService, ScopeResolver, PermissionsGuard],
  exports: [PermissionsService, ScopeResolver, PermissionsGuard],
})
export class RBACModule {}
