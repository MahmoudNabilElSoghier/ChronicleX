import { Injectable } from '@nestjs/common';
import type { Resource } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Best-effort pre/post images for audited rows. Never throws — returns null
 * on unknown resources or Prisma errors. Callers treat null as "no image".
 */
@Injectable()
export class ResourceLoaderService {
  constructor(private readonly prisma: PrismaService) {}

  async load(resource: Resource, id: string): Promise<Record<string, unknown> | null> {
    try {
      switch (resource) {
        case 'ENTRY':
          return (await this.prisma.entry.findUnique({ where: { id } })) as unknown as Record<
            string,
            unknown
          > | null;
        case 'PROJECT':
          return (await this.prisma.project.findUnique({ where: { id } })) as unknown as Record<
            string,
            unknown
          > | null;
        case 'COMPANY':
          return (await this.prisma.company.findUnique({ where: { id } })) as unknown as Record<
            string,
            unknown
          > | null;
        case 'USER': {
          const user = await this.prisma.user.findUnique({ where: { id } });
          if (!user) return null;
          const safe = { ...(user as unknown as Record<string, unknown>) };
          delete safe.passwordHash;
          return safe;
        }
        case 'AUDIT':
        case 'AUTH':
          return null;
        default:
          return null;
      }
    } catch {
      return null;
    }
  }
}
