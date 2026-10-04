import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { RBACModule } from '../rbac/rbac.module';
import { BulkUploadController } from './bulk-upload.controller';
import { BulkUploadProcessor } from './bulk-upload.processor';
import { BULK_QUEUE, BulkUploadService } from './bulk-upload.service';
import { EntriesController } from './entries.controller';
import { EntriesService } from './entries.service';

// TODO(Phase 7): scheduled cleanup of `_temp/bulk/*` objects older than 2h
// and of orphaned `bulk:*` Redis keys (see BulkUploadService key layout).
@Module({
  imports: [RBACModule, BullModule.registerQueue({ name: BULK_QUEUE })],
  controllers: [EntriesController, BulkUploadController],
  providers: [EntriesService, BulkUploadService, BulkUploadProcessor],
  exports: [EntriesService, BulkUploadService],
})
export class EntriesModule {}
