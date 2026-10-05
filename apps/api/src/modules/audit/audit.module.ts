import { Global, Module } from '@nestjs/common';
import { RBACModule } from '../rbac/rbac.module';
import { AuditController } from './audit.controller';
import { AuditInterceptor } from './audit.interceptor';
import { AuditService } from './audit.service';
import { ResourceLoaderService } from './resource-loader.service';

@Global()
@Module({
  imports: [RBACModule],
  controllers: [AuditController],
  providers: [AuditService, ResourceLoaderService, AuditInterceptor],
  exports: [AuditService, ResourceLoaderService, AuditInterceptor],
})
export class AuditModule {}
