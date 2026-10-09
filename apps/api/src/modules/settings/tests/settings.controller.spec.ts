import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AuthGuard } from '../../auth/guards/auth.guard';
import { TokenService } from '../../auth/token.service';
import { PermissionsGuard } from '../../rbac/guards/permissions.guard';
import { PermissionsService } from '../../rbac/permissions.service';
import { ScopeResolver } from '../../rbac/scope-resolver.service';
import { SettingsController } from '../settings.controller';
import { SettingsService } from '../settings.service';

/**
 * /settings/entry-prefixes through the real guards + service: super admin
 * (GROUP UPDATE COMPANY) writes; company-scoped holders are stopped by the
 * service-level GROUP check even when the route guard would pass them.
 */
describe('GET/PUT /settings/entry-prefixes (http)', () => {
  const tokens = { verify: jest.fn().mockReturnValue({ sub: 'u1' }) };
  const prisma = {
    user: { findUnique: jest.fn() },
    appSetting: { findUnique: jest.fn(), upsert: jest.fn() },
  };
  const permissions = { getEffectiveGrants: jest.fn() };
  const audit = { write: jest.fn().mockResolvedValue(undefined) };
  const ACTIVE = { id: 'u1', email: 'a@b.c', nameAr: 'U', nameEn: 'N', isActive: true };

  const GROUP_ADMIN = [
    { action: 'VIEW', resource: 'COMPANY', scopeType: 'GROUP', scopeId: '' },
    { action: 'UPDATE', resource: 'COMPANY', scopeType: 'GROUP', scopeId: '' },
  ];
  const COMPANY_SCOPED = [
    { action: 'VIEW', resource: 'COMPANY', scopeType: 'COMPANY', scopeId: 'c1' },
    { action: 'UPDATE', resource: 'COMPANY', scopeType: 'COMPANY', scopeId: 'c1' },
  ];
  const VIEW_ONLY = [
    { action: 'VIEW', resource: 'COMPANY', scopeType: 'GROUP', scopeId: '' },
  ];

  async function boot(): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({
      controllers: [SettingsController],
      providers: [
        SettingsService,
        PermissionsGuard,
        ScopeResolver,
        Reflector,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(undefined) } },
        { provide: TokenService, useValue: tokens },
        { provide: PrismaService, useValue: prisma },
        { provide: PermissionsService, useValue: permissions },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    return app;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    tokens.verify.mockReturnValue({ sub: 'u1' });
    prisma.user.findUnique.mockResolvedValue(ACTIVE);
    prisma.appSetting.findUnique.mockResolvedValue(null);
    prisma.appSetting.upsert.mockResolvedValue({});
    audit.write.mockResolvedValue(undefined);
    permissions.getEffectiveGrants.mockResolvedValue(GROUP_ADMIN);
  });

  it('GET returns the stored prefixes', async () => {
    const app = await boot();
    prisma.appSetting.findUnique.mockResolvedValue({ value: ['99', '98'] });
    const res = await request(app.getHttpServer()).get('/settings/entry-prefixes').set('Authorization', 'Bearer test.jwt');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ prefixes: ['99', '98'] });
    await app.close();
  });

  it('GET falls back to defaults when the row is missing', async () => {
    const app = await boot();
    const res = await request(app.getHttpServer()).get('/settings/entry-prefixes').set('Authorization', 'Bearer test.jwt');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ prefixes: ['62', '63', '67'] });
    await app.close();
  });

  it('GET without VIEW COMPANY is 403', async () => {
    const app = await boot();
    permissions.getEffectiveGrants.mockResolvedValue([]);
    const res = await request(app.getHttpServer()).get('/settings/entry-prefixes').set('Authorization', 'Bearer test.jwt');
    expect(res.status).toBe(403);
    await app.close();
  });

  it('PUT by super admin (GROUP) persists and returns 200', async () => {
    const app = await boot();
    const res = await request(app.getHttpServer())
      .put('/settings/entry-prefixes').set('Authorization', 'Bearer test.jwt')
      .send({ prefixes: ['99'] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ prefixes: ['99'] });
    expect(prisma.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ value: ['99'] }),
      }),
    );
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'PREFIXES_CHANGED' }),
    );
    await app.close();
  });

  it('PUT by a company-scoped holder is 403 (service GROUP check)', async () => {
    const app = await boot();
    permissions.getEffectiveGrants.mockResolvedValue(COMPANY_SCOPED);
    const res = await request(app.getHttpServer())
      .put('/settings/entry-prefixes').set('Authorization', 'Bearer test.jwt')
      .send({ prefixes: ['99'] });
    expect(res.status).toBe(403);
    expect(prisma.appSetting.upsert).not.toHaveBeenCalled();
    await app.close();
  });

  it('PUT without UPDATE COMPANY is 403 at the guard', async () => {
    const app = await boot();
    permissions.getEffectiveGrants.mockResolvedValue(VIEW_ONLY);
    const res = await request(app.getHttpServer())
      .put('/settings/entry-prefixes').set('Authorization', 'Bearer test.jwt')
      .send({ prefixes: ['99'] });
    expect(res.status).toBe(403);
    expect(prisma.appSetting.upsert).not.toHaveBeenCalled();
    await app.close();
  });

  it('PUT with invalid lists is 400', async () => {
    const app = await boot();
    const invalid: string[][] = [[], ['6a'], ['629']];
    for (const bad of invalid) {
      const res = await request(app.getHttpServer())
        .put('/settings/entry-prefixes').set('Authorization', 'Bearer test.jwt')
        .send({ prefixes: bad });
      expect(res.status).toBe(400);
    }
    expect(prisma.appSetting.upsert).not.toHaveBeenCalled();
    await app.close();
  });
});
