import { Global, Module } from '@nestjs/common';
import { RBACModule } from '../rbac/rbac.module';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

/**
 * @Global(): serial parsing (entries + bulk upload, API and BullMQ workers)
 * injects SettingsService without every consumer importing this module.
 * AuditService comes from the also-global AuditModule.
 */
@Global()
@Module({
  imports: [RBACModule],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
