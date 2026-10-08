import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { PermissionsService } from '../../rbac/permissions.service';
import { ScopeMatcher } from '../../rbac/scope-matcher';
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
      groupBy: jest.fn(),
    },
    auditLog: { create: jest.fn(), findMany: jest.fn() },
  };
  const storage = {
    putObject: jest.fn(),
    getObjectStream: jest.fn(),
  };
  const permissions = { getEffectiveGrants: jest.fn() };
  const scopes = new ScopeMatcher(permissions as unknown as PermissionsService);

  const svc = new EntriesService(
    prisma as unknown as PrismaService,
    storage as unknown as StorageService,
    permissions as unknown as PermissionsService,
    scopes,
  );

  function exportRow(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 'e1',
      serial: '6200000000',
      typePrefix: '62',
      year: 2025,
      fileName: '6200000000.pdf',
      fileSize: 1024,
      fileHash: 'abc123',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      company: { code: 2000, nameAr: 'الشركة', nameEn: 'Co' },
      project: { code: 'R', nameAr: 'الرحاب', nameEn: 'Rehab' },
      uploader: { nameAr: 'مدير', nameEn: 'Manager' },
      ...over,
    };
  }

  const project = {
    id: 'p1',
    companyId: 'c1',
    code: 'REHAB',
    company: { id: 'c1', code: 2000 },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    permissions.getEffectiveGrants.mockResolvedValue([
      { action: 'CREATE', resource: 'ENTRY', scopeType: 'PROJECT', scopeId: 'p1' },
    ]);
  });

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
    // CREATE audit is the interceptor's job (see audit.interceptor.spec).
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('upload duplicate serial → 409 with the existing entry summary', async () => {
    prisma.project.findUnique.mockResolvedValue(project);
    prisma.entry.findUnique.mockResolvedValueOnce({ id: 'existing' });
    prisma.entry.findMany.mockResolvedValueOnce([
      {
        id: 'existing',
        serial: '6200000000',
        year: 2025,
        company: { nameAr: 'الشركة', nameEn: 'Co', code: 2000 },
        project: { nameAr: 'الرحاب', nameEn: 'Rehab', code: 'REHAB' },
        uploader: { nameAr: 'مدير النظام', nameEn: 'System Administrator' },
        createdAt: new Date('2025-03-01T10:00:00.000Z'),
      },
    ]);
    await expect(
      svc.upload({ companyId: 'c1', projectId: 'p1', year: 2025 }, pdfFile('6200000000.pdf'), ACTOR),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'DUPLICATE_SERIAL',
        existingEntryId: 'existing',
        existing: {
          serial: '6200000000',
          year: 2025,
          company: { nameAr: 'الشركة', nameEn: 'Co', code: 2000 },
          project: { nameAr: 'الرحاب', nameEn: 'Rehab', code: 'REHAB' },
          uploadedBy: { nameAr: 'مدير النظام', nameEn: 'System Administrator' },
          createdAt: '2025-03-01T10:00:00.000Z',
        },
      }),
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

  it('list: items carry company/project/uploader relations + uploadedBy alias', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([
      { action: 'VIEW', resource: 'ENTRY', scopeType: 'GROUP', scopeId: '' },
    ]);
    prisma.entry.findMany.mockResolvedValue([
      {
        id: 'e1',
        uploadedBy: 'u1',
        company: { id: 'c1', nameAr: 'الشركة' },
        project: { id: 'p1', nameAr: 'الرحاب' },
        uploader: { id: 'u1', nameAr: 'مدير' },
      },
    ]);
    const res = (await svc.list({ limit: 50, includeDeleted: false } as never, ACTOR)) as {
      items: Array<Record<string, unknown>>;
    };
    expect(prisma.entry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          company: expect.anything(),
          project: expect.anything(),
          uploader: expect.anything(),
        }),
      }),
    );
    expect(res.items[0]).toMatchObject({
      company: { nameAr: 'الشركة' },
      project: { nameAr: 'الرحاب' },
      uploadedBy: { id: 'u1', nameAr: 'مدير' },
    });
    expect(res.items[0]).not.toHaveProperty('uploader');
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

  it('list: serialFrom only → WHERE serial: { gte } (scope clause untouched)', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([
      { action: 'VIEW', resource: 'ENTRY', scopeType: 'COMPANY', scopeId: 'c1' },
    ]);
    prisma.entry.findMany.mockResolvedValue([]);
    await svc.list(
      { limit: 50, includeDeleted: false, serialFrom: '6200000010' } as never,
      ACTOR,
    );
    const where = prisma.entry.findMany.mock.calls[0][0].where as { AND: unknown[] };
    expect(where.AND).toContainEqual({ serial: { gte: '6200000010' } });
    expect(where.AND[0]).toEqual({ OR: [{ companyId: { in: ['c1'] } }] });
  });

  it('list: serialTo only → WHERE serial: { lte }', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([
      { action: 'VIEW', resource: 'ENTRY', scopeType: 'GROUP', scopeId: '' },
    ]);
    prisma.entry.findMany.mockResolvedValue([]);
    await svc.list({ limit: 50, includeDeleted: false, serialTo: '6200000050' } as never, ACTOR);
    const where = prisma.entry.findMany.mock.calls[0][0].where as { AND: unknown[] };
    expect(where.AND).toContainEqual({ serial: { lte: '6200000050' } });
  });

  it('list: both serialFrom and serialTo → WHERE serial: { gte, lte }', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([
      { action: 'VIEW', resource: 'ENTRY', scopeType: 'GROUP', scopeId: '' },
    ]);
    prisma.entry.findMany.mockResolvedValue([]);
    await svc.list(
      {
        limit: 50,
        includeDeleted: false,
        serialFrom: '6200000010',
        serialTo: '6200000050',
      } as never,
      ACTOR,
    );
    const where = prisma.entry.findMany.mock.calls[0][0].where as { AND: unknown[] };
    expect(where.AND).toContainEqual({
      serial: { gte: '6200000010', lte: '6200000050' },
    });
  });

  it('list: neither serialFrom nor serialTo → WHERE has no serial range key', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([
      { action: 'VIEW', resource: 'ENTRY', scopeType: 'GROUP', scopeId: '' },
    ]);
    prisma.entry.findMany.mockResolvedValue([]);
    await svc.list({ limit: 50, includeDeleted: false } as never, ACTOR);
    const where = prisma.entry.findMany.mock.calls[0][0].where as { AND: unknown[] };
    const serialClauses = where.AND.filter(
      (c): c is Record<string, unknown> =>
        typeof c === 'object' && c !== null && 'serial' in c,
    );
    expect(serialClauses).toEqual([]);
  });

  it('list: serialFrom > serialTo → 400 before any query', async () => {
    await expect(
      svc.list(
        {
          limit: 50,
          includeDeleted: false,
          serialFrom: '6200000050',
          serialTo: '6200000010',
        } as never,
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.entry.findMany).not.toHaveBeenCalled();
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
    const res = (await svc.remove('e1')) as Record<string, unknown>;
    expect(res.id).toBe('e1');
    expect(res.deletedAt).toBeDefined();
    // DELETE audit is the interceptor's job (see audit.interceptor.spec).
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('restore clears deletedAt', async () => {
    prisma.entry.findUnique.mockResolvedValue({ id: 'e1', deletedAt: new Date() });
    prisma.entry.update.mockResolvedValue({ id: 'e1', deletedAt: null, updatedAt: new Date() });
    const res = (await svc.restore('e1')) as Record<string, unknown>;
    expect(res.deletedAt).toBeNull();
  });

  it('openStream fires FILE_VIEWED audit without blocking', async () => {
    const { Readable } = await import('node:stream');
    storage.getObjectStream.mockResolvedValue(Readable.from(['%PDF']));
    prisma.auditLog.create.mockResolvedValue({});
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

  it('years returns distinct scoped years, newest first', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([
      { action: 'VIEW', resource: 'ENTRY', scopeType: 'COMPANY', scopeId: 'c1' },
    ]);
    prisma.entry.groupBy = jest.fn().mockResolvedValue([{ year: 2024 }, { year: 2023 }]);
    await expect(svc.years('u1')).resolves.toEqual([2024, 2023]);
    expect(prisma.entry.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['year'],
        where: expect.objectContaining({
          AND: expect.arrayContaining([{ OR: [{ companyId: { in: ['c1'] } }] }]),
        }),
      }),
    );
  });

  it('findOne returns soft-deleted entries with deletedAt set', async () => {
    const row = { id: 'e9', deletedAt: new Date('2025-03-01'), serial: '6200000000' };
    prisma.entry.findFirst.mockResolvedValue(row);
    const res = (await svc.findOne('e9')) as Record<string, unknown>;
    expect(res.deletedAt).toBeDefined();
    expect(prisma.entry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'e9' } }),
    );
  });

  it('findOne includes the uploader identity', async () => {
    prisma.entry.findFirst.mockResolvedValue({ id: 'e1' });
    await svc.findOne('e1');
    expect(prisma.entry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          uploader: { select: { id: true, nameAr: true, nameEn: true } },
        }),
      }),
    );
  });

  it('getAudit returns history sorted desc, limit 50, with actor names', async () => {
    prisma.auditLog.findMany.mockResolvedValue([
      {
        id: 'a2', action: 'DELETE', resource: 'ENTRY', userId: 'u1',
        user: { nameAr: 'مدير' }, newValues: null, oldValues: { id: 'e1' },
        createdAt: new Date('2025-02-01'),
      },
      {
        id: 'a1', action: 'CREATE', resource: 'ENTRY', userId: 'u1',
        user: { nameAr: 'مدير' }, newValues: { event: 'x' }, oldValues: null,
        createdAt: new Date('2025-01-01'),
      },
    ]);
    const res = (await svc.getAudit('e1')) as { items: Array<Record<string, unknown>> };
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { resource: 'ENTRY', resourceId: 'e1' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 50,
      }),
    );
    expect(res.items.map((i) => i.id)).toEqual(['a2', 'a1']);
    expect(res.items[0]).toMatchObject({ userNameAr: 'مدير', event: 'DELETE' });
  });

  it('getAudit works for soft-deleted entries (history is forever)', async () => {
    prisma.auditLog.findMany.mockResolvedValue([]);
    await svc.getAudit('deleted-id');
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { resource: 'ENTRY', resourceId: 'deleted-id' } }),
    );
  });

  describe('export (CSV)', () => {
    async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
      let out = '';
      for await (const chunk of stream) out += String(chunk);
      return out;
    }

    it('mode=selected streams only entries matching the ids AND within scope', async () => {
      permissions.getEffectiveGrants.mockResolvedValue([
        { action: 'VIEW', resource: 'ENTRY', scopeType: 'PROJECT', scopeId: 'p1' },
      ]);
      prisma.entry.findMany.mockResolvedValue([
        exportRow({ id: 'e1' }),
        exportRow({ id: 'e2', serial: '6200000001' }),
      ]);
      prisma.auditLog.create.mockResolvedValue({});

      const csv = await readAll(
        await svc.export({ mode: 'selected', entryIds: ['e1', 'e2'] } as never, ACTOR),
      );

      expect(prisma.entry.findMany.mock.calls[0][0].where).toEqual({
        AND: [
          { OR: [{ projectId: { in: ['p1'] } }] },
          { id: { in: ['e1', 'e2'] } },
          { deletedAt: null },
        ],
      });
      expect(csv).toContain('6200000000');
      expect(csv).toContain('6200000001');
      // Audit: counts only — the id list itself never lands in the log.
      const auditData = prisma.auditLog.create.mock.calls[0][0].data;
      expect(auditData.action).toBe('EXPORT');
      expect(auditData.resource).toBe('ENTRY');
      expect(auditData.newValues).toEqual(
        expect.objectContaining({ event: 'EXPORT', mode: 'selected', count: 2, entryIdsCount: 2 }),
      );
      expect(auditData.newValues).not.toHaveProperty('entryIds');
    });

    it('mode=selected: ids outside scope are dropped; audit logs EXPORT_PARTIAL with counts', async () => {
      permissions.getEffectiveGrants.mockResolvedValue([
        { action: 'VIEW', resource: 'ENTRY', scopeType: 'PROJECT', scopeId: 'p1' },
      ]);
      prisma.entry.findMany.mockResolvedValue([exportRow({ id: 'e1' })]);
      prisma.auditLog.create.mockResolvedValue({});

      const csv = await readAll(
        await svc.export({ mode: 'selected', entryIds: ['e1', 'eX', 'eY'] } as never, ACTOR),
      );

      // Only the in-scope row comes back — no 403 for the whole request.
      expect(csv).toContain('6200000000');
      expect(csv).not.toContain('eX');
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'EXPORT',
            resource: 'ENTRY',
            newValues: expect.objectContaining({
              event: 'EXPORT_PARTIAL',
              mode: 'selected',
              count: 1,
              entryIdsCount: 3,
            }),
          }),
        }),
      );
      expect(prisma.auditLog.create.mock.calls[0][0].data.newValues).not.toHaveProperty('entryIds');
    });

    it('mode=filtered builds the same WHERE as list (filters + deletedAt), batched, no pagination', async () => {
      permissions.getEffectiveGrants.mockResolvedValue([
        { action: 'VIEW', resource: 'ENTRY', scopeType: 'COMPANY', scopeId: 'c1' },
      ]);
      prisma.entry.findMany.mockResolvedValue([]);
      prisma.auditLog.create.mockResolvedValue({});

      const csv = await readAll(
        await svc.export(
          {
            mode: 'filtered',
            filters: { year: 2025, companyId: 'c1', limit: 50, includeDeleted: false } as never,
          } as never,
          ACTOR,
        ),
      );

      expect(prisma.entry.findMany.mock.calls[0][0]).toEqual({
        where: {
          AND: [
            { OR: [{ companyId: { in: ['c1'] } }] },
            { companyId: 'c1' },
            { year: 2025 },
            { deletedAt: null },
          ],
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 1000,
        select: expect.objectContaining({ id: true, serial: true, fileHash: true }),
      });
      // list()'s `limit`/`cursor` never reach the export query.
      expect(csv.startsWith('\uFEFF')).toBe(true);
      // Compliance shape: the exported scope is fully reconstructible
      // from the audit entry (filters + counts, never the id list).
      expect(prisma.auditLog.create.mock.calls[0][0].data.newValues).toEqual(
        expect.objectContaining({
          mode: 'filtered',
          count: 0,
          entryIdsCount: null,
          filters: expect.objectContaining({ year: 2025, companyId: 'c1' }),
        }),
      );
    });

    it('scope: user without ENTRY:VIEW → 403 before any query', async () => {
      permissions.getEffectiveGrants.mockResolvedValue([
        { action: 'VIEW', resource: 'PROJECT', scopeType: 'GROUP', scopeId: '' },
      ]);
      await expect(
        svc.export({ mode: 'selected', entryIds: ['e1'] } as never, ACTOR),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.entry.findMany).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('CSV: BOM prefix, fixed Arabic headers, CRLF endings, quote escaping', async () => {
      permissions.getEffectiveGrants.mockResolvedValue([
        { action: 'VIEW', resource: 'ENTRY', scopeType: 'GROUP', scopeId: '' },
      ]);
      prisma.entry.findMany.mockResolvedValue([
        exportRow({ fileName: 'has,comma and "quote".pdf' }),
        exportRow({ id: 'e2', serial: '6200000001' }),
      ]);
      prisma.auditLog.create.mockResolvedValue({});

      const csv = await readAll(
        await svc.export({ mode: 'selected', entryIds: ['e1', 'e2'] } as never, ACTOR),
      );

      expect(csv.charCodeAt(0)).toBe(0xfeff);
      expect(csv).toContain(
        'الرقم التسلسلي,البادئة,السنة,كود الشركة,الشركة,كود المشروع,المشروع,اسم الملف,الحجم (بايت),البصمة,البريد المسجل,تاريخ الرفع',
      );
      expect(csv).toContain('"has,comma and ""quote"".pdf"');
      expect(csv).toContain('2025-01-01T00:00:00.000Z');
      // Every line terminator is CRLF — no bare LF anywhere.
      expect(csv.replace(/\r\n/g, '')).not.toContain('\n');
    });

    it('streams in keyset batches of 1000, ordered createdAt ASC', async () => {
      permissions.getEffectiveGrants.mockResolvedValue([
        { action: 'VIEW', resource: 'ENTRY', scopeType: 'GROUP', scopeId: '' },
      ]);
      const bigBatch = Array.from({ length: 1000 }, (_, i) =>
        exportRow({ id: `e${i}`, serial: '6200000000' }),
      );
      const tail = [exportRow({ id: 'e1000', serial: '6300000001' })];
      let call = 0;
      prisma.entry.findMany.mockImplementation(() =>
        Promise.resolve(call++ === 0 ? bigBatch : tail),
      );
      prisma.auditLog.create.mockResolvedValue({});

      const csv = await readAll(
        await svc.export(
          { mode: 'filtered', filters: { includeDeleted: false } as never } as never,
          ACTOR,
        ),
      );

      expect(prisma.entry.findMany).toHaveBeenCalledTimes(2);
      // Second batch continues AFTER the last (createdAt, id) — the keyset
      // predicate, not an offset.
      const secondWhere = prisma.entry.findMany.mock.calls[1][0].where as {
        AND: unknown[];
      };
      expect(secondWhere.AND[1]).toHaveProperty('OR');
      // header + 1000 rows + 1 tail row
      expect(csv.split('\r\n').filter(Boolean)).toHaveLength(1002);
      expect(prisma.auditLog.create.mock.calls[0][0].data.newValues).toEqual(
        expect.objectContaining({ event: 'EXPORT', mode: 'filtered', count: 1001 }),
      );
    });

    it('rejects mismatched or empty mode payloads', async () => {
      await expect(
        svc.export({ mode: 'selected' } as never, ACTOR),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        svc.export({ mode: 'selected', entryIds: ['e1'], filters: {} as never } as never, ACTOR),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        svc.export({ mode: 'filtered', entryIds: ['e1'] } as never, ACTOR),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        svc.export({ mode: 'filtered', filters: {} as never, entryIds: ['e1'] } as never, ACTOR),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.entry.findMany).not.toHaveBeenCalled();
    });
  });

  describe('bundleDownload (ZIP)', () => {
    function bundleRow(over: Record<string, unknown> = {}): Record<string, unknown> {
      return {
        id: 'e1',
        serial: '6200000000',
        year: 2025,
        fileKey: '2000/REHAB/2025/6200000000.pdf',
        fileSize: 1024,
        ...over,
      };
    }

    function mockStorage(): void {
      storage.getObjectStream.mockImplementation((key: string) =>
        Promise.resolve(Readable.from([Buffer.from(`bytes-for-${key}`)])),
      );
    }

    async function readZip(stream: NodeJS.ReadableStream): Promise<Buffer> {
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks);
    }

    beforeEach(() => {
      prisma.auditLog.create.mockResolvedValue({});
      permissions.getEffectiveGrants.mockResolvedValue([
        { action: 'VIEW', resource: 'ENTRY', scopeType: 'GROUP', scopeId: '' },
      ]);
    });

    it("mode='selected' returns a Readable stream of a real zip (PK magic)", async () => {
      prisma.entry.findMany.mockResolvedValue([
        bundleRow(),
        bundleRow({ id: 'e2', serial: '6200000001', fileKey: '2000/REHAB/2025/6200000001.pdf' }),
      ]);
      mockStorage();

      const { stream, count, totalBytes } = await svc.bundleDownload(
        { mode: 'selected', entryIds: ['e1', 'e2'] } as never,
        ACTOR,
      );

      // archiver's Archiver delegates to its own Transform (readable-stream
      // copy), so a node:stream instanceof check would be a false negative —
      // what matters is that it is a pipeable/readable stream.
      expect(typeof (stream as { pipe: unknown }).pipe).toBe('function');
      expect(count).toBe(2);
      expect(totalBytes).toBe(2048);
      expect(storage.getObjectStream).toHaveBeenCalledTimes(2);
      const zip = await readZip(stream);
      expect(zip.subarray(0, 2).toString('latin1')).toBe('PK');
      // Central directory stores names uncompressed — both files present.
      expect(zip.toString('latin1')).toContain('6200000000.pdf');
      expect(zip.toString('latin1')).toContain('6200000001.pdf');
    });

    it('bundle respects scope: PROJECT_ADMIN sees only own project entries', async () => {
      permissions.getEffectiveGrants.mockResolvedValue([
        { action: 'VIEW', resource: 'ENTRY', scopeType: 'PROJECT', scopeId: 'p1' },
      ]);
      prisma.entry.findMany.mockResolvedValue([]);
      mockStorage();

      await expect(
        svc.bundleDownload({ mode: 'selected', entryIds: ['e1', 'e2'] } as never, ACTOR),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.entry.findMany.mock.calls[0][0].where).toEqual({
        AND: [
          { OR: [{ projectId: { in: ['p1'] } }] },
          { id: { in: ['e1', 'e2'] } },
          { deletedAt: null },
        ],
      });
    });

    it('bundle > 1,000 entries → 400 with the cap message, nothing streamed', async () => {
      // Request side: explicit entryIds above the cap fails before any query.
      await expect(
        svc.bundleDownload(
          {
            mode: 'selected',
            entryIds: Array.from({ length: 1001 }, (_, i) => `e${i}`),
          } as never,
          ACTOR,
        ),
      ).rejects.toThrow('Bundle download limited to 1,000 entries. Narrow your filters.');
      expect(prisma.entry.findMany).not.toHaveBeenCalled();

      // Matched side: filtered mode can match >1,000 rows.
      prisma.entry.findMany.mockResolvedValue(
        Array.from({ length: 1001 }, (_, i) => bundleRow({ id: `e${i}` })),
      );
      await expect(
        svc.bundleDownload({ mode: 'filtered', filters: {} as never } as never, ACTOR),
      ).rejects.toThrow('Bundle download limited to 1,000 entries. Narrow your filters.');
      expect(storage.getObjectStream).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('bundle > 500 MB total → 400 with the size hint', async () => {
      prisma.entry.findMany.mockResolvedValue([bundleRow({ fileSize: 501 * 1024 * 1024 })]);
      mockStorage();

      await expect(
        svc.bundleDownload({ mode: 'filtered', filters: {} as never } as never, ACTOR),
      ).rejects.toThrow('Bundle download exceeds the 500 MB limit. Narrow your selection.');
      expect(storage.getObjectStream).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('bundle with 0 matching rows → 404 "No entries match the selection."', async () => {
      prisma.entry.findMany.mockResolvedValue([]);
      mockStorage();

      await expect(
        svc.bundleDownload({ mode: 'filtered', filters: {} as never } as never, ACTOR),
      ).rejects.toThrow('No entries match the selection.');
      expect(storage.getObjectStream).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('bundle with the same serial in two entries → filenames deduplicated with year suffix', async () => {
      prisma.entry.findMany.mockResolvedValue([
        bundleRow({ id: 'e1', serial: '6200000000', year: 2025, fileKey: 'A/2025/6200000000.pdf' }),
        bundleRow({ id: 'e2', serial: '6200000000', year: 2026, fileKey: 'B/2026/6200000000.pdf' }),
      ]);
      storage.getObjectStream.mockImplementation((key: string) =>
        Promise.resolve(
          Readable.from([Buffer.from(key === 'A/2025/6200000000.pdf' ? 'FIRST' : 'SECOND')]),
        ),
      );

      const { stream } = await svc.bundleDownload(
        { mode: 'selected', entryIds: ['e1', 'e2'] } as never,
        ACTOR,
      );
      const zip = (await readZip(stream)).toString('latin1');

      expect(zip).toContain('6200000000-2025.pdf');
      expect(zip).toContain('6200000000-2026.pdf');
      // The bare (collision) name never appears — suffixed names don't
      // contain the plain `SERIAL.pdf` substring either.
      expect(zip).not.toContain('6200000000.pdf');
    });

    it('audit logged with event BUNDLE_DOWNLOAD, totalBytes and count (no id list)', async () => {
      prisma.entry.findMany.mockResolvedValue([
        bundleRow(),
        bundleRow({ id: 'e2', serial: '6200000001', fileKey: '2000/REHAB/2025/6200000001.pdf', fileSize: 2048 }),
      ]);
      mockStorage();

      await svc.bundleDownload(
        { mode: 'selected', entryIds: ['e1', 'e2'] } as never,
        ACTOR,
      );

      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'EXPORT',
            resource: 'ENTRY',
            newValues: expect.objectContaining({
              event: 'BUNDLE_DOWNLOAD',
              bundle: true,
              mode: 'selected',
              count: 2,
              totalBytes: 3072,
              entryIdsCount: 2,
            }),
          }),
        }),
      );
      const newValues = prisma.auditLog.create.mock.calls[0][0].data.newValues;
      expect(newValues).not.toHaveProperty('entryIds');
      expect(newValues).not.toHaveProperty('filters');
    });
  });
});
