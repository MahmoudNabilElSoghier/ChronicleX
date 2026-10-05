'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';
import { CheckCircle2, Loader2, RotateCcw, Trash2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Dropzone } from '@/components/upload/dropzone';
import { ExistingEntryCard } from '@/components/upload/existing-entry-card';
import { ScopeSelectors } from '@/components/upload/scope-selectors';
import { type BulkResult } from '@/lib/api/entries';
import { formatBytes } from '@/lib/format';
import { useActiveJobs } from '@/lib/upload/active-jobs-context';
import { useUploadQueue } from '@/lib/upload/use-upload-queue';

function ConflictPreview({ entryId, onClose }: { entryId: string; onClose: () => void }): JSX.Element {
  const t = useTranslations('upload');
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{t('conflicts.title')}</DialogTitle>
      </DialogHeader>
      <ExistingEntryCard entryId={entryId} />
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t('conflicts.close')}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

export function BulkTab(): JSX.Element {
  const t = useTranslations('upload');
  const queue = useUploadQueue();
  const activeJobs = useActiveJobs();
  const [scope, setScope] = React.useState({ companyId: '', projectId: '', year: '' });
  const [previewId, setPreviewId] = React.useState<string | null>(null);

  const scopeValid =
    scope.companyId !== '' && scope.projectId !== '' && /^\d{4}$/.test(scope.year);
  const canSubmit = queue.totalValid > 0 && scopeValid && !queue.isSubmitting && queue.jobId === null;

  const resultsByName = React.useMemo(() => {
    const map = new Map<string, BulkResult[]>();
    for (const r of queue.jobStatus?.results ?? []) {
      const list = map.get(r.originalName) ?? [];
      list.push(r);
      map.set(r.originalName, list);
    }
    return map;
  }, [queue.jobStatus]);

  function resultFor(itemName: string): BulkResult | undefined {
    const list = resultsByName.get(itemName);
    return list?.find((r) => r.status === 'error') ?? list?.[0];
  }

  async function submit(): Promise<void> {
    if (!canSubmit) return;
    await queue.submit({
      companyId: scope.companyId,
      projectId: scope.projectId,
      year: Number(scope.year),
    });
  }

  React.useEffect(() => {
    if (queue.jobId) activeJobs?.track(queue.jobId);
  }, [queue.jobId, activeJobs]);

  const status = queue.jobStatus;
  const done = status?.status === 'done' || status?.status === 'failed';

  return (
    <div className="space-y-4">
      {queue.jobId === null ? (
        <>
          <Dropzone multiple onFiles={(files) => queue.addFiles(files)} disabled={queue.isSubmitting} />
          {queue.items.length > 0 ? (
            <Card>
              <CardContent className="space-y-3 p-4">
                <p className="text-sm text-muted-foreground">
                  {t('bulk.summary', { valid: queue.totalValid, invalid: queue.totalInvalid })}
                </p>
                <ul className="divide-y">
                  {queue.items.map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate font-mono" dir="ltr">
                          {item.name}
                        </span>
                        <span className="text-xs text-muted-foreground" dir="ltr">
                          {formatBytes(item.size)}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {item.parse.ok ? (
                          <span className="flex items-center gap-1 text-xs text-green-700">
                            <CheckCircle2 className="h-4 w-4" />
                            {t('bulk.valid')}
                          </span>
                        ) : (
                          <span
                            className="flex items-center gap-1 text-xs text-destructive"
                            title={t(`errors.${item.parse.code}`)}
                          >
                            <XCircle className="h-4 w-4" />
                            {t(`errors.${item.parse.code}`)}
                          </span>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => queue.removeItem(item.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </span>
                    </li>
                  ))}
            </ul>
            {done ? (
              <p className="text-sm font-medium">
                {t('bulk.finished', {
                  succeeded: status?.succeeded ?? 0,
                  total: status?.total ?? 0,
                  failed: status?.failed ?? 0,
                })}
              </p>
            ) : null}
                <ScopeSelectors value={scope} onChange={setScope} disabled={queue.isSubmitting} />
                <div className="flex gap-2">
                  <Button onClick={() => void submit()} disabled={!canSubmit}>
                    {t('bulk.submit')}
                  </Button>
                  <Button variant="outline" onClick={() => queue.clear()}>
                    {t('bulk.clear')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : (
        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="flex items-center justify-between text-sm">
              <span>
                {t('bulk.progress', {
                  processed: status?.processed ?? 0,
                  total: status?.total ?? queue.items.length,
                })}
              </span>
              {!done ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            </div>
            <div className="h-2 overflow-hidden rounded bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{
                  width: `${Math.round(
                    ((status?.processed ?? 0) / Math.max(status?.total ?? 1, 1)) * 100,
                  )}%`,
                }}
              />
            </div>
            <ul className="divide-y">
              {queue.items.map((item) => {
                const result = resultFor(item.name);
                return (
                  <li key={item.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-mono" dir="ltr">
                        {item.name}
                      </span>
                      {result?.status === 'error' ? (
                        <span className="text-xs text-destructive">
                          {result.errorCode === 'DUPLICATE_SERIAL'
                            ? t('conflicts.duplicateSerial')
                            : result.errorCode === 'DUPLICATE_FILE'
                              ? t('conflicts.duplicateFile')
                              : (result.errorMessage ?? result.errorCode)}
                        </span>
                      ) : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {!result ? (
                        <span className="text-xs text-muted-foreground">{t('bulk.waiting')}</span>
                      ) : result.status === 'ok' ? (
                        <span className="flex items-center gap-1 text-xs text-green-700">
                          <CheckCircle2 className="h-4 w-4" />
                          {t('bulk.done')}
                        </span>
                      ) : (
                        <>
                          <span className="flex items-center gap-1 text-xs text-destructive">
                            <XCircle className="h-4 w-4" />
                            {t('bulk.failed')}
                          </span>
                          {(result.errorCode === 'DUPLICATE_SERIAL' ||
                            result.errorCode === 'DUPLICATE_FILE') &&
                          result.existingEntryId ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setPreviewId(result.existingEntryId as string)}
                            >
                              {t('conflicts.viewExisting')}
                            </Button>
                          ) : (
                            <Button variant="ghost" size="sm" onClick={() => queue.retryItem(item.id)}>
                              <RotateCcw className="h-4 w-4" />
                              {t('retry')}
                            </Button>
                          )}
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => queue.clear()}>
                {t('bulk.newBatch')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={previewId !== null} onOpenChange={(open) => !open && setPreviewId(null)}>
        {previewId ? <ConflictPreview entryId={previewId} onClose={() => setPreviewId(null)} /> : null}
      </Dialog>
    </div>
  );
}
