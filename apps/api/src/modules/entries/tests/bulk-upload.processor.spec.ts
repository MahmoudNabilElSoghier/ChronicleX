import type { Job } from 'bullmq';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import type { SettingsService } from '../../settings/settings.service';
import { StorageService } from '../../storage/storage.service';
import { BulkUploadProcessor } from '../bulk-upload.processor';
import type { BulkJobData } from '../bulk-upload.service';

function jobOf(data: Partial<BulkJobData>): Job<BulkJobData> {
  return {
    data: {
      jobId: 'job1',
      fileUuid: 'f1',
      tempKey: '_temp/bulk/job1/f1.pdf',
      originalName: '6200000000.pdf',
      companyId: 'c1',
      projectId: 'p1',
      year: 2025,
      uploadedBy: 'u1',
      ip: '1.2.3.4',
      userAgent: 'ua',
      ...data,
    } as BulkJobData,
  } as Job<BulkJobData>;
}

describe('BulkUploadProcessor', () => {
  const prisma = {
    entry: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    project: { findUnique: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const storage = {
    getObjectBuffer: jest.fn(),
    putObject: jest.fn(),
    removeObject: jest.fn().mockResolvedValue(undefined),
  };
  const redis = {
    rpush: jest.fn(),
    expire: jest.fn(),
    hincrby: jest.fn(),
    hgetall: jest.fn(),
    hset: jest.fn(),
  };

  const settings = { getEntryPrefixes: jest.fn(() => ['62', '63', '67']) };

  const worker = new BulkUploadProcessor(
    prisma as unknown as PrismaService,
    storage as unknown as StorageService,
    redis as unknown as RedisService,
    settings as unknown as SettingsService,
  );

  const project = { id: 'p1', companyId: 'c1', code: 'REHAB', company: { id: 'c1', code: 2000 } };

  beforeEach(() => {
    jest.clearAllMocks();
    settings.getEntryPrefixes.mockReturnValue(['62', '63', '67']);
    storage.getObjectBuffer.mockResolvedValue(Buffer.from('%PDF-1.7 bytes'));
    prisma.entry.findUnique.mockResolvedValue(null);
    prisma.entry.findFirst.mockResolvedValue(null);
    prisma.project.findUnique.mockResolvedValue(project);
    prisma.entry.create.mockResolvedValue({ id: 'e1' });
    redis.hincrby.mockResolvedValue(1);
    redis.hgetall.mockResolvedValue({ total: '1', failed: '0', succeeded: '1' });
  });

  it('valid file creates the entry and records success', async () => {
    await worker.process(jobOf({}));
    expect(storage.putObject).toHaveBeenCalledWith(
      '2000/REHAB/2025/6200000000.pdf',
      expect.any(Buffer),
      'application/pdf',
    );
    expect(prisma.entry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ serial: '6200000000', typePrefix: '62', counter: 0 }),
      }),
    );
    expect(redis.rpush).toHaveBeenCalledWith(
      'bulk:job1:results',
      expect.stringContaining('"status":"ok"'),
    );
    expect(redis.hset).toHaveBeenCalledWith('bulk:job1', { status: 'done' });
    expect(storage.removeObject).toHaveBeenCalledWith('_temp/bulk/job1/f1.pdf');
  });

  it('prefix validation uses the DB-configured list', async () => {
    settings.getEntryPrefixes.mockReturnValue(['99']);
    await worker.process(jobOf({ originalName: '9900000000.pdf' }));
    expect(prisma.entry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ serial: '9900000000', typePrefix: '99' }),
      }),
    );
    await worker.process(jobOf({ originalName: '6200000000.pdf' }));
    expect(redis.rpush).toHaveBeenLastCalledWith(
      'bulk:job1:results',
      expect.stringContaining('"errorCode":"INVALID_FILENAME"'),
    );
  });

  it('duplicate serial records failure without creating', async () => {
    prisma.entry.findUnique.mockResolvedValue({ id: 'old' });
    await worker.process(jobOf({}));
    expect(prisma.entry.create).not.toHaveBeenCalled();
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(redis.rpush).toHaveBeenCalledWith(
      'bulk:job1:results',
      expect.stringContaining('DUPLICATE_SERIAL'),
    );
    expect(storage.removeObject).toHaveBeenCalled();
  });

  it('duplicate serial result carries existingEntryId', async () => {
    prisma.entry.findUnique.mockResolvedValue({ id: 'old-entry-9' });
    await worker.process(jobOf({}));
    const payload = redis.rpush.mock.calls[0]?.[1] as string;
    expect(JSON.parse(payload)).toMatchObject({
      status: 'error',
      errorCode: 'DUPLICATE_SERIAL',
      existingEntryId: 'old-entry-9',
    });
  });

  it('duplicate hash records failure', async () => {
    prisma.entry.findFirst.mockResolvedValue({ id: 'same-bytes' });
    await worker.process(jobOf({}));
    expect(prisma.entry.create).not.toHaveBeenCalled();
    expect(redis.rpush).toHaveBeenCalledWith(
      'bulk:job1:results',
      expect.stringContaining('DUPLICATE_FILE'),
    );
  });

  it('MinIO put failure records STORAGE_ERROR and still cleans temp', async () => {
    storage.putObject.mockRejectedValueOnce(new Error('s3 down'));
    await worker.process(jobOf({}));
    expect(prisma.entry.create).not.toHaveBeenCalled();
    expect(redis.rpush).toHaveBeenCalledWith(
      'bulk:job1:results',
      expect.stringContaining('STORAGE_ERROR'),
    );
    expect(storage.removeObject).toHaveBeenCalledWith('_temp/bulk/job1/f1.pdf');
  });

  it('non-last job does not flip status to done', async () => {
    redis.hincrby.mockResolvedValue(1);
    redis.hgetall.mockResolvedValue({ total: '2', failed: '0', succeeded: '1' });
    await worker.process(jobOf({}));
    expect(redis.hset).not.toHaveBeenCalled();
    expect(storage.removeObject).toHaveBeenCalled();
  });

  it('unique-constraint race maps P2002 to DUPLICATE_SERIAL', async () => {
    // Both jobs pass the app-level check; the loser hits the DB constraint.
    prisma.entry.findUnique.mockResolvedValue(null);
    prisma.entry.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.19.3',
      }),
    );
    prisma.entry.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'winner' });
    await worker.process(jobOf({}));
    const payload = redis.rpush.mock.calls[0]?.[1] as string;
    expect(JSON.parse(payload)).toMatchObject({
      status: 'error',
      errorCode: 'DUPLICATE_SERIAL',
      existingEntryId: 'winner',
    });
  });

  it('invalid magic bytes are rejected before hashing', async () => {
    storage.getObjectBuffer.mockResolvedValue(Buffer.from('MZ nope'));
    await worker.process(jobOf({}));
    expect(prisma.entry.create).not.toHaveBeenCalled();
    expect(redis.rpush).toHaveBeenCalledWith(
      'bulk:job1:results',
      expect.stringContaining('INVALID_MAGIC_BYTES'),
    );
  });
});
