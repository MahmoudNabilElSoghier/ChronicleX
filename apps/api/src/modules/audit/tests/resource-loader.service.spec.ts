import { PrismaService } from '../../../prisma/prisma.service';
import { ResourceLoaderService } from '../resource-loader.service';

describe('ResourceLoaderService', () => {
  const prisma = {
    entry: { findUnique: jest.fn() },
    project: { findUnique: jest.fn() },
    company: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    role: { findUnique: jest.fn() },
    permission: { findUnique: jest.fn() },
  };
  const loader = new ResourceLoaderService(prisma as unknown as PrismaService);

  beforeEach(() => jest.clearAllMocks());

  it('ENTRY loads via prisma.entry', async () => {
    prisma.entry.findUnique.mockResolvedValue({ id: 'e1' });
    await expect(loader.load('ENTRY', 'e1')).resolves.toEqual({ id: 'e1' });
    expect(prisma.entry.findUnique).toHaveBeenCalledWith({ where: { id: 'e1' } });
  });

  it('USER strips passwordHash', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.c', passwordHash: 'h' });
    await expect(loader.load('USER', 'u1')).resolves.toEqual({ id: 'u1', email: 'a@b.c' });
  });

  it('AUTH returns null without touching Prisma', async () => {
    await expect(loader.load('AUTH', 'x')).resolves.toBeNull();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('Prisma errors resolve to null and never throw', async () => {
    prisma.project.findUnique.mockRejectedValue(new Error('db down'));
    await expect(loader.load('PROJECT', 'p1')).resolves.toBeNull();
  });
});
