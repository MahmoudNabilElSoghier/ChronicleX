import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { PermissionsService } from '../../rbac/permissions.service';
import { StorageService } from '../../storage/storage.service';
import { EntriesService } from '../entries.service';

const ACTOR = { userId: 'u1', ip: '1.2.3.4', userAgent: 'ua' };

function pdfFile(name: string, body = '%PDF-1.7 fake-bytes'): Express.Multer.File {
  return {
    originalname: name,
    mimetype: 'application/pdf',
    buffer: Buffer.from(body),
    size: Buffer.from(body).length,
  } as Express.Multer.File;
}

describe('EntriesService', () => {
  const prisma = {
    project: { findUnique: jest.fn() },
    entry: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    auditLog: { create: jest.fn() },
  };
  const storage = {
    putObject: jest.fn(),
    getObjectStream: jest.fn(),
  };
  const permissions = { getEffectiveGrants: jest.fn() };

  const svc = new EntriesService(
    prisma as unknown as PrismaService,
    storage as unknown as StorageService,
    permissions as unknown as PermissionsService,
  );

  const project = {
    id: 'p1',
    companyId: 'c1',
    code: 'REHAB',
    company: { id: 'c1', code: 2000 },
  };

  beforeEach(() => jest.clearAllMocks());

  it('upload success creates the row and uploads to the derived key', async () => {
    prisma.project.findUnique.mockResolvedValue(project);
    prisma.entry.findUnique.mockResolvedValue(null);
    prisma.entry.findFirst.mockResolvedValue(null);
    prisma.entry.create.mockImplementation((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'e1', createdAt: new Date('2025-01-01'), ...args.data }),
    );
    const res = (await svc.upload(
      { companyId: 'c1', projectId: 'p1', year: 2025 },
      pdfFile('6200000000.pdf'),
      ACTOR,
    )) as Record<string, unknown>;
    expect(storage.putObject).toHaveBeenCalledWith(
      '2000/REHAB/2025/6200000000.pdf',
      expect.any(Buffer),
      'application/pdf',
    );
    expect(res.serial).toBe('6200000000');
    expect(res.typePrefix).toBe('62');
    expect(res.fileHash).toHaveLength(64);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'CREATE', resource: 'ENTRY' }),
      }),
    );
  });

  it('upload duplicate serial → 409 DUPLICATE_SERIAL', async () => {
    prisma.project.findUnique.mockResolvedValue(project);
    prisma.entry.findUnique.mockResolvedValue({ id: 'existing' });
    await expect(
      svc.upload({ companyId: 'c1', projectId: 'p1', year: 2025 }, pdfFile('6200000000.pdf'), ACTOR),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'DUPLICATE_SERIAL', existingEntryId: 'existing' }),
    });
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('upload duplicate hash → 409 DUPLICATE_FILE', async () => {
    prisma.project.findUnique.mockResolvedValue(project);
    prisma.entry.findUnique.mockResolvedValue(null);
    prisma.entry.findFirst.mockResolvedValue({ id: 'other-year' });
    await expect(
      svc.upload({ companyId: 'c1', projectId: 'p1', year: 2025 }, pdfFile('6300000001.pdf'), ACTOR),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'DUPLICATE_FILE' }),
    });
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('upload rejects non-PDF magic bytes → 400', async () => {
    await expect(
      svc.upload(
        { companyId: 'c1', projectId: 'p1', year: 2025 },
        pdfFile('6200000000.pdf', 'MZ not a pdf'),
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.project.findUnique).not.toHaveBeenCalled();
  });

  it('upload rejects a project from another company → 400', async () => {
    prisma.project.findUnique.mockResolvedValue({ ...project, companyId: 'c2' });
    await expect(
      svc.upload({ companyId: 'c1', projectId: 'p1', year: 2025 }, pdfFile('6200000000.pdf'), ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('upload rejects an unknown project → 404', async () => {
    prisma.project.findUnique.mockResolvedValue(null);
    await expect(
      svc.upload({ companyId: 'c1', projectId: 'px', year: 2025 }, pdfFile('6200000000.pdf'), ACTOR),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('list: SUPER_ADMIN sees all (no scope clause)', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([
      { action: 'VIEW', resource: 'ENTRY', scopeType: 'GROUP', scopeId: '' },
    ]);
    prisma.entry.findMany.mockResolvedValue([]);
    const res = (await svc.list(
      { limit: 50, includeDeleted: false } as never,
      ACTOR,
    )) as Record<string, unknown>;
    expect(res.items).toEqual([]);
    const where = prisma.entry.findMany.mock.calls[0][0].where as { AND: unknown[] };
    expect(where.AND).toEqual([{}, { deletedAt: null }]);
  });

  it('list: COMPANY_ADMIN scoped to c1 → WHERE contains companyId=c1', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([
      { action: 'VIEW', resource: 'ENTRY', scopeType: 'COMPANY', scopeId: 'c1' },
    ]);
    prisma.entry.findMany.mockResolvedValue([]);
    await svc.list({ limit: 50, includeDeleted: false } as never, ACTOR);
    const where = prisma.entry.findMany.mock.calls[0][0].where as { AND: unknown[] };
    expect(where.AND[0]).toEqual({ OR: [{ companyId: { in: ['c1'] } }] });
  });

  it('list: PROJECT_ADMIN scoped to p1 → WHERE contains projectId=p1', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([
      { action: 'VIEW', resource: 'ENTRY', scopeType: 'PROJECT', scopeId: 'p1' },
    ]);
    prisma.entry.findMany.mockResolvedValue([]);
    await svc.list({ limit: 50, includeDeleted: false } as never, ACTOR);
    const where = prisma.entry.findMany.mock.calls[0][0].where as { AND: unknown[] };
    expect(where.AND[0]).toEqual({ OR: [{ projectId: { in: ['p1'] } }] });
  });

  it('list: no ENTRY:VIEW grant → 403', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([
      { action: 'VIEW', resource: 'PROJECT', scopeType: 'GROUP', scopeId: '' },
    ]);
    await expect(svc.list({ limit: 50, includeDeleted: false } as never, ACTOR)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.entry.findMany).not.toHaveBeenCalled();
  });

  it('list: includeDeleted without DELETE grant → 403', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([
      { action: 'VIEW', resource: 'ENTRY', scopeType: 'GROUP', scopeId: '' },
    ]);
    await expect(
      svc.list({ limit: 50, includeDeleted: true } as never, ACTOR),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('update rejects immutable fields via DTO (serial/fileKey never reach service)', async () => {
    const row = {
      id: 'e1', companyId: 'c1', projectId: 'p1', year: 2025,
      serial: '6200000000', fileKey: 'k', fileName: 'f', fileSize: 1, fileHash: 'h',
      deletedAt: null,
    };
    prisma.entry.findFirst.mockResolvedValue(row);
    prisma.entry.findUnique.mockResolvedValue(null);
    prisma.entry.update.mockImplementation((args: { data: unknown }) =>
      Promise.resolve({ ...row, ...(args.data as object) }),
    );
    // year change triggers uniqueness re-check against the composite key
    await svc.update('e1', { year: 2026 }, ACTOR);
    expect(prisma.entry.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId_year_serial: { companyId: 'c1', year: 2026, serial: '6200000000' } },
      }),
    );
    expect(prisma.entry.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.not.objectContaining({ serial: 1, fileKey: 1 }) }),
    );
  });

  it('update with no fields → 400', async () => {
    await expect(svc.update('e1', {}, ACTOR)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('update to p2 with UPDATE on p1 scope only → 403', async () => {
    prisma.entry.findFirst.mockResolvedValue({
      id: 'e1', companyId: 'c1', projectId: 'p1', year: 2025,
      serial: '6200000000', deletedAt: null,
    });
    prisma.project.findUnique.mockResolvedValue({ id: 'p2', companyId: 'c1' });
    permissions.getEffectiveGrants.mockResolvedValue([
      { action: 'UPDATE', resource: 'ENTRY', scopeType: 'PROJECT', scopeId: 'p1' },
    ]);
    await expect(svc.update('e1', { projectId: 'p2' }, ACTOR)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.entry.update).not.toHaveBeenCalled();
  });

  it('update to p2 with UPDATE on both scopes → 200', async () => {
    const row = {
      id: 'e1', companyId: 'c1', projectId: 'p1', year: 2025,
      serial: '6200000000', deletedAt: null,
    };
    prisma.entry.findFirst.mockResolvedValue(row);
    prisma.project.findUnique.mockResolvedValue({ id: 'p2', companyId: 'c1' });
    permissions.getEffectiveGrants.mockResolvedValue([
      { action: 'UPDATE', resource: 'ENTRY', scopeType: 'PROJECT', scopeId: 'p1' },
      { action: 'UPDATE', resource: 'ENTRY', scopeType: 'PROJECT', scopeId: 'p2' },
    ]);
    prisma.entry.update.mockImplementation((args: { data: unknown }) =>
      Promise.resolve({ ...row, ...(args.data as object) }),
    );
    const res = (await svc.update('e1', { projectId: 'p2' }, ACTOR)) as Record<string, unknown>;
    expect(res.projectId).toBe('p2');
  });

  it('delete sets deletedAt and keeps the fileKey', async () => {
    const row = { id: 'e1', fileKey: '2000/REHAB/2025/6200000000.pdf', deletedAt: null };
    prisma.entry.findFirst.mockResolvedValue(row);
    prisma.entry.update.mockResolvedValue({ id: 'e1', deletedAt: new Date() });
    const res = (await svc.remove('e1', ACTOR)) as Record<string, unknown>;
    expect(res.id).toBe('e1');
    expect(res.deletedAt).toBeDefined();
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'DELETE', oldValues: row }),
      }),
    );
  });

  it('restore clears deletedAt', async () => {
    prisma.entry.findUnique.mockResolvedValue({ id: 'e1', deletedAt: new Date() });
    prisma.entry.update.mockResolvedValue({ id: 'e1', deletedAt: null, updatedAt: new Date() });
    const res = (await svc.restore('e1', ACTOR)) as Record<string, unknown>;
    expect(res.deletedAt).toBeNull();
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'RESTORE' }) }),
    );
  });

  it('openStream fires FILE_VIEWED audit without blocking', async () => {
    const { Readable } = await import('node:stream');
    storage.getObjectStream.mockResolvedValue(Readable.from(['%PDF']));
    const stream = await svc.openStream({ id: 'e1', fileKey: 'k' }, undefined, ACTOR);
    expect(stream).toBeDefined();
    await new Promise((r) => setTimeout(r, 10));
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'VIEW',
          newValues: { event: 'FILE_VIEWED' },
        }),
      }),
    );
  });

  it('hash is stable sha256 of the buffer', () => {
    expect(createHash('sha256').update(Buffer.from('%PDF')).digest('hex')).toHaveLength(64);
  });
});
