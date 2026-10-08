'use client';

import { useRouter } from '@/lib/navigation';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dropzone } from '@/components/upload/dropzone';
import { DuplicateDetails } from '@/components/upload/duplicate-details';
import { ExistingEntryCard } from '@/components/upload/existing-entry-card';
import { ScopeSelectors } from '@/components/upload/scope-selectors';
import { formatBytes } from '@/lib/format';
import { useUploadQueue } from '@/lib/upload/use-upload-queue';

/**
 * Single-entry badge state mirrors the queue's check machine (the same
 * machine the bulk tab renders): the filename parse alone must never
 * show a green "valid" for a known duplicate.
 */
type SingleStatus =
  | 'idle'
  | 'pending_scope'
  | 'pending_check'
  | 'valid'
  | 'invalid'
  | 'deferred';

export function SingleTab(): JSX.Element {
  const t = useTranslations('upload');
  const router = useRouter();
  const [scope, setScope] = React.useState({ companyId: '', projectId: '', year: '' });
  // Scope is passed through so the queue runs the same pre-flight preview
  // the bulk tab uses (1-element array).
  const queue = useUploadQueue(scope);

  const item = queue.items[0];
  const scopeValid =
    scope.companyId !== '' && scope.projectId !== '' && /^\d{4}$/.test(scope.year);

  function computeStatus(): SingleStatus {
    if (!item) return 'idle';
    if (item.status === 'failed') return 'invalid';
    if (!item.parse.ok) return 'invalid';
    switch (item.check) {
      case 'valid':
        return 'valid';
      case 'invalid':
        return 'invalid';
      case 'deferred':
        return 'deferred';
      case 'pending_check':
        return 'pending_check';
      default:
        return 'pending_scope';
    }
  }
  const status = computeStatus();

  const dupRejected =
    item?.errorCode === 'DUPLICATE_SERIAL' || item?.errorCode === 'DUPLICATE_FILE';
  // A transient failure (network/5xx) may be retried; a duplicate never can.
  const retryable =
    item !== undefined &&
    item.status === 'failed' &&
    !dupRejected &&
    item.check !== 'invalid';
  const canSubmit =
    item !== undefined &&
    scopeValid &&
    !queue.isSubmitting &&
    (status === 'valid' || status === 'deferred' || retryable);

  function reasonText(): string {
    if (!item) return '';
    if (item.checkReason === 'duplicate_serial' || item.errorCode === 'DUPLICATE_SERIAL') {
      return t('conflicts.duplicateSerial');
    }
    if (item.checkReason === 'duplicate_hash' || item.errorCode === 'DUPLICATE_FILE') {
      return t('conflicts.duplicateFile');
    }
    if (!item.parse.ok) return t(`errors.${item.parse.code}`);
    if (item.status === 'failed') return t('single.failed');
    return t('bulk.invalidFilename');
  }

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
            {status === 'idle' ? null : status === 'valid' ? (
              <p className="flex items-center gap-2 text-sm text-green-700">
                <CheckCircle2 className="h-4 w-4" />
                {t('single.valid')}
              </p>
            ) : status === 'invalid' ? (
              <p className="flex items-center gap-2 text-sm text-destructive">
                <XCircle className="h-4 w-4" />
                {`✗ ${reasonText()}`}
              </p>
            ) : status === 'pending_check' ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('single.checkingDup')}
              </p>
            ) : status === 'deferred' ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                {t('bulk.deferred')}
              </p>
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                {t('bulk.pendingScope')}
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
            {item.existingEntryId && item.existing ? (
              <DuplicateDetails existing={item.existing} entryId={item.existingEntryId} />
            ) : item.existingEntryId &&
              (item.check === 'invalid' || item.status === 'failed') ? (
              <div className="space-y-3 rounded-md border p-3">
                <p className="text-sm font-medium text-destructive">
                  {item.errorCode === 'DUPLICATE_FILE' || item.checkReason === 'duplicate_hash'
                    ? t('conflicts.duplicateFile')
                    : t('conflicts.duplicateSerial')}
                </p>
                <ExistingEntryCard entryId={item.existingEntryId} />
              </div>
            ) : item.status === 'failed' ? (
              <p className="text-sm text-destructive">{item.errorMessage ?? item.errorCode}</p>
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
