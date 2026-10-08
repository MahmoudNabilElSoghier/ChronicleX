import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import archiver from 'archiver';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsService } from '../rbac/permissions.service';
import { ScopeMatcher } from '../rbac/scope-matcher';
import { StorageService } from '../storage/storage.service';
import type { BundleDownloadDto } from './dto/bundle-download.dto';
import type { ExportEntriesDto } from './dto/export-entries.dto';
import type { ListEntriesDto } from './dto/list-entries.dto';
import type { UpdateEntryDto } from './dto/update-entry.dto';
import type { UploadEntryDto } from './dto/upload-entry.dto';
import { fetchExistingSummary } from './existing-summary';
import { parseSerialFromFilename, validatePdfMagicBytes } from './serial.utils';

export interface Actor {
  userId: string;
  ip: string | null;
  userAgent: string | null;
}

/** Rows per export query — bounded so 100K-row exports never sit in memory. */
const EXPORT_BATCH_SIZE = 1000;

/**
 * ZIP bundle caps: 1,000 files (request side AND matched rows — a filtered
 * bundle can request nothing and still match a huge set) and 500 MB of
 * stored bytes summed, so a big batch never materializes in API memory.
 */
const BUNDLE_MAX_ENTRIES = 1_000;
const BUNDLE_MAX_BYTES = 500 * 1024 * 1024;
const BUNDLE_COUNT_CAP_MESSAGE = 'Bundle download limited to 1,000 entries. Narrow your filters.';
const BUNDLE_SIZE_CAP_MESSAGE = 'Bundle download exceeds the 500 MB limit. Narrow your selection.';

/**
 * Fixed Arabic headers: the CSV is an org-wide data artifact, so it does
 * not follow the UI locale. Order is part of the contract.
 */
const CSV_HEADERS = [
  'الرقم التسلسلي',
  'البادئة',
  'السنة',
  'كود الشركة',
  'الشركة',
  'كود المشروع',
  'المشروع',
  'اسم الملف',
  'الحجم (بايت)',
  'البصمة',
  'البريد المسجل',
  'تاريخ الرفع',
];

/** RFC 4180: quote when the value contains a comma, quote or newline. */
function csvField(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

type ExportRow = {
  serial: string;
  typePrefix: string;
  year: number;
  fileName: string;
  fileSize: number;
  fileHash: string;
  createdAt: Date;
  company: { code: number; nameAr: string; nameEn: string };
  project: { code: string; nameAr: string; nameEn: string };
  uploader: { nameAr: string; nameEn: string };
};

function entryToCsvLine(row: ExportRow): string {
  return [
    row.serial,
    row.typePrefix,
    row.year,
    row.company.code,
    row.company.nameAr || row.company.nameEn,
    row.project.code,
    row.project.nameAr || row.project.nameEn,
    row.fileName,
    row.fileSize,
    row.fileHash,
    row.uploader.nameAr || row.uploader.nameEn,
    row.createdAt.toISOString(),
  ]
    .map(csvField)
    .join(',');
}

/** Shared columns for the CSV export (order is part of the contract). */
const EXPORT_SELECT = {
  id: true,
  serial: true,
  typePrefix: true,
  year: true,
  fileName: true,
  fileSize: true,
  fileHash: true,
  createdAt: true,
  company: { select: { code: true, nameAr: true, nameEn: true } },
  project: { select: { code: true, nameAr: true, nameEn: true } },
  uploader: { select: { nameAr: true, nameEn: true } },
} satisfies Prisma.EntrySelect;

/**
 * Keyset continuation: rows strictly after `last` in (createdAt, id) order.
 * The CSV stream pages identically to the list query — ties on createdAt
 * cannot skip or duplicate rows.
 */
function keysetWhere(
  where: Prisma.EntryWhereInput,
  last: { createdAt: Date; id: string } | undefined,
): Prisma.EntryWhereInput {
  if (!last) return where;
  return {
    AND: [
      where,
      {
        OR: [
          { createdAt: { gt: last.createdAt } },
          { AND: [{ createdAt: last.createdAt }, { id: { gt: last.id } }] },
        ],
      },
    ],
  };
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
      const existing = await fetchExistingSummary(this.prisma, dupe.id);
      throw new ConflictException({
        code: 'DUPLICATE_SERIAL',
        message: 'Serial already exists for this company and year',
        existingEntryId: dupe.id,
        ...(existing ? { existing } : {}),
      });
    }
    const dupeFile = await this.prisma.entry.findFirst({
      where: { fileHash, deletedAt: null },
      select: { id: true },
    });
    if (dupeFile) {
      const existing = await fetchExistingSummary(this.prisma, dupeFile.id);
      throw new ConflictException({
        code: 'DUPLICATE_FILE',
        message: 'Identical file already archived',
        existingEntryId: dupeFile.id,
        ...(existing ? { existing } : {}),
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

  /**
   * Shared WHERE for list() and export(mode=filtered): range validation,
   * the includeDeleted grant check, scope + filter clauses. One builder so
   * "export what the list shows" can never drift from the list itself.
   */
  private async buildListWhere(
    query: ListEntriesDto,
    userId: string,
  ): Promise<Prisma.EntryWhereInput> {
    if (query.serialFrom && query.serialTo && query.serialFrom > query.serialTo) {
      throw new BadRequestException('serialFrom must be less than or equal to serialTo');
    }
    const scopeWhere = await this.buildScopeWhere(userId);

    if (query.includeDeleted) {
      const grants = await this.permissions.getEffectiveGrants(userId);
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
    return { AND: and };
  }

  async list(query: ListEntriesDto, actor: Actor): Promise<Record<string, unknown>> {
    const where = await this.buildListWhere(query, actor.userId);

    const limit = query.limit;
    const rows = await this.prisma.entry.findMany({
      where,
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

  /**
   * Shared WHERE + cross-mode validation for export (CSV) and
   * bundle-download: one builder so every artifact covers exactly the rows
   * the list shows. All 400/403 failures surface here, BEFORE any stream
   * or archive exists. The BundleDownloadDto structurally mirrors
   * ExportEntriesDto, so both share these rules.
   */
  private async resolveExportWhere(
    dto: ExportEntriesDto | BundleDownloadDto,
    actor: Actor,
  ): Promise<Prisma.EntryWhereInput> {
    const entryIds = dto.entryIds;
    if (dto.mode === 'selected') {
      if (!entryIds || entryIds.length === 0) {
        throw new BadRequestException('mode=selected requires a non-empty entryIds array');
      }
      if (entryIds.length > 5000) {
        throw new BadRequestException('entryIds exceeds the 5000 limit');
      }
      if (dto.filters !== undefined) {
        throw new BadRequestException('filters must not be sent with mode=selected');
      }
      const scopeWhere = await this.buildScopeWhere(actor.userId);
      // Out-of-scope ids are silently dropped (never a whole-request 403);
      // the difference surfaces in the EXPORT_PARTIAL audit event below.
      return { AND: [scopeWhere, { id: { in: entryIds } }, { deletedAt: null }] };
    }
    if (entryIds !== undefined) {
      throw new BadRequestException('entryIds must not be sent with mode=filtered');
    }
    if (!dto.filters) {
      throw new BadRequestException('mode=filtered requires filters');
    }
    // buildListWhere also applies the scope clause + includeDeleted grant.
    return this.buildListWhere(dto.filters, actor.userId);
  }

  /**
   * Streamed CSV export. The WHERE (scope included) is fully built BEFORE
   * the stream exists, so 403/400 still surface as normal JSON errors and
   * only successful exports start writing headers. Rows arrive in
   * createdAt-ASC keyset batches of 1000 — never the whole result set.
   */
  async export(dto: ExportEntriesDto, actor: Actor): Promise<Readable> {
    const where = await this.resolveExportWhere(dto, actor);
    return Readable.from(this.exportCsvChunks(where, dto, actor), { objectMode: false });
  }

  /**
   * Bundle of the STORED entry PDFs (MinIO) — the "real files" flow.
   * WHERE is fully built BEFORE any storage stream exists, so 403/400 and
   * the 404-no-match surface as JSON errors and only a successful request
   * opens object streams. One matched entry streams as the RAW PDF
   * (zip+unzip for a single file is friction); 2+ entries stream a ZIP
   * with `${serial}.pdf` names — duplicate serials (same serial, different
   * year/company) get a `-YEAR` suffix. The audit log (counts only) is
   * written once the response is assembled; `single` tells the controller
   * which shape to emit.
   */
  async bundleDownload(
    dto: BundleDownloadDto,
    actor: Actor,
  ): Promise<{
    stream: Readable;
    count: number;
    totalBytes: number;
    single?: { serial: string; fileKey: string };
  }> {
    const requested = dto.mode === 'selected' ? (dto.entryIds?.length ?? 0) : undefined;
    if (requested !== undefined && requested > BUNDLE_MAX_ENTRIES) {
      throw new BadRequestException(BUNDLE_COUNT_CAP_MESSAGE);
    }
    const where = await this.resolveExportWhere(dto, actor);
    const entries = await this.prisma.entry.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, serial: true, year: true, fileKey: true, fileSize: true },
    });
    if (entries.length === 0) {
      throw new NotFoundException('No entries match the selection.');
    }
    if (entries.length > BUNDLE_MAX_ENTRIES) {
      throw new BadRequestException(BUNDLE_COUNT_CAP_MESSAGE);
    }
    const totalBytes = entries.reduce((sum, e) => sum + e.fileSize, 0);
    if (totalBytes > BUNDLE_MAX_BYTES) {
      throw new BadRequestException(BUNDLE_SIZE_CAP_MESSAGE);
    }
    const count = entries.length;

    // One matched file → stream the raw PDF directly (no archiver, no
    // zip+unzip step); 2+ → zip with collision-free names. File name
    // collision handling: fileKey is unique, so only the SERIAL can repeat
    // (same serial across companies/years). Duplicate serials all get the
    // `-YEAR` suffix; identical serial+year (foreign companies) falls back
    // to a numeric suffix so no two archive entries share a name.
    let stream: Readable;
    let single: { serial: string; fileKey: string } | undefined;
    if (count === 1) {
      const only = entries[0];
      if (!only) {
        // Unreachable — entries.length === 1 — but keeps the narrowing honest.
        throw new NotFoundException('No entries match the selection.');
      }
      single = { serial: only.serial, fileKey: only.fileKey };
      stream = await this.storage.getObjectStream(only.fileKey);
    } else {
      const serialCounts = new Map<string, number>();
      for (const e of entries) {
        serialCounts.set(e.serial, (serialCounts.get(e.serial) ?? 0) + 1);
      }
      const used = new Set<string>();
      const uniqueName = (e: (typeof entries)[number]): string => {
        const base = (serialCounts.get(e.serial) ?? 0) > 1 ? `${e.serial}-${e.year}` : e.serial;
        let name = `${base}.pdf`;
        if (used.has(name)) {
          let n = 2;
          while (used.has(`${base}-${n}.pdf`)) n += 1;
          name = `${base}-${n}.pdf`;
        }
        used.add(name);
        return name;
      };

      const archive = archiver('zip', { zlib: { level: 6 } });
      // All object streams are opened up front (append is lazy — archiver
      // only reads each source when its entry is reached).
      for (const e of entries) {
        archive.append(await this.storage.getObjectStream(e.fileKey), { name: uniqueName(e) });
      }
      archive.finalize();
      stream = archive as unknown as Readable;
    }

    // Manual audit (documented exception, same as exportCsvChunks): the
    // response streams, so the @Audit interceptor cannot bracket it.
    // Counts only — never the id list itself. `bundle`/`single` record
    // which response shape was sent (zip vs raw PDF).
    await this.prisma.auditLog
      .create({
        data: {
          userId: actor.userId,
          action: 'EXPORT',
          resource: 'ENTRY',
          resourceId: null,
          newValues: {
            event: 'BUNDLE_DOWNLOAD',
            bundle: count > 1,
            single: count === 1,
            mode: dto.mode,
            count,
            totalBytes,
            entryIdsCount: requested ?? null,
            ...(dto.mode === 'filtered' ? { filters: { ...(dto.filters ?? {}) } } : {}),
          },
          ipAddress: actor.ip,
          userAgent: actor.userAgent,
        },
      })
      .catch(() => undefined);
    return { stream, count, totalBytes, ...(single ? { single } : {}) };
  }

  private async *exportCsvChunks(
    where: Prisma.EntryWhereInput,
    dto: ExportEntriesDto,
    actor: Actor,
  ): AsyncGenerator<string> {
    yield '\uFEFF' + CSV_HEADERS.map(csvField).join(',') + '\r\n';

    let exported = 0;
    let last: { createdAt: Date; id: string } | undefined;
    for (;;) {
      // Keyset pagination on (createdAt, id): ties on createdAt cannot skip
      // or duplicate rows the way a plain `createdAt > last` cursor would.
      const batch = await this.prisma.entry.findMany({
        where: keysetWhere(where, last),
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: EXPORT_BATCH_SIZE,
        select: EXPORT_SELECT,
      });
      if (batch.length === 0) break;
      exported += batch.length;
      const tail = batch[batch.length - 1];
      if (!tail) break;
      last = { createdAt: tail.createdAt, id: tail.id };
      yield batch.map(entryToCsvLine).join('\r\n') + '\r\n';
      if (batch.length < EXPORT_BATCH_SIZE) break;
    }

    // Manual audit (documented exception, same as openStream): the response
    // streams, so the @Audit interceptor cannot bracket it. Counts only —
    // the id list itself could be thousands of rows.
    const requested = dto.mode === 'selected' ? (dto.entryIds?.length ?? 0) : undefined;
    const partial = requested !== undefined && exported < requested;
    await this.prisma.auditLog
      .create({
        data: {
          userId: actor.userId,
          action: 'EXPORT',
          resource: 'ENTRY',
          resourceId: null,
          newValues: {
            event: partial ? 'EXPORT_PARTIAL' : 'EXPORT',
            mode: dto.mode,
            count: exported,
            // Always present: number for selected, null for filtered —
            // compliance reads one shape for both modes.
            entryIdsCount: requested ?? null,
            // Plain object (no DTO class instance) so Prisma accepts the JSON.
            ...(dto.mode === 'filtered' ? { filters: { ...(dto.filters ?? {}) } } : {}),
          },
          ipAddress: actor.ip,
          userAgent: actor.userAgent,
        },
      })
      .catch(() => undefined);
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
