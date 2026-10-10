import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthGuard } from '../../auth/guards/auth.guard';
import { TokenService } from '../../auth/token.service';
import { CatalogController } from '../catalog.controller';
import { CatalogService } from '../catalog.service';
import { PermissionsGuard } from '../../rbac/guards/permissions.guard';
import { PermissionsService } from '../../rbac/permissions.service';
import { ScopeMatcher } from '../../rbac/scope-matcher';
import { ScopeResolver } from '../../rbac/scope-resolver.service';

/**
 * Catalog mutations through the real guards + ValidationPipe (mirrors
 * main.ts): DTO shape rules (code write-once →400 on PATCH), guard split
 * (UPDATE COMPANY at the route, GROUP vs COMPANY scope in the service).
 */
describe('POST/PATCH/DELETE /companies|/projects (http)', () => {
  const tokens = { verify: jest.fn().mockReturnValue({ sub: 'u1' }) };
  const prisma = {
    user: { findUnique: jest.fn() },
    company: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
    project: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
    entry: { count: jest.fn() },
  };
  const permissions = { getEffectiveGrants: jest.fn() };
  const scopeMatcher = new ScopeMatcher(permissions as unknown as PermissionsService);
  const ACTIVE = { id: 'u1', email: 'a@b.c', nameAr: 'U', nameEn: 'N', isActive: true };
  const GROUP_UPDATE = [
    { action: 'UPDATE', resource: 'COMPANY', scopeType: 'GROUP', scopeId: '' },
  ];
  const COMPANY_UPDATE_C1 = [
    { action: 'UPDATE', resource: 'COMPANY', scopeType: 'COMPANY', scopeId: 'c1' },
  ];

  async function boot(): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({
      controllers: [CatalogController],
      providers: [
        CatalogService,
        PermissionsGuard,
        ScopeResolver,
        Reflector,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(undefined) } },
        { provide: TokenService, useValue: tokens },
        { provide: PrismaService, useValue: prisma },
        { provide: PermissionsService, useValue: permissions },
        { provide: ScopeMatcher, useValue: scopeMatcher },
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    return app;
  }

  const auth = (app: INestApplication): ReturnType<typeof request> =>
    request(app.getHttpServer());

  beforeEach(() => {
    jest.clearAllMocks();
    tokens.verify.mockReturnValue({ sub: 'u1' });
    prisma.user.findUnique.mockResolvedValue(ACTIVE);
    permissions.getEffectiveGrants.mockResolvedValue(GROUP_UPDATE);
    prisma.company.findUnique.mockResolvedValue({ id: 'c1', code: 2000 });
    prisma.project.findUnique.mockResolvedValue({ id: 'p1', companyId: 'c1' });
    prisma.company.create.mockResolvedValue({ id: 'c9', code: 9900, nameAr: 'Ar', nameEn: 'En' });
    prisma.company.update.mockResolvedValue({ id: 'c1', code: 2000, nameAr: 'N', nameEn: 'E' });
    prisma.project.create.mockResolvedValue({ id: 'p9', code: 'NEW', nameAr: 'Ar', nameEn: 'En', companyId: 'c1' });
    prisma.project.update.mockResolvedValue({ id: 'p1', code: 'SSC', nameAr: 'N', nameEn: 'E', companyId: 'c1' });
    prisma.company.count.mockResolvedValue(0);
    prisma.project.count.mockResolvedValue(0);
    prisma.entry.count.mockResolvedValue(0);
  });

  it('POST /companies by SUPER_ADMIN →201 and persists', async () => {
    const app = await boot();
    const res = await auth(app)
      .post('/companies').set('Authorization', 'Bearer test.jwt')
      .send({ code: 9900, nameAr: 'Ar', nameEn: 'En' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'c9', code: 9900, nameAr: 'Ar', nameEn: 'En' });
    expect(prisma.company.create).toHaveBeenCalled();
    await app.close();
  });

  it('POST /companies by COMPANY_ADMIN →403 (service GROUP check)', async () => {
    const app = await boot();
    permissions.getEffectiveGrants.mockResolvedValue(COMPANY_UPDATE_C1);
    const res = await auth(app)
      .post('/companies').set('Authorization', 'Bearer test.jwt')
      .send({ code: 9900, nameAr: 'Ar', nameEn: 'En' });
    expect(res.status).toBe(403);
    expect(prisma.company.create).not.toHaveBeenCalled();
    await app.close();
  });

  it('POST /companies without UPDATE COMPANY →403 at the guard', async () => {
    const app = await boot();
    permissions.getEffectiveGrants.mockResolvedValue([]);
    const res = await auth(app)
      .post('/companies').set('Authorization', 'Bearer test.jwt')
      .send({ code: 9900, nameAr: 'Ar', nameEn: 'En' });
    expect(res.status).toBe(403);
    await app.close();
  });

  it('PATCH /companies/:id with code →400 (write-once, forbidNonWhitelisted)', async () => {
    const app = await boot();
    const res = await auth(app)
      .patch('/companies/c1').set('Authorization', 'Bearer test.jwt')
      .send({ nameAr: 'New', code: 3000 });
    expect(res.status).toBe(400);
    expect(prisma.company.update).not.toHaveBeenCalled();
    await app.close();
  });

  it('PATCH /companies/:id renames →200', async () => {
    const app = await boot();
    const res = await auth(app)
      .patch('/companies/c1').set('Authorization', 'Bearer test.jwt')
      .send({ nameAr: 'New', nameEn: 'NewEn' });
    expect(res.status).toBe(200);
    expect(prisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { nameAr: 'New', nameEn: 'NewEn' } }),
    );
    await app.close();
  });

  it('DELETE /companies/:id with no active projects →200 soft-deletes', async () => {
    const app = await boot();
    const res = await auth(app)
      .delete('/companies/c1').set('Authorization', 'Bearer test.jwt');
    expect(res.status).toBe(200);
    expect(prisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { deletedAt: expect.any(Date) } }),
    );
    await app.close();
  });

  it('DELETE /companies/:id with active projects →400 with count', async () => {
    const app = await boot();
    prisma.project.count.mockResolvedValue(3);
    const res = await auth(app)
      .delete('/companies/c1').set('Authorization', 'Bearer test.jwt');
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('3');
    expect(prisma.company.update).not.toHaveBeenCalled();
    await app.close();
  });

  it('POST /projects by COMPANY_ADMIN in own company →201', async () => {
    const app = await boot();
    permissions.getEffectiveGrants.mockResolvedValue(COMPANY_UPDATE_C1);
    const res = await auth(app)
      .post('/projects').set('Authorization', 'Bearer test.jwt')
      .send({ code: 'NEW', nameAr: 'Ar', nameEn: 'En', companyId: 'c1' });
    expect(res.status).toBe(201);
    expect(prisma.project.create).toHaveBeenCalled();
    await app.close();
  });

  it('POST /projects by COMPANY_ADMIN in another company →403', async () => {
    const app = await boot();
    permissions.getEffectiveGrants.mockResolvedValue(COMPANY_UPDATE_C1);
    const res = await auth(app)
      .post('/projects').set('Authorization', 'Bearer test.jwt')
      .send({ code: 'NEW', nameAr: 'Ar', nameEn: 'En', companyId: 'c2' });
    expect(res.status).toBe(403);
    expect(prisma.project.create).not.toHaveBeenCalled();
    await app.close();
  });

  it('PATCH /projects/:id with code →400', async () => {
    const app = await boot();
    const res = await auth(app)
      .patch('/projects/p1').set('Authorization', 'Bearer test.jwt')
      .send({ nameAr: 'New', code: 'HACK' });
    expect(res.status).toBe(400);
    expect(prisma.project.update).not.toHaveBeenCalled();
    await app.close();
  });

  it('DELETE /projects/:id with entries →400 with count', async () => {
    const app = await boot();
    prisma.entry.count.mockResolvedValue(7);
    const res = await auth(app)
      .delete('/projects/p1').set('Authorization', 'Bearer test.jwt');
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('7');
    expect(prisma.project.update).not.toHaveBeenCalled();
    await app.close();
  });

  it('DELETE /projects/:id with no entries →200 soft-deletes', async () => {
    const app = await boot();
    const res = await auth(app)
      .delete('/projects/p1').set('Authorization', 'Bearer test.jwt');
    expect(res.status).toBe(200);
    expect(prisma.project.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { deletedAt: expect.any(Date) } }),
    );
    await app.close();
  });
});
