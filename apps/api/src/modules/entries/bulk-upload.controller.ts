import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { BulkUploadThrottlerGuard } from '../auth/guards/bulk-upload-throttler.guard';
import type { AuthenticatedUser } from '../auth/types';
import { Throttle } from '@nestjs/throttler';
import { PermissionsGuard } from '../rbac/guards/permissions.guard';
import { BulkUploadService } from './bulk-upload.service';
import { BulkUploadDto, PreviewBulkDto } from './dto/bulk-upload.dto';

@Controller('entries')
@UseGuards(PermissionsGuard)
export class BulkUploadController {
  constructor(private readonly bulk: BulkUploadService) {}

  @Post('bulk-upload')
  @HttpCode(HttpStatus.ACCEPTED)
  // No scopeHint: multipart bodies aren't parsed when guards run.
  // Service-level requireCreateScope() enforces project-scoped access
  // after multer parses the request.
  @RequirePermission('CREATE', 'ENTRY')
  @UseGuards(BulkUploadThrottlerGuard)
  @Throttle({ 'bulk-upload': { limit: 5, ttl: 900 } })
  @UseInterceptors(
    FilesInterceptor('files', 500, {
      storage: memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (file.mimetype !== 'application/pdf') {
          return cb(new BadRequestException('Only application/pdf is accepted'), false);
        }
        cb(null, true);
      },
    }),
  )
  async bulkUpload(
    @Body() dto: BulkUploadDto,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<unknown> {
    return this.bulk.createJob(dto, files, {
      userId: user.id,
      ip,
      userAgent: userAgent ?? null,
    });
  }

  @Post('bulk-upload/preview')
  @RequirePermission('CREATE', 'ENTRY')
  async bulkPreview(
    @Body() dto: PreviewBulkDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<unknown> {
    // No scopeHint needed: the body IS parsed before guards for JSON
    // requests, but the service enforces project-scoped CREATE access
    // anyway (same rule as bulkUpload).
    return this.bulk.preview(
      {
        companyId: dto.companyId,
        projectId: dto.projectId,
        year: dto.year,
        fileNames: dto.fileNames,
        fileHashes: dto.fileHashes,
      },
      user.id,
    );
  }

  @Get('bulk-upload/:jobId')
  @RequirePermission('VIEW', 'ENTRY')
  async bulkStatus(
    @Param('jobId') jobId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<unknown> {
    return this.bulk.getReport(jobId, user.id);
  }

  @Post('bulk-upload/:jobId/cancel')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission('VIEW', 'ENTRY')
  async bulkCancel(
    @Param('jobId') jobId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<unknown> {
    return this.bulk.cancel(jobId, user.id);
  }
}
