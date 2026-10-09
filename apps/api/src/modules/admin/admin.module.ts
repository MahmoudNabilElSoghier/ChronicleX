import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { RBACModule } from '../rbac/rbac.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [CatalogModule, RBACModule],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
