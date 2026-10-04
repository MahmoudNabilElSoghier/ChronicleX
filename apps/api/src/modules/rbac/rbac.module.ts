import { Module } from '@nestjs/common';
import { PermissionsGuard } from './guards/permissions.guard';
import { PermissionsService } from './permissions.service';
import { ScopeMatcher } from './scope-matcher';
import { ScopeResolver } from './scope-resolver.service';

@Module({
  providers: [PermissionsService, ScopeResolver, ScopeMatcher, PermissionsGuard],
  exports: [PermissionsService, ScopeResolver, ScopeMatcher, PermissionsGuard],
})
export class RBACModule {}
