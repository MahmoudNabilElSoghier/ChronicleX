'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dropzone } from '@/components/upload/dropzone';
import { ExistingEntryCard } from '@/components/upload/existing-entry-card';
import { ScopeSelectors } from '@/components/upload/scope-selectors';
import { formatBytes } from '@/lib/format';
import { useUploadQueue } from '@/lib/upload/use-upload-queue';

export function SingleTab(): JSX.Element {
  const t = useTranslations('upload');
  const router = useRouter();
  const queue = useUploadQueue();
  const [scope, setScope] = React.useState({ companyId: '', projectId: '', year: '' });

  const item = queue.items[0];
  const scopeValid =
    scope.companyId !== '' && scope.projectId !== '' && /^\d{4}$/.test(scope.year);
  const canSubmit = item !== undefined && item.parse.ok && scopeValid && !queue.isSubmitting;

  async function submit(): Promise<void> {
    if (!canSubmit || !item) return;
    try {
      await queue.submit({
        companyId: scope.companyId,
        projectId: scope.projectId,
        year: Number(scope.year),
      });
    } catch {
      toast.error(t('single.failed'));
    }
  }

  const doneItem = queue.items.find((i) => i.status === 'done');

  if (doneItem?.entryId) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          <CheckCircle2 className="h-12 w-12 text-green-600" />
          <p className="font-medium">{t('single.success')}</p>
          <p className="font-mono text-sm text-muted-foreground" dir="ltr">
            {doneItem.serial}
          </p>
          <div className="flex gap-2">
            <Button onClick={() => router.push(`/entries/${doneItem.entryId}`)}>
              {t('single.viewEntry')}
            </Button>
            <Button variant="outline" onClick={() => queue.clear()}>
              {t('single.uploadAnother')}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {!item ? (
        <Dropzone multiple={false} onFiles={(files) => queue.addFiles(files)} disabled={queue.isSubmitting} />
      ) : (
        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-mono text-sm" dir="ltr">
                  {item.name}
                </p>
                <p className="text-xs text-muted-foreground" dir="ltr">
                  {formatBytes(item.size)}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => queue.removeItem(item.id)}>
                {t('single.remove')}
              </Button>
            </div>
            {item.parse.ok ? (
              <p className="flex items-center gap-2 text-sm text-green-700">
                <CheckCircle2 className="h-4 w-4" />
                {t('single.valid', { serial: item.parse.serial })}
              </p>
            ) : (
              <p className="flex items-center gap-2 text-sm text-destructive">
                <XCircle className="h-4 w-4" />
                {t(`errors.${item.parse.code}`)}
              </p>
            )}
            <ScopeSelectors value={scope} onChange={setScope} disabled={queue.isSubmitting} />
            {queue.isSubmitting ? (
              <div className="h-2 overflow-hidden rounded bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${item.progress}%` }}
                />
              </div>
            ) : null}
            {item.status === 'failed' ? (
              (item.errorCode === 'DUPLICATE_SERIAL' || item.errorCode === 'DUPLICATE_FILE') &&
              item.existingEntryId ? (
                <div className="space-y-3 rounded-md border p-3">
                  <p className="text-sm font-medium text-destructive">
                    {item.errorCode === 'DUPLICATE_SERIAL'
                      ? t('conflicts.duplicateSerial')
                      : t('conflicts.duplicateFile')}
                  </p>
                  <ExistingEntryCard entryId={item.existingEntryId} />
                </div>
              ) : (
                <p className="text-sm text-destructive">{item.errorMessage ?? item.errorCode}</p>
              )
            ) : null}
            <Button onClick={() => void submit()} disabled={!canSubmit} className="w-full">
              {t('single.submit')}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
