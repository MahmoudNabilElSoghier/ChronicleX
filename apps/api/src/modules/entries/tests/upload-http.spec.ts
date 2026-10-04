import { INestApplication } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { AuthGuard } from '../../auth/guards/auth.guard';
import { TokenService } from '../../auth/token.service';
import { PermissionsGuard } from '../../rbac/guards/permissions.guard';
import { PermissionsService } from '../../rbac/permissions.service';
import { ScopeMatcher } from '../../rbac/scope-matcher';
import { ScopeResolver } from '../../rbac/scope-resolver.service';
import { EntriesController } from '../entries.controller';
import { EntriesService } from '../entries.service';

/**
 * Full-stack multipart upload: real AuthGuard + PermissionsGuard +
 * FileInterceptor + EntriesService, mocked DB/storage/grants. Proves the
 * service-level scope check fires for multipart bodies (guards see {}).
 */
describe('POST /entries multipart (http)', () => {
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

  const P1 = { id: 'p1', companyId: 'c1', code: 'REHAB', company: { id: 'c1', code: 2000 } };
  const P2 = { id: 'p2', companyId: 'c1', code: 'MAD', company: { id: 'c1', code: 2000 } };
  const ACTIVE = { id: 'u1', email: 'a@b.c', nameAr: 'ن', nameEn: 'N', isActive: true };

  async function boot(): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({
      controllers: [EntriesController],
      providers: [
        EntriesService,
        ScopeMatcher,
        PermissionsGuard,
        ScopeResolver,
        Reflector,
        { provide: APP_GUARD, useClass: AuthGuard },
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

  beforeEach(() => {
    jest.clearAllMocks();
    tokens.verify.mockReturnValue({ sub: 'u1' });
    prisma.user.findUnique.mockResolvedValue(ACTIVE);
    prisma.project.findUnique.mockImplementation((args: { where: { id: string } }) =>
      Promise.resolve(args.where.id === 'p1' ? P1 : args.where.id === 'p2' ? P2 : null),
    );
    prisma.entry.findUnique.mockResolvedValue(null);
    prisma.entry.findFirst.mockResolvedValue(null);
    prisma.entry.create.mockImplementation((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'e1', createdAt: new Date('2025-01-01'), ...args.data }),
    );
  });

  function post(app: INestApplication, projectId: string): request.Test {
    return request(app.getHttpServer())
      .post('/entries')
      .set('Authorization', 'Bearer test.jwt')
      .field('companyId', 'c1')
      .field('projectId', projectId)
      .field('year', '2025')
      .attach('file', Buffer.from('%PDF-1.7 bytes'), '6200000000.pdf');
  }

  it('PROJECT_ADMIN p1 uploading to p1 → 201', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([
      { action: 'CREATE', resource: 'ENTRY', scopeType: 'PROJECT', scopeId: 'p1' },
    ]);
    const app = await boot();
    try {
      const res = await post(app, 'p1').expect(201);
      expect(res.body.serial).toBe('6200000000');
    } finally {
      await app.close();
    }
  });

  it('PROJECT_ADMIN p1 uploading to p2 → 403', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([
      { action: 'CREATE', resource: 'ENTRY', scopeType: 'PROJECT', scopeId: 'p1' },
    ]);
    const app = await boot();
    try {
      await post(app, 'p2').expect(403);
      expect(prisma.entry.create).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('VIEWER uploading anywhere → 403', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([
      { action: 'VIEW', resource: 'ENTRY', scopeType: 'PROJECT', scopeId: 'p1' },
    ]);
    const app = await boot();
    try {
      await post(app, 'p1').expect(403);
      expect(prisma.entry.create).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
