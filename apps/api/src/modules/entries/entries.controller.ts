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
import type { Request, Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import type { AuthenticatedUser } from '../auth/types';
import { PermissionsGuard } from '../rbac/guards/permissions.guard';
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
  constructor(private readonly entries: EntriesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  // No scopeHint: multipart bodies aren't parsed when guards run.
  // Service-level requireCreateScope() enforces project-scoped access
  // after multer parses the request.
  @RequirePermission('CREATE', 'ENTRY')
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

  @Get(':id')
  @RequirePermission('VIEW', 'ENTRY', { source: 'params', key: 'id' })
  async findOne(@Param('id') id: string): Promise<unknown> {
    return this.entries.findOne(id);
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
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<unknown> {
    return this.entries.remove(id, { userId: user.id, ip, userAgent: userAgent ?? null });
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('RESTORE', 'ENTRY', { source: 'params', key: 'id' })
  async restore(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<unknown> {
    return this.entries.restore(id, { userId: user.id, ip, userAgent: userAgent ?? null });
  }
}
