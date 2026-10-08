import type { PrismaService } from '../../prisma/prisma.service';

/** Summary of an already-archived entry, attached to duplicate responses. */
export interface ExistingEntrySummary {
  serial: string;
  year: number;
  company: { nameAr: string; nameEn: string; code: number };
  project: { nameAr: string; nameEn: string; code: string };
  uploadedBy: { nameAr: string; nameEn: string };
  createdAt: string;
}

interface ExistingEntryRow {
  serial: string;
  year: number;
  company: { nameAr: string; nameEn: string; code: number };
  project: { nameAr: string; nameEn: string; code: string };
  uploader: { nameAr: string; nameEn: string };
  createdAt: Date;
}

function toExistingSummary(row: ExistingEntryRow): ExistingEntrySummary {
  return {
    serial: row.serial,
    year: row.year,
    company: row.company,
    project: row.project,
    uploadedBy: row.uploader,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Enrichment for duplicate responses — best effort. The conflict itself
 * already carries `existingEntryId`, so a failed summary fetch degrades the
 * payload instead of failing the preview/409.
 */
export async function fetchExistingSummaries(
  prisma: PrismaService,
  ids: string[],
): Promise<Map<string, ExistingEntrySummary>> {
  if (ids.length === 0) return new Map();
  try {
    const rows = await prisma.entry.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        serial: true,
        year: true,
        company: { select: { nameAr: true, nameEn: true, code: true } },
        project: { select: { nameAr: true, nameEn: true, code: true } },
        uploader: { select: { nameAr: true, nameEn: true } },
        createdAt: true,
      },
    });
    return new Map(rows.map((row) => [row.id, toExistingSummary(row)]));
  } catch {
    return new Map();
  }
}

export async function fetchExistingSummary(
  prisma: PrismaService,
  id: string,
): Promise<ExistingEntrySummary | null> {
  const map = await fetchExistingSummaries(prisma, [id]);
  return map.get(id) ?? null;
}
