import { z } from 'zod';

// Placeholder schemas — domain schemas land in Phase 2+.
export const localeSchema = z.enum(['ar', 'en']);
export const healthSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  uptime: z.number(),
  timestamp: z.string(),
});

// Mirrors the Prisma enums (apps/api/prisma/schema.prisma). Keep in sync.
export const ActionEnum = z.enum(['CREATE', 'UPDATE', 'DELETE', 'RESTORE', 'VIEW', 'EXPORT']);
export const ResourceEnum = z.enum(['ENTRY', 'PROJECT', 'COMPANY', 'USER', 'AUDIT', 'AUTH']);
export const ScopeTypeEnum = z.enum(['GROUP', 'COMPANY', 'PROJECT']);

export const roleGrantSchema = z.object({
  name: z.string(),
  scopeType: ScopeTypeEnum,
  scopeId: z.string(),
});

export const loginResponseSchema = z.object({
  accessToken: z.string(),
  user: z.object({
    id: z.string(),
    email: z.string(),
    nameAr: z.string(),
    nameEn: z.string(),
  }),
});

export const currentUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  nameAr: z.string(),
  nameEn: z.string(),
  isActive: z.boolean(),
  roles: z.array(roleGrantSchema),
});

// Stub for 7b-2 (entries list). Full filters land with the list UI.
export const entryListQuerySchema = z.object({
  companyId: z.string().optional(),
  projectId: z.string().optional(),
  year: z.coerce.number().int().optional(),
  typePrefix: z.string().optional(),
  serial: z.string().optional(),
  q: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
