import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsService } from '../rbac/permissions.service';
import { ScopeMatcher } from '../rbac/scope-matcher';
import { StorageService } from '../storage/storage.service';
import type { ListEntriesDto } from './dto/list-entries.dto';
import type { UpdateEntryDto } from './dto/update-entry.dto';
import type { UploadEntryDto } from './dto/upload-entry.dto';
import { parseSerialFromFilename, validatePdfMagicBytes } from './serial.utils';

export interface Actor {
  userId: string;
  ip: string | null;
  userAgent: string | null;
}

@Injectable()
export class EntriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly permissions: PermissionsService,
    private readonly scopes: ScopeMatcher,
  ) {}

  /** Grant-scoped WHERE for list queries. GROUP ENTRY:VIEW skips the clause. */
  async buildScopeWhere(userId: string): Promise<Prisma.EntryWhereInput> {
    return this.scopes.buildEntryWhere(userId);
  }

  /** Distinct entry years visible to the caller, newest first. */
  async years(userId: string): Promise<number[]> {
    const where = { AND: [await this.buildScopeWhere(userId), { deletedAt: null }] };
    const rows = await this.prisma.entry.groupBy({
      by: ['year'],
      where,
      orderBy: { year: 'desc' },
    });
    return rows.map((r) => r.year);
  }

  /** Audit history for one entry (historical — includes deleted rows). */
  async getAudit(id: string): Promise<Record<string, unknown>> {
    const rows = await this.prisma.auditLog.findMany({
      where: { resource: 'ENTRY', resourceId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
      include: { user: { select: { nameAr: true } } },
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        action: r.action,
        resource: r.resource,
        userId: r.userId,
        userNameAr: r.user?.nameAr ?? null,
        event:
          r.newValues !== null &&
          typeof r.newValues === 'object' &&
          !Array.isArray(r.newValues) &&
          typeof (r.newValues as Record<string, unknown>).event === 'string'
            ? (r.newValues as Record<string, unknown>).event
            : r.action,
        createdAt: r.createdAt,
        oldValues: r.oldValues,
        newValues: r.newValues,
      })),
    };
  }

  async upload(
    dto: UploadEntryDto,
    file: Express.Multer.File | undefined,
    actor: Actor,
  ): Promise<Record<string, unknown>> {
    if (!file) {
      throw new BadRequestException('PDF file is required');
    }
    if (!validatePdfMagicBytes(file.buffer)) {
      throw new BadRequestException('File content is not a valid PDF');
    }
    const { serial, typePrefix, counter } = parseSerialFromFilename(file.originalname);

    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
      include: { company: true },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }
    if (project.companyId !== dto.companyId) {
      throw new BadRequestException('Project does not belong to the given company');
    }
    // Service-level CREATE check: multipart bodies are parsed after guards run,
    // so the route guard cannot see projectId. Enforcement lives here.
    const mayCreate = await this.scopes.canAccess(actor.userId, 'CREATE', 'ENTRY', {
      projectId: project.id,
      companyId: project.companyId,
    });
    if (!mayCreate) {
      throw new ForbiddenException('Insufficient permissions');
    }

    const fileHash = createHash('sha256').update(file.buffer).digest('hex');

    const dupe = await this.prisma.entry.findUnique({
      where: { companyId_year_serial: { companyId: dto.companyId, year: dto.year, serial } },
      select: { id: true },
    });
    if (dupe) {
      throw new ConflictException({
        code: 'DUPLICATE_SERIAL',
        message: 'Serial already exists for this company and year',
        existingEntryId: dupe.id,
      });
    }
    const dupeFile = await this.prisma.entry.findFirst({
      where: { fileHash, deletedAt: null },
      select: { id: true },
    });
    if (dupeFile) {
      throw new ConflictException({
        code: 'DUPLICATE_FILE',
        message: 'Identical file already archived',
        existingEntryId: dupeFile.id,
      });
    }

    const fileKey = `${project.company.code}/${project.code}/${dto.year}/${serial}.pdf`;
    await this.storage.putObject(fileKey, file.buffer, 'application/pdf');

    const entry = await this.prisma.entry.create({
      data: {
        companyId: dto.companyId,
        projectId: dto.projectId,
        year: dto.year,
        serial,
        typePrefix,
        counter,
        fileKey,
        fileName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
        fileHash,
        uploadedBy: actor.userId,
      },
    });
    return {
      id: entry.id,
      companyId: entry.companyId,
      projectId: entry.projectId,
      year: entry.year,
      serial: entry.serial,
      typePrefix: entry.typePrefix,
      counter: entry.counter,
      fileName: entry.fileName,
      fileSize: entry.fileSize,
      mimeType: entry.mimeType,
      fileHash: entry.fileHash,
      createdAt: entry.createdAt,
    };
  }

  async list(query: ListEntriesDto, actor: Actor): Promise<Record<string, unknown>> {
    if (query.serialFrom && query.serialTo && query.serialFrom > query.serialTo) {
      throw new BadRequestException('serialFrom must be less than or equal to serialTo');
    }
    const scopeWhere = await this.buildScopeWhere(actor.userId);

    if (query.includeDeleted) {
      const grants = await this.permissions.getEffectiveGrants(actor.userId);
      const canSeeDeleted = grants.some((g) => g.action === 'DELETE' && g.resource === 'ENTRY');
      if (!canSeeDeleted) {
        throw new ForbiddenException('Insufficient permissions');
      }
    }

    const and: Prisma.EntryWhereInput[] = [scopeWhere];
    if (query.companyId) and.push({ companyId: query.companyId });
    if (query.projectId) and.push({ projectId: query.projectId });
    if (query.year !== undefined) and.push({ year: query.year });
    if (query.typePrefix) and.push({ typePrefix: query.typePrefix });
    if (query.serial) and.push({ serial: query.serial });
    if (query.serialFrom || query.serialTo) {
      // Serials are VARCHAR(10) zero-padded digits: lexicographic order
      // matches numeric order, so gte/lte on strings is exact.
      and.push({
        serial: {
          ...(query.serialFrom ? { gte: query.serialFrom } : {}),
          ...(query.serialTo ? { lte: query.serialTo } : {}),
        },
      });
    }
    if (query.q) and.push({ fileName: { contains: query.q, mode: 'insensitive' } });
    if (!query.includeDeleted) and.push({ deletedAt: null });

    const limit = query.limit;
    const rows = await this.prisma.entry.findMany({
      where: { AND: and },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: limit + 1,
      include: {
        company: { select: { id: true, code: true, nameAr: true, nameEn: true } },
        project: { select: { id: true, code: true, nameAr: true, nameEn: true } },
        uploader: { select: { id: true, nameAr: true, nameEn: true } },
      },
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    // API contract names the relation `uploadedBy` (the Prisma relation is
    // `uploader`; the raw FK string must never leak to clients).
    const items = page.map(({ uploader, ...rest }) => ({ ...rest, uploadedBy: uploader }));
    const last = items.length > 0 ? items[items.length - 1] : undefined;
    return {
      items,
      nextCursor: hasMore && last ? last.id : null,
      hasMore,
    };
  }

  async findOne(id: string): Promise<Record<string, unknown>> {
    // Soft-deleted rows ARE returned (deletedAt visible): the detail page
    // renders its deleted banner + restore action from this payload.
    // File access stays blocked — see getStreamTarget().
    const entry = await this.prisma.entry.findFirst({
      where: { id },
      include: {
        company: { select: { code: true, nameAr: true, nameEn: true } },
        project: { select: { code: true, nameAr: true, nameEn: true } },
        uploader: { select: { id: true, nameAr: true, nameEn: true } },
      },
    });
    if (!entry) {
      throw new NotFoundException('Entry not found');
    }
    const { uploader, ...rest } = entry;
    return { ...rest, uploadedBy: uploader } as unknown as Record<string, unknown>;
  }

  async getStreamTarget(id: string): Promise<{ id: string; fileKey: string; fileSize: number; serial: string }> {
    const entry = await this.prisma.entry.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, fileKey: true, fileSize: true, serial: true },
    });
    if (!entry) {
      throw new NotFoundException('Entry not found');
    }
    return entry;
  }

  async openStream(
    target: { id: string; fileKey: string },
    range: { start: number; end?: number } | undefined,
    actor: Actor,
  ): Promise<NodeJS.ReadableStream> {
    const stream = await this.storage.getObjectStream(target.fileKey, range);
    // Manual audit (documented exception): streaming starts after the response
    // begins, so the interceptor cannot bracket it. Fire-and-forget.
    await this.prisma.auditLog
      .create({
        data: {
          userId: actor.userId,
          action: 'VIEW',
          resource: 'ENTRY',
          resourceId: target.id,
          newValues: { event: 'FILE_VIEWED' },
          ipAddress: actor.ip,
          userAgent: actor.userAgent,
        },
      })
      .catch(() => undefined);
    return stream;
  }

  async update(id: string, dto: UpdateEntryDto, actor: Actor): Promise<Record<string, unknown>> {
    if (dto.projectId === undefined && dto.year === undefined) {
      throw new BadRequestException('At least one of projectId or year is required');
    }
    const entry = await this.prisma.entry.findFirst({ where: { id, deletedAt: null } });
    if (!entry) {
      throw new NotFoundException('Entry not found');
    }

    const data: { projectId?: string; year?: number } = {};
    if (dto.projectId !== undefined && dto.projectId !== entry.projectId) {
      const project = await this.prisma.project.findUnique({ where: { id: dto.projectId } });
      if (!project) {
        throw new NotFoundException('Project not found');
      }
      if (project.companyId !== entry.companyId) {
        throw new BadRequestException('Project does not belong to the entry company');
      }
      const mayMove = await this.scopes.canAccess(actor.userId, 'UPDATE', 'ENTRY', {
        projectId: project.id,
        companyId: project.companyId,
      });
      if (!mayMove) {
        throw new ForbiddenException('Insufficient permissions for the target project');
      }
      data.projectId = dto.projectId;
    }
    if (dto.year !== undefined && dto.year !== entry.year) {
      const clash = await this.prisma.entry.findUnique({
        where: {
          companyId_year_serial: { companyId: entry.companyId, year: dto.year, serial: entry.serial },
        },
        select: { id: true },
      });
      if (clash && clash.id !== entry.id) {
        throw new ConflictException({
          code: 'DUPLICATE_SERIAL',
          message: 'Serial already exists for this company and year',
          existingEntryId: clash.id,
        });
      }
      data.year = dto.year;
    }

    const updated = await this.prisma.entry.update({ where: { id }, data });
    return updated as unknown as Record<string, unknown>;
  }

  async remove(id: string): Promise<Record<string, unknown>> {
    const entry = await this.prisma.entry.findFirst({ where: { id, deletedAt: null } });
    if (!entry) {
      throw new NotFoundException('Entry not found');
    }
    const deleted = await this.prisma.entry.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { id: deleted.id, deletedAt: deleted.deletedAt };
  }

  async restore(id: string): Promise<Record<string, unknown>> {
    const entry = await this.prisma.entry.findUnique({ where: { id } });
    if (!entry) {
      throw new NotFoundException('Entry not found');
    }
    if (!entry.deletedAt) {
      throw new BadRequestException('Entry is not deleted');
    }
    const restored = await this.prisma.entry.update({ where: { id }, data: { deletedAt: null } });
    return restored as unknown as Record<string, unknown>;
  }
}
