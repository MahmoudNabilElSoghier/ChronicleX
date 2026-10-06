'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Link } from '@/lib/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { entriesApi } from '@/lib/api/entries';

/** Compact preview of an already-archived entry (duplicate conflicts). */
export function ExistingEntryCard({ entryId }: { entryId: string }): JSX.Element {
  const t = useTranslations('upload');
  const query = useQuery({ queryKey: ['entries', entryId], queryFn: () => entriesApi.get(entryId) });

  if (query.isLoading) {
    return <Loader2 className="h-5 w-5 animate-spin" />;
  }
  const entry = query.data;
  if (query.isError || !entry) {
    return <p className="text-sm text-destructive">{t('conflicts.loadFailed')}</p>;
  }
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="text-muted-foreground">{t('conflicts.serial')}</dt>
        <dd className="font-mono" dir="ltr">{entry.serial}</dd>
        <dt className="text-muted-foreground">{t('conflicts.company')}</dt>
        <dd>{entry.company?.nameAr ?? '—'}</dd>
        <dt className="text-muted-foreground">{t('conflicts.project')}</dt>
        <dd>{entry.project?.nameAr ?? '—'}</dd>
        <dt className="text-muted-foreground">{t('conflicts.year')}</dt>
        <dd dir="ltr">{entry.year}</dd>
        <dt className="text-muted-foreground">{t('conflicts.uploadedBy')}</dt>
        <dd>{entry.uploadedBy?.nameAr ?? '—'}</dd>
      </dl>
      <Link href={`/entries/${entry.id}`}>
        <Button>{t('conflicts.viewExisting')}</Button>
      </Link>
    </div>
  );
}
