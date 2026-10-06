import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { AuditInterceptor } from '../audit.interceptor';
import { AuditService } from '../audit.service';
import { ResourceLoaderService } from '../resource-loader.service';
import { AuthGuard } from '../../auth/guards/auth.guard';
import { TokenService } from '../../auth/token.service';
import { EntriesController } from '../../entries/entries.controller';
import { EntriesService } from '../../entries/entries.service';
import { PermissionsGuard } from '../../rbac/guards/permissions.guard';
import { PermissionsService } from '../../rbac/permissions.service';
import { ScopeMatcher } from '../../rbac/scope-matcher';
import { ScopeResolver } from '../../rbac/scope-resolver.service';

/** POST /entries through the real interceptor: an AuditLog row must exist after 201. */
describe('upload → audit row (in-memory, no Docker)', () => {
  const tokens = { verify: jest.fn().mockReturnValue({ sub: 'u1' }) };
  const prisma = {
    user: { findUnique: jest.fn() },
    project: { findUnique: jest.fn() },
    entry: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const storage = { putObject: jest.fn().mockResolvedValue(undefined) };
  const permissions = { getEffectiveGrants: jest.fn() };

  async function boot(): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({
      controllers: [EntriesController],
      providers: [
        EntriesService,
        ScopeMatcher,
        PermissionsGuard,
        ScopeResolver,
        AuditService,
        ResourceLoaderService,
        AuditInterceptor,
        Reflector,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(undefined) } },
        { provide: TokenService, useValue: tokens },
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        { provide: PermissionsService, useValue: permissions },
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    return app;
  }

  it('POST /entries writes CREATE/ENTRY audit with the caller id', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1', email: 'a@b.c', nameAr: 'ن', nameEn: 'N', isActive: true,
    });
    prisma.project.findUnique.mockResolvedValue({
      id: 'p1', companyId: 'c1', code: 'REHAB', company: { id: 'c1', code: 2000 },
    });
    prisma.entry.create.mockImplementation((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'e1', createdAt: new Date('2025-01-01'), ...args.data }),
    );
    permissions.getEffectiveGrants.mockResolvedValue([
      { action: 'CREATE', resource: 'ENTRY', scopeType: 'PROJECT', scopeId: 'p1' },
    ]);

    const app = await boot();
    try {
      await request(app.getHttpServer())
        .post('/entries')
        .set('Authorization', 'Bearer test.jwt')
        .field('companyId', 'c1')
        .field('projectId', 'p1')
        .field('year', '2025')
        .attach('file', Buffer.from('%PDF-1.7 bytes'), '6200000000.pdf')
        .expect(201);
      await new Promise((resolve) => setImmediate(resolve));
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'CREATE',
            resource: 'ENTRY',
            userId: 'u1',
            resourceId: 'e1',
          }),
        }),
      );
    } finally {
      await app.close();
    }
  });
});
