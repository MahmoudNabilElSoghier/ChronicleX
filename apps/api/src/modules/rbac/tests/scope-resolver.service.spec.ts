import { NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../../prisma/prisma.service';
import { ScopeResolver } from '../scope-resolver.service';

const reqWith = (source: 'params' | 'query' | 'body', key: string, value: unknown): Request =>
  ({ [source]: { [key]: value } }) as unknown as Request;

describe('ScopeResolver', () => {
  const prisma = {
    entry: { findUnique: jest.fn() },
    project: { findUnique: jest.fn() },
    company: { findUnique: jest.fn() },
  };
  const resolver = new ScopeResolver(prisma as unknown as PrismaService);

  beforeEach(() => jest.clearAllMocks());

  it('ENTRY hint resolves [PROJECT, COMPANY, GROUP] with correct IDs', async () => {
    prisma.entry.findUnique.mockResolvedValue({ projectId: 'p1', companyId: 'c1' });
    await expect(
      resolver.resolve('ENTRY', { source: 'params', key: 'id' }, reqWith('params', 'id', 'e1')),
    ).resolves.toEqual([
      { scopeType: 'PROJECT', scopeId: 'p1' },
      { scopeType: 'COMPANY', scopeId: 'c1' },
      { scopeType: 'GROUP', scopeId: '' },
    ]);
    expect(prisma.entry.findUnique).toHaveBeenCalledWith({
      where: { id: 'e1' },
      select: { projectId: true, companyId: true },
    });
  });

  it('missing entry → NotFoundException', async () => {
    prisma.entry.findUnique.mockResolvedValue(null);
    await expect(
      resolver.resolve('ENTRY', { source: 'params', key: 'id' }, reqWith('params', 'id', 'e9')),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('missing id in hint source → NotFoundException', async () => {
    await expect(
      resolver.resolve('PROJECT', { source: 'params', key: 'id' }, reqWith('params', 'id', undefined)),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.project.findUnique).not.toHaveBeenCalled();
  });

  it('COMPANY hint resolves [COMPANY, GROUP]', async () => {
    prisma.company.findUnique.mockResolvedValue({ id: 'c2' });
    await expect(
      resolver.resolve('COMPANY', { source: 'params', key: 'id' }, reqWith('params', 'id', 'c2')),
    ).resolves.toEqual([
      { scopeType: 'COMPANY', scopeId: 'c2' },
      { scopeType: 'GROUP', scopeId: '' },
    ]);
  });

  it('no hint + AUDIT resolves [GROUP]', async () => {
    await expect(resolver.resolve('AUDIT', undefined, {} as Request)).resolves.toEqual([
      { scopeType: 'GROUP', scopeId: '' },
    ]);
    expect(prisma.entry.findUnique).not.toHaveBeenCalled();
  });
});
