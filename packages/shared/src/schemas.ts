import { z } from 'zod';

// Placeholder schemas — domain schemas land in Phase 2+.
export const localeSchema = z.enum(['ar', 'en']);
export const healthSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  uptime: z.number(),
  timestamp: z.string(),
});
