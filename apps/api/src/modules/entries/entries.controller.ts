import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { memoryStorage } from 'multer';
import { Action, Resource } from '../../generated/prisma/client';
import { applyCorsHeaders, parseCorsOrigins } from '../../common/cors-headers';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import type { AuthenticatedUser } from '../auth/types';
import { Audit } from '../audit/audit.decorator';
import { PermissionsGuard } from '../rbac/guards/permissions.guard';
import { BundleDownloadDto } from './dto/bundle-download.dto';
import { ExportEntriesDto } from './dto/export-entries.dto';
import { ListEntriesDto } from './dto/list-entries.dto';
import { UpdateEntryDto } from './dto/update-entry.dto';
import { UploadEntryDto } from './dto/upload-entry.dto';
import { EntriesService } from './entries.service';

type RangeRequest =
  | { kind: 'none' }
  | { kind: 'range'; start: number; end: number }
  | { kind: 'invalid' };

function parseRange(header: string | undefined, size: number): RangeRequest {
  if (!header) return { kind: 'none' };
  const m = /^bytes=(\d+)-(\d*)$/.exec(header.trim());
  if (!m) return { kind: 'invalid' };
  const start = Number(m[1]);
  let end = m[2] === '' ? size - 1 : Number(m[2]);
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
    return { kind: 'invalid' };
  }
  if (end >= size) end = size - 1;
  return { kind: 'range', start, end };
}

@Controller('entries')
@UseGuards(PermissionsGuard)
export class EntriesController {
  constructor(
    private readonly entries: EntriesService,
    private readonly config: ConfigService,
  ) {}

  private corsOrigins(): string[] {
    return parseCorsOrigins(this.config.get<string>('CORS_ORIGINS'));
  }
  @Post()
  @HttpCode(HttpStatus.CREATED)
  // No scopeHint: multipart bodies aren't parsed when guards run.
  // Service-level requireCreateScope() enforces project-scoped access
  // after multer parses the request.
  @RequirePermission('CREATE', 'ENTRY')
  @Audit({ action: Action.CREATE, resource: Resource.ENTRY, idParam: null })
  @UseInterceptors(
    FileInterceptor('file', {
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
  async upload(
    @Body() dto: UploadEntryDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<unknown> {
    return this.entries.upload(dto, file, { userId: user.id, ip, userAgent: userAgent ?? null });
  }

  @Get()
  @RequirePermission('VIEW', 'ENTRY')
  async list(
    @Query() query: ListEntriesDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<unknown> {
    return this.entries.list(query, { userId: user.id, ip, userAgent: userAgent ?? null });
  }

  @Get('years')
  @RequirePermission('VIEW', 'ENTRY')
  async years(@CurrentUser() user: AuthenticatedUser): Promise<unknown> {
    return { years: await this.entries.years(user.id) };
  }

  @Post('export')
  @RequirePermission('EXPORT', 'ENTRY')
  async exportEntries(
    @Body() dto: ExportEntriesDto,
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    // 1. CORS FIRST — before any await, before any pipe (same rule as
    // streamFile below): if export() throws, the error response still
    // carries CORS headers; once the pipe starts, middleware-set headers
    // may not survive the commit.
    applyCorsHeaders(req, res, this.corsOrigins());
    // 2. Then everything else.
    // Scope/DTO failures throw BEFORE the stream exists — the exception
    // layer still formats them as JSON (same as streamFile).
    const stream = await this.entries.export(
      dto,
      { userId: user.id, ip, userAgent: userAgent ?? null },
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="entries-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.setHeader('Transfer-Encoding', 'chunked');
    stream.pipe(res);
  }

  @Post('bundle-download')
  // VIEW, not EXPORT: bundling is a view-time download of the files the
  // caller can already see — ARCHIVIST/VIEWER without EXPORT may use it.
  // Scope is enforced inside the service via buildScopeWhere (no hint).
  @RequirePermission('VIEW', 'ENTRY')
  async bundleDownload(
    @Body() dto: BundleDownloadDto,
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    // 1. CORS FIRST — same rule as exportEntries/streamFile above.
    applyCorsHeaders(req, res, this.corsOrigins());
    // 2. Then everything else; scope/DTO/cap failures throw before the
    // response is committed and surface as JSON.
    const { stream, count, single } = await this.entries.bundleDownload(dto, {
      userId: user.id,
      ip,
      userAgent: userAgent ?? null,
    });
    if (count === 1 && single) {
      // One file → raw PDF, no zip+unzip step. Filename matches the ZIP
      // entry name ({serial}.pdf), so the file comes out identical either way.
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${single.serial}.pdf"`);
      res.setHeader('Transfer-Encoding', 'chunked');
      stream.on('error', (err: Error) => {
        // eslint-disable-next-line no-console
        console.error('[bundle-download] stream error during single-file pipe:', err);
        res.destroy();
      });
      stream.pipe(res);
      return;
    }
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="entries-${dto.mode}-${count}-${date}.zip"`,
    );
    res.setHeader('Transfer-Encoding', 'chunked');
    // A MinIO read can fail mid-stream: kill the response instead of
    // emitting a corrupt file — but log server-side (silent client-side
    // truncation alone hides production MinIO failures).
    stream.on('error', (err: Error) => {
      // eslint-disable-next-line no-console
      console.error('[bundle-download] stream error during zip pipe:', err);
      res.destroy();
    });
    stream.pipe(res);
  }

  @Get(':id')
  @RequirePermission('VIEW', 'ENTRY', { source: 'params', key: 'id' })
  async findOne(@Param('id') id: string): Promise<unknown> {
    return this.entries.findOne(id);
  }

  @Get(':id/audit')
  @RequirePermission('VIEW', 'ENTRY', { source: 'params', key: 'id' })
  async getAudit(@Param('id') id: string): Promise<unknown> {
    return this.entries.getAudit(id);
  }

  @Get(':id/file')
  @RequirePermission('VIEW', 'ENTRY', { source: 'params', key: 'id' })
  async streamFile(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<void> {
    // 1. CORS FIRST — before any await, before any pipe. If getStreamTarget
    // throws below, the error response still carries CORS headers.
    applyCorsHeaders(req, res, this.corsOrigins());
    // 2. Then everything else.
    const target = await this.entries.getStreamTarget(id);
    const range = parseRange(req.headers.range, target.fileSize);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${target.serial}.pdf"`);
    res.setHeader('Accept-Ranges', 'bytes');
    if (range.kind === 'none') {
      res.setHeader('Content-Length', target.fileSize);
      const stream = await this.entries.openStream(target, undefined, {
        userId: user.id,
        ip,
        userAgent: userAgent ?? null,
      });
      stream.pipe(res);
      return;
    }
    if (range.kind === 'invalid') {
      res.status(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE);
      res.setHeader('Content-Range', `bytes */${target.fileSize}`);
      res.end();
      return;
    }
    const stream = await this.entries.openStream(
      target,
      { start: range.start, end: range.end },
      { userId: user.id, ip, userAgent: userAgent ?? null },
    );
    res.status(HttpStatus.PARTIAL_CONTENT);
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${target.fileSize}`);
    res.setHeader('Content-Length', range.end - range.start + 1);
    stream.pipe(res);
  }

  @Patch(':id')
  @RequirePermission('UPDATE', 'ENTRY', { source: 'params', key: 'id' })
  @Audit({ action: Action.UPDATE, resource: Resource.ENTRY })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateEntryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<unknown> {
    return this.entries.update(id, dto, { userId: user.id, ip, userAgent: userAgent ?? null });
  }

  @Delete(':id')
  @RequirePermission('DELETE', 'ENTRY', { source: 'params', key: 'id' })
  @Audit({ action: Action.DELETE, resource: Resource.ENTRY })
  async remove(@Param('id') id: string): Promise<unknown> {
    return this.entries.remove(id);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('RESTORE', 'ENTRY', { source: 'params', key: 'id' })
  @Audit({ action: Action.RESTORE, resource: Resource.ENTRY })
  async restore(@Param('id') id: string): Promise<unknown> {
    return this.entries.restore(id);
  }
}
