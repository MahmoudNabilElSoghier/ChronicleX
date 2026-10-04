import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { PermissionsService } from '../../rbac/permissions.service';
import { ScopeMatcher } from '../../rbac/scope-matcher';
import { StorageService } from '../../storage/storage.service';
import { BulkUploadService } from '../bulk-upload.service';

const ACTOR = { userId: 'u1', ip: '1.2.3.4', userAgent: 'ua' };

function pdfFile(name: string): Express.Multer.File {
  const buffer = Buffer.from('%PDF-1.7 fake');
  return { originalname: name, mimetype: 'application/pdf', buffer, size: buffer.length } as Express.Multer.File;
}

describe('BulkUploadService', () => {
  const prisma = {
    project: { findUnique: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const storage = { putObject: jest.fn() };
  const permissions = { getEffectiveGrants: jest.fn() };
  const redis = { hset: jest.fn(), expire: jest.fn(), rpush: jest.fn(), hgetall: jest.fn(), llen: jest.fn(), lrange: jest.fn() };
  const queue = { add: jest.fn(), getJobs: jest.fn() };
  const scopes = new ScopeMatcher(permissions as unknown as PermissionsService);

  const svc = new BulkUploadService(
    prisma as unknown as PrismaService,
    storage as unknown as StorageService,
    permissions as unknown as PermissionsService,
    scopes,
    redis as unknown as RedisService,
    queue as unknown as Queue,
  );

  const project = { id: 'p1', companyId: 'c1', code: 'REHAB', company: { id: 'c1', code: 2000 } };
  const grants = [{ action: 'CREATE', resource: 'ENTRY', scopeType: 'PROJECT', scopeId: 'p1' }];

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.project.findUnique.mockResolvedValue(project);
    permissions.getEffectiveGrants.mockResolvedValue(grants);
  });

  it('enqueues 3 valid files and initializes the hash', async () => {
    const res = (await svc.createJob(
      { companyId: 'c1', projectId: 'p1', year: 2025 },
      [pdfFile('6200000000.pdf'), pdfFile('6300000001.pdf'), pdfFile('6700000002.pdf')],
      ACTOR,
    )) as Record<string, unknown>;
    expect(queue.add).toHaveBeenCalledTimes(3);
    expect(res.immediateFailures).toBe(0);
    expect(res.status).toBe('processing');
    expect(res.total).toBe(3);
    expect(res.statusUrl).toBe(`/entries/bulk-upload/${res.jobId as string}`);
    expect(redis.hset).toHaveBeenCalledWith(
      expect.stringMatching(/^bulk:/),
      expect.objectContaining({ status: 'processing', total: 3, processed: 0 }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ newValues: expect.objectContaining({ event: 'BULK_UPLOAD_STARTED' }) }),
      }),
    );
  });

  it('records immediate failures without queueing them', async () => {
    const res = (await svc.createJob(
      { companyId: 'c1', projectId: 'p1', year: 2025 },
      [pdfFile('6200000000.pdf'), pdfFile('not-a-serial.pdf'), pdfFile('6300000001.pdf')],
      ACTOR,
    )) as Record<string, unknown>;
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(res.immediateFailures).toBe(1);
    expect(redis.rpush).toHaveBeenCalledWith(
      expect.stringMatching(/:results$/),
      expect.stringContaining('INVALID_FILENAME'),
    );
  });

  it('rejects an empty files array → 400', async () => {
    await expect(
      svc.createJob({ companyId: 'c1', projectId: 'p1', year: 2025 }, [], ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('rejects more than 500 files → 400', async () => {
    const files = Array.from({ length: 501 }, (_, i) =>
      pdfFile(`62${String(i).padStart(8, '0')}.pdf`),
    );
    await expect(
      svc.createJob({ companyId: 'c1', projectId: 'p1', year: 2025 }, files, ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('rejects a project from another company → 400', async () => {
    prisma.project.findUnique.mockResolvedValue({ ...project, companyId: 'c2' });
    await expect(
      svc.createJob({ companyId: 'c1', projectId: 'p1', year: 2025 }, [pdfFile('6200000000.pdf')], ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('rejects a caller without CREATE ENTRY scope → 403', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([
      { action: 'VIEW', resource: 'ENTRY', scopeType: 'PROJECT', scopeId: 'p1' },
    ]);
    await expect(
      svc.createJob({ companyId: 'c1', projectId: 'p1', year: 2025 }, [pdfFile('6200000000.pdf')], ACTOR),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(queue.add).not.toHaveBeenCalled();
  });
});
