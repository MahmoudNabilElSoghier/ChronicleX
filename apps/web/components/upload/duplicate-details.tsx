'use client';

import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';
import { type ExistingEntrySummary } from '@/lib/api/entries';
import { formatDateTime } from '@/lib/format';
import { useLocalizedName } from '@/lib/use-localized-name';

interface DuplicateDetailsProps {
  existing: ExistingEntrySummary;
  entryId: string;
  fileHash?: string | undefined;
}

/**
 * Enriched duplicate-conflict block: which archived entry collides, where
 * it belongs, and who uploaded it — straight from the preview/409 payload,
 * so no follow-up fetch is needed.
 */
export function DuplicateDetails({
  existing,
  entryId,
  fileHash,
}: DuplicateDetailsProps): JSX.Element {
  const t = useTranslations('upload');
  const locale = useLocale();
  const localize = useLocalizedName();
  return (
    <div className="mt-1 space-y-1">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
        <span className="text-sm font-medium">{t('bulk.duplicateHeader')}</span>
      </div>
      {fileHash ? (
        <p className="ps-6 font-mono text-xs text-muted-foreground" dir="ltr">
          {t('bulk.hashShort', { hash: fileHash.slice(0, 8) })}
        </p>
      ) : null}
      <ul className="space-y-0.5 ps-6 text-xs text-muted-foreground">
        <li>
          {t('bulk.duplicateOriginalSerial', { serial: existing.serial, year: existing.year })}
        </li>
        <li>
          {t('bulk.duplicateCompany', {
            name: localize(existing.company, { fallback: 'empty' }).text,
          })}
        </li>
        <li>
          {t('bulk.duplicateProject', {
            name: localize(existing.project, { fallback: 'empty' }).text,
          })}
        </li>
        <li>
          {t('bulk.duplicateUploader', {
            name: localize(existing.uploadedBy, { fallback: 'empty' }).text,
            date: formatDateTime(existing.createdAt, locale),
          })}
        </li>
      </ul>
      <a
        href={`/${locale}/entries/${entryId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block ps-6 text-xs text-primary underline-offset-4 hover:underline"
      >
        {t('bulk.viewExisting')}
      </a>
    </div>
  );
}
