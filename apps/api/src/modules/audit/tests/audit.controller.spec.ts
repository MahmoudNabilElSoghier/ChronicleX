import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { PermissionsService } from '../../rbac/permissions.service';
import { AuditController } from '../audit.controller';
import { AuditService } from '../audit.service';

describe('AuditController', () => {
  const prisma = {
    auditLog: { findMany: jest.fn() },
  };
  const permissions = { getEffectiveGrants: jest.fn() };
  const service = new AuditService(
    prisma as unknown as PrismaService,
    permissions as unknown as PermissionsService,
  );
  const controller = new AuditController(service);
  const admin = { id: 'admin1', email: 'a@b.c', nameAr: 'ن', nameEn: 'N', isActive: true };

  beforeEach(() => jest.clearAllMocks());

  it('COMPANY_ADMIN has VIEW AUDIT grant but /audit-logs returns 403 until scoped reads land', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([
      { action: 'VIEW', resource: 'AUDIT', scopeType: 'COMPANY', scopeId: 'c1' },
    ]);
    await expect(controller.list({ limit: 50 } as never, admin)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
  });

  it('GROUP VIEW AUDIT lists rows', async () => {
    permissions.getEffectiveGrants.mockResolvedValue([
      { action: 'VIEW', resource: 'AUDIT', scopeType: 'GROUP', scopeId: '' },
    ]);
    prisma.auditLog.findMany.mockResolvedValue([]);
    const res = (await controller.list({ limit: 50 } as never, admin)) as Record<string, unknown>;
    expect(res.items).toEqual([]);
  });
});
