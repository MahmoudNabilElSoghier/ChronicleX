import { Processor, WorkerHost } from '@nestjs/bullmq';
import { createHash } from 'node:crypto';
import type { Job } from 'bullmq';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { StorageService } from '../storage/storage.service';
import {
  BULK_TTL_SECONDS,
  BulkFileResult,
  BulkJobData,
} from './bulk-upload.service';
import { BULK_QUEUE } from './bulk-upload.service';
import { parseSerialFromFilename, validatePdfMagicBytes } from './serial.utils';

function failResult(
  data: BulkJobData,
  errorCode: string,
  errorMessage: string,
  existingEntryId?: string,
): BulkFileResult {
  return {
    fileUuid: data.fileUuid,
    originalName: data.originalName,
    status: 'error',
    errorCode,
    errorMessage,
    ...(existingEntryId ? { existingEntryId } : {}),
  };
}

@Processor(BULK_QUEUE, { concurrency: 3 })
export class BulkUploadProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly redis: RedisService,
  ) {
    super();
  }

  private hashKey(jobId: string): string {
    return `bulk:${jobId}`;
  }

  private resultsKey(jobId: string): string {
    return `bulk:${jobId}:results`;
  }

  private async record(
    data: BulkJobData,
    ok: boolean,
    result: BulkFileResult,
  ): Promise<void> {
    await this.redis.rpush(this.resultsKey(data.jobId), JSON.stringify(result));
    await this.redis.expire(this.resultsKey(data.jobId), BULK_TTL_SECONDS);
    await this.redis.hincrby(this.hashKey(data.jobId), ok ? 'succeeded' : 'failed', 1);
    // hincrby is atomic: exactly one worker observes processed === total.
    const processed = await this.redis.hincrby(this.hashKey(data.jobId), 'processed', 1);
    const state = await this.redis.hgetall(this.hashKey(data.jobId));
    const total = Number(state.total ?? '0');
    if (processed >= total && total > 0) {
      const failed = Number(state.failed ?? '0');
      const succeeded = Number(state.succeeded ?? '0');
      await this.redis.hset(this.hashKey(data.jobId), {
        status: failed > 0 && succeeded === 0 ? 'failed' : 'done',
      });
    }
  }

  async process(job: Job<BulkJobData>): Promise<void> {
    const d = job.data;
    const actor = { userId: d.uploadedBy, ip: d.ip, userAgent: d.userAgent };
    try {
      let buffer: Buffer;
      try {
        buffer = await this.storage.getObjectBuffer(d.tempKey);
      } catch {
        await this.record(d, false, failResult(d, 'STORAGE_ERROR', 'Could not read staged file'));
        return;
      }
      if (!validatePdfMagicBytes(buffer)) {
        await this.record(d, false, failResult(d, 'INVALID_MAGIC_BYTES', 'File content is not a valid PDF'));
        return;
      }
      let serial: string;
      let typePrefix: string;
      let counter: number;
      try {
        ({ serial, typePrefix, counter } = parseSerialFromFilename(d.originalName));
      } catch (err) {
        await this.record(
          d,
          false,
          failResult(d, 'INVALID_FILENAME', err instanceof Error ? err.message : 'Invalid filename'),
        );
        return;
      }
      const fileHash = createHash('sha256').update(buffer).digest('hex');

      const dupe = await this.prisma.entry.findUnique({
        where: { companyId_year_serial: { companyId: d.companyId, year: d.year, serial } },
        select: { id: true },
      });
      if (dupe) {
        await this.record(
          d,
          false,
          failResult(d, 'DUPLICATE_SERIAL', 'Serial already exists for this company and year', dupe.id),
        );
        return;
      }
      const dupeFile = await this.prisma.entry.findFirst({
        where: { fileHash, deletedAt: null },
        select: { id: true },
      });
      if (dupeFile) {
        await this.record(
          d,
          false,
          failResult(d, 'DUPLICATE_FILE', 'Identical file already archived', dupeFile.id),
        );
        return;
      }

      const project = await this.prisma.project.findUnique({
        where: { id: d.projectId },
        include: { company: true },
      });
      if (!project) {
        await this.record(d, false, failResult(d, 'PROJECT_NOT_FOUND', 'Project not found'));
        return;
      }
      if (project.companyId !== d.companyId) {
        await this.record(
          d,
          false,
          failResult(d, 'PROJECT_COMPANY_MISMATCH', 'Project does not belong to the given company'),
        );
        return;
      }

      const fileKey = `${project.company.code}/${project.code}/${d.year}/${serial}.pdf`;
      try {
        await this.storage.putObject(fileKey, buffer, 'application/pdf');
      } catch {
        await this.record(d, false, failResult(d, 'STORAGE_ERROR', 'Could not store file'));
        return;
      }

      let entryId: string;
      try {
        const entry = await this.prisma.entry.create({
          data: {
            companyId: d.companyId,
            projectId: d.projectId,
            year: d.year,
            serial,
            typePrefix,
            counter,
            fileKey,
            fileName: d.originalName,
            fileSize: buffer.length,
            mimeType: 'application/pdf',
            fileHash,
            uploadedBy: d.uploadedBy,
          },
          select: { id: true },
        });
        entryId = entry.id;
      } catch (err) {
        // Check-then-insert race (concurrent jobs, same serial): the loser
        // hits the DB unique constraint. Map it to the same DUPLICATE_SERIAL
        // result so clients see one deterministic error code either way.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const existing = await this.prisma.entry
            .findUnique({
              where: {
                companyId_year_serial: { companyId: d.companyId, year: d.year, serial },
              },
              select: { id: true },
            })
            .catch(() => null);
          await this.record(
            d,
            false,
            failResult(
              d,
              'DUPLICATE_SERIAL',
              'Serial already exists for this company and year',
              existing?.id,
            ),
          );
          return;
        }
        await this.record(d, false, failResult(d, 'DB_ERROR', 'Could not create entry'));
        return;
      }

      await this.prisma.auditLog.create({
        data: {
          userId: d.uploadedBy,
          action: 'CREATE',
          resource: 'ENTRY',
          resourceId: entryId,
          newValues: {
            serial,
            year: d.year,
            companyId: d.companyId,
            projectId: d.projectId,
            fileName: d.originalName,
            fileSize: buffer.length,
          },
          ipAddress: actor.ip,
          userAgent: actor.userAgent,
        },
      });
      await this.record(d, true, {
        fileUuid: d.fileUuid,
        originalName: d.originalName,
        status: 'ok',
        entryId,
        serial,
        typePrefix,
      });
    } catch {
      await this.record(d, false, failResult(d, 'UNKNOWN', 'Unexpected processing error'));
    } finally {
      await this.storage.removeObject(d.tempKey).catch(() => undefined);
    }
  }
}
