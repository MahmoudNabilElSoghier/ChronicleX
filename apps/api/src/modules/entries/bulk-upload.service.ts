import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { randomUUID } from 'node:crypto';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsService } from '../rbac/permissions.service';
import { ScopeMatcher } from '../rbac/scope-matcher';
import { StorageService } from '../storage/storage.service';
import { RedisService } from '../../redis/redis.service';
import { parseSerialFromFilename } from './serial.utils';

export const BULK_QUEUE = 'bulk-upload';
export const BULK_TTL_SECONDS = 24 * 3600;
export const MAX_BULK_FILES = 500;
export const MAX_BULK_BYTES = 2 * 1024 * 1024 * 1024;

export interface BulkJobData {
  jobId: string;
  fileUuid: string;
  tempKey: string;
  originalName: string;
  companyId: string;
  projectId: string;
  year: number;
  uploadedBy: string;
  ip: string | null;
  userAgent: string | null;
}

export interface BulkFileResult {
  fileUuid: string;
  originalName: string;
  status: 'ok' | 'error';
  entryId?: string;
  existingEntryId?: string;
  errorCode?: string;
  errorMessage?: string;
  serial?: string;
  typePrefix?: string;
}

export interface Actor {
  userId: string;
  ip: string | null;
  userAgent: string | null;
}

export interface BulkUploadInput {
  companyId: string;
  projectId: string;
  year: number;
}

@Injectable()
export class BulkUploadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly permissions: PermissionsService,
    private readonly scopes: ScopeMatcher,
    private readonly redis: RedisService,
    @InjectQueue(BULK_QUEUE) private readonly queue: Queue<BulkJobData>,
  ) {}

  private hashKey(jobId: string): string {
    return `bulk:${jobId}`;
  }

  private resultsKey(jobId: string): string {
    return `bulk:${jobId}:results`;
  }

  private async requireCreateScope(companyId: string, projectId: string, userId: string): Promise<void> {
    const ok = await this.scopes.canAccess(userId, 'CREATE', 'ENTRY', { projectId, companyId });
    if (!ok) {
      throw new ForbiddenException('Insufficient permissions');
    }
  }

  async createJob(
    input: BulkUploadInput,
    files: Express.Multer.File[] | undefined,
    actor: Actor,
  ): Promise<Record<string, unknown>> {
    if (!files || files.length === 0) {
      throw new BadRequestException('At least one PDF file is required');
    }
    if (files.length > MAX_BULK_FILES) {
      throw new BadRequestException(`At most ${MAX_BULK_FILES} files per bulk upload`);
    }
    const totalBytes = files.reduce((n, f) => n + f.size, 0);
    if (totalBytes > MAX_BULK_BYTES) {
      throw new BadRequestException('Bulk upload exceeds the 2 GB total limit');
    }

    const project = await this.prisma.project.findUnique({
      where: { id: input.projectId },
      include: { company: true },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }
    if (project.companyId !== input.companyId) {
      throw new BadRequestException('Project does not belong to the given company');
    }
    // Service-level CREATE check: multipart bodies are parsed after guards run,
    // so the route guard cannot see projectId. Enforcement lives here.
    await this.requireCreateScope(input.companyId, input.projectId, actor.userId);

    const jobId = randomUUID();
    const immediate: BulkFileResult[] = [];
    let queued = 0;

    for (const file of files) {
      const fileUuid = randomUUID();
      let serial: string;
      try {
        serial = parseSerialFromFilename(file.originalname).serial;
        void serial;
      } catch (err) {
        immediate.push({
          fileUuid,
          originalName: file.originalname,
          status: 'error',
          errorCode: 'INVALID_FILENAME',
          errorMessage: err instanceof Error ? err.message : 'Invalid filename',
        });
        continue;
      }
      const tempKey = `_temp/bulk/${jobId}/${fileUuid}.pdf`;
      try {
        await this.storage.putObject(tempKey, file.buffer, 'application/pdf');
      } catch {
        immediate.push({
          fileUuid,
          originalName: file.originalname,
          status: 'error',
          errorCode: 'STORAGE_ERROR',
          errorMessage: 'Could not stage file for processing',
        });
        continue;
      }
      await this.queue.add('process', {
        jobId,
        fileUuid,
        tempKey,
        originalName: file.originalname,
        companyId: input.companyId,
        projectId: input.projectId,
        year: input.year,
        uploadedBy: actor.userId,
        ip: actor.ip,
        userAgent: actor.userAgent,
      } satisfies BulkJobData);
      queued += 1;
    }

    const processed = files.length - queued;
    await this.redis.hset(this.hashKey(jobId), {
      status: queued > 0 ? 'processing' : 'done',
      total: files.length,
      processed,
      succeeded: 0,
      failed: immediate.length,
      createdBy: actor.userId,
      createdAt: new Date().toISOString(),
    });
    await this.redis.expire(this.hashKey(jobId), BULK_TTL_SECONDS);
    for (const r of immediate) {
      await this.redis.rpush(this.resultsKey(jobId), JSON.stringify(r));
    }
    await this.redis.expire(this.resultsKey(jobId), BULK_TTL_SECONDS);

    await this.prisma.auditLog.create({
      data: {
        userId: actor.userId,
        action: 'CREATE',
        resource: 'ENTRY',
        resourceId: jobId,
        newValues: {
          event: 'BULK_UPLOAD_STARTED',
          jobId,
          total: files.length,
          companyId: input.companyId,
          projectId: input.projectId,
          year: input.year,
        },
        ipAddress: actor.ip,
        userAgent: actor.userAgent,
      },
    });

    return {
      jobId,
      status: queued > 0 ? 'processing' : 'done',
      total: files.length,
      immediateFailures: immediate.length,
      statusUrl: `/entries/bulk-upload/${jobId}`,
    };
  }

  private async requireReportAccess(job: Record<string, string>, userId: string): Promise<void> {
    if (job.createdBy === userId) return;
    const grants = await this.permissions.getEffectiveGrants(userId);
    const admin = grants.some(
      (g) => g.action === 'VIEW' && g.resource === 'ENTRY' && g.scopeType === 'GROUP',
    );
    if (!admin) {
      throw new ForbiddenException('Insufficient permissions');
    }
  }

  async getReport(jobId: string, userId: string): Promise<Record<string, unknown>> {
    const job = await this.redis.hgetall(this.hashKey(jobId));
    if (!job.total) {
      throw new NotFoundException('Bulk job not found');
    }
    await this.requireReportAccess(job, userId);
    const total = Number(job.total);
    const length = await this.redis.llen(this.resultsKey(jobId));
    const rows = await this.redis.lrange(this.resultsKey(jobId), 0, 499);
    return {
      jobId,
      status: job.status,
      total,
      processed: Number(job.processed),
      succeeded: Number(job.succeeded),
      failed: Number(job.failed),
      createdAt: job.createdAt,
      results: rows.map((r) => JSON.parse(r) as BulkFileResult),
      resultsTruncated: length > 500,
    };
  }

  async cancel(jobId: string, userId: string): Promise<Record<string, unknown>> {
    const job = await this.redis.hgetall(this.hashKey(jobId));
    if (!job.total) {
      throw new NotFoundException('Bulk job not found');
    }
    await this.requireReportAccess(job, userId);
    const pending = await this.queue.getJobs(['waiting', 'delayed']);
    let cancelled = 0;
    for (const j of pending) {
      if ((j.data as BulkJobData).jobId === jobId) {
        await j.remove();
        cancelled += 1;
      }
    }
    const active = await this.queue.getJobs(['active']);
    const stillActive = active.filter((j) => (j.data as BulkJobData).jobId === jobId).length;
    await this.redis.hset(this.hashKey(jobId), { status: 'cancelled' });
    return { cancelled, stillActive };
  }
}
