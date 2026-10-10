import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { PermissionsService } from '../../rbac/permissions.service';
import { SettingsService } from '../settings.service';

describe('SettingsService', () => {
  const prisma = {
    appSetting: { findUnique: jest.fn(), upsert: jest.fn() },
  };
  const permissions = { getEffectiveGrants: jest.fn() };
  const audit = { write: jest.fn() };
  const ACTOR = { userId: 'u1', ip: '1.2.3.4', userAgent: 'ua' };

  const svc = new SettingsService(
    prisma as unknown as PrismaService,
    permissions as unknown as PermissionsService,
    audit as unknown as AuditService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.appSetting.findUnique.mockResolvedValue(null);
    prisma.appSetting.upsert.mockResolvedValue({});
    audit.write.mockResolvedValue(undefined);
    permissions.getEffectiveGrants.mockResolvedValue([
      { action: 'UPDATE', resource: 'COMPANY', scopeType: 'GROUP', scopeId: '' },
    ]);
  });

  it('onModuleInit loads stored prefixes; missing row keeps code defaults', async () => {
    expect(svc.getEntryPrefixes()).toEqual(['62', '63', '67']);
    prisma.appSetting.findUnique.mockResolvedValueOnce({
      key: 'entry-prefixes',
      value: ['99'],
      updatedAt: new Date(),
      updatedBy: null,
    });
    await svc.onModuleInit();
    expect(svc.getEntryPrefixes()).toEqual(['99']);
  });

  it('readEntryPrefixes is DB-authoritative with a defaults fallback', async () => {
    prisma.appSetting.findUnique.mockResolvedValueOnce({ value: ['99'] });
    await expect(svc.readEntryPrefixes()).resolves.toEqual({ prefixes: ['99'] });
    prisma.appSetting.findUnique.mockResolvedValueOnce(null);
    await expect(svc.readEntryPrefixes()).resolves.toEqual({ prefixes: ['62', '63', '67'] });
  });

  it('updateEntryPrefixes persists, refreshes the sync cache and audits', async () => {
    prisma.appSetting.findUnique.mockResolvedValue({ value: ['62'] });
    const res = await svc.updateEntryPrefixes(['99', '98'], ACTOR);
    expect(res).toEqual({ prefixes: ['99', '98'] });
    expect(prisma.appSetting.upsert).toHaveBeenCalledWith({
      where: { key: 'entry-prefixes' },
      update: { value: ['99', '98'], updatedBy: 'u1' },
      create: { key: 'entry-prefixes', value: ['99', '98'], updatedBy: 'u1' },
    });
    expect(svc.getEntryPrefixes()).toEqual(['99', '98']);
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        action: 'UPDATE',
        resource: 'COMPANY',
        event: 'PREFIXES_CHANGED',
        oldValues: { prefixes: ['62'] },
        newValues: { prefixes: ['99', '98'] },
        ipAddress: '1.2.3.4',
        userAgent: 'ua',
      }),
    );
  });

  it('rejects invalid lists with 400 and writes nothing', async () => {
    const invalid: string[][] = [[], ['6'], ['6a'], ['629'], ['62', '62a']];
    for (const bad of invalid) {
      await expect(svc.updateEntryPrefixes(bad, ACTOR)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
    expect(prisma.appSetting.upsert).not.toHaveBeenCalled();
    expect(audit.write).not.toHaveBeenCalled();
  });

  it('rejects a company-scoped UPDATE COMPANY holder (GROUP check only)', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([
      { action: 'UPDATE', resource: 'COMPANY', scopeType: 'COMPANY', scopeId: 'c1' },
    ]);
    await expect(svc.updateEntryPrefixes(['99'], ACTOR)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.appSetting.upsert).not.toHaveBeenCalled();
  });

  it('a rejected list never poisons the next valid save — upsert still runs', async () => {
    // Regression: validation short-circuits BEFORE the GROUP check and the
    // upsert; a following well-formed call must reach prisma.appSetting.upsert
    // with the full list (the /admin/settings save path).
    await expect(svc.updateEntryPrefixes(['6'], ACTOR)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.appSetting.upsert).not.toHaveBeenCalled();

    const res = await svc.updateEntryPrefixes(['62', '63', '67', '99'], ACTOR);
    expect(res).toEqual({ prefixes: ['62', '63', '67', '99'] });
    expect(prisma.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'entry-prefixes' },
        update: { value: ['62', '63', '67', '99'], updatedBy: 'u1' },
        create: { key: 'entry-prefixes', value: ['62', '63', '67', '99'], updatedBy: 'u1' },
      }),
    );
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'PREFIXES_CHANGED' }),
    );
  });
});
