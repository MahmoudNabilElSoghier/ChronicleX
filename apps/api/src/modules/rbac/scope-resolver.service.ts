import { Injectable, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import type { Resource } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { ScopeChain, ScopeHint } from './types';

const GROUP_ROOT: ScopeChain = [{ scopeType: 'GROUP', scopeId: '' }];

@Injectable()
export class ScopeResolver {
  constructor(private readonly prisma: PrismaService) {}

  private resourceId(hint: ScopeHint | undefined, req: Request): string | undefined {
    if (!hint) return undefined;
    const bag = req[hint.source] as Record<string, unknown> | undefined;
    const value = bag?.[hint.key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  async resolve(resource: Resource, hint: ScopeHint | undefined, req: Request): Promise<ScopeChain> {
    const effective: Resource = hint?.resolveAs ?? resource;
    // The guard only resolves when scopeHint is set; handlers without one do
    // their own row filtering. A missing hint here is a wiring bug → loud 404.
    switch (effective) {
      case 'ENTRY': {
        const id = this.resourceId(hint, req);
        if (!id) throw new NotFoundException('Entry id is required');
        const entry = await this.prisma.entry.findUnique({
          where: { id },
          select: { projectId: true, companyId: true },
        });
        if (!entry) throw new NotFoundException('Entry not found');
        return [
          { scopeType: 'PROJECT', scopeId: entry.projectId },
          { scopeType: 'COMPANY', scopeId: entry.companyId },
          ...GROUP_ROOT,
        ];
      }
      case 'PROJECT': {
        const id = this.resourceId(hint, req);
        if (!id) throw new NotFoundException('Project id is required');
        const project = await this.prisma.project.findUnique({
          where: { id },
          select: { companyId: true },
        });
        if (!project) throw new NotFoundException('Project not found');
        return [
          { scopeType: 'PROJECT', scopeId: id },
          { scopeType: 'COMPANY', scopeId: project.companyId },
          ...GROUP_ROOT,
        ];
      }
      case 'COMPANY': {
        const id = this.resourceId(hint, req);
        if (!id) throw new NotFoundException('Company id is required');
        const company = await this.prisma.company.findUnique({
          where: { id },
          select: { id: true },
        });
        if (!company) throw new NotFoundException('Company not found');
        return [{ scopeType: 'COMPANY', scopeId: id }, ...GROUP_ROOT];
      }
      case 'USER':
      case 'AUDIT':
      case 'AUTH':
        return [...GROUP_ROOT];
      default:
        return [...GROUP_ROOT];
    }
  }
}
