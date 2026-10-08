'use client';

import { useLocale, useTranslations } from 'next-intl';
import * as React from 'react';
import { CheckCircle2, Clock, Info, Loader2, RotateCcw, Trash2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dropzone } from '@/components/upload/dropzone';
import { DuplicateDetails } from '@/components/upload/duplicate-details';
import { ScopeSelectors } from '@/components/upload/scope-selectors';
import { type BulkResult } from '@/lib/api/entries';
import { formatBytes } from '@/lib/format';
import { useActiveJobs } from '@/lib/upload/active-jobs-context';
import { HASH_CAP, type UploadItem, useUploadQueue } from '@/lib/upload/use-upload-queue';

interface ResultRow {
  key: string;
  name: string;
  result?: BulkResult | undefined;
  canRetry: boolean;
}

export function BulkTab(): JSX.Element {
  const t = useTranslations('upload');
  const locale = useLocale();
  const [scope, setScope] = React.useState({ companyId: '', projectId: '', year: '' });
  const queue = useUploadQueue(scope);
  const activeJobs = useActiveJobs();
  const track = activeJobs?.track;

  const scopeValid =
    scope.companyId !== '' && scope.projectId !== '' && /^\d{4}$/.test(scope.year);
  const canSubmit = queue.submittable > 0 && scopeValid && !queue.isSubmitting && queue.jobId === null;
  const overCap = queue.items.length > HASH_CAP;

  // Summary mirrors the effective row states (check machine), never the
  // filename parse: pending rows add a third count, deferred batches the
  // "(checked at upload)" suffix — both hidden at zero.
  const counts = queue.checkCounts;
  const summaryText =
    counts.deferred > 0
      ? t('bulk.summaryDeferred', { valid: counts.valid, invalid: counts.invalid })
      : counts.pending > 0
        ? t('bulk.summaryPending', {
            valid: counts.valid,
            invalid: counts.invalid,
            pending: counts.pending,
          })
        : t('bulk.summary', { valid: counts.valid, invalid: counts.invalid });

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

  function checkReasonText(item: UploadItem): string {
    const r = item.checkReason;
    if (r === 'duplicate_serial') return t('conflicts.duplicateSerial');
    if (r === 'duplicate_hash') return t('conflicts.duplicateFile');
    if (r === 'invalid_filename') return t('bulk.invalidFilename');
    if (r) return t(`errors.${r}`);
    return t('bulk.invalidFilename');
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
    if (queue.jobId) track?.(queue.jobId);
  }, [queue.jobId, track]);

  const status = queue.jobStatus;
  const done = status?.status === 'done' || status?.status === 'failed';

  // After a reload the queue is empty but the persisted job's report still
  // renders: fall back to rows derived from jobStatus.results.
  const resultRows: ResultRow[] =
    queue.items.length > 0
      ? queue.items.map((item) => ({
          key: item.id,
          name: item.name,
          result: resultFor(item.name),
          canRetry: true,
        }))
      : (status?.results ?? []).map((r, i) => ({
          key: `${r.originalName}-${i}`,
          name: r.originalName,
          result: r,
          canRetry: false,
        }));

  return (
    <div className="space-y-4">
      {queue.jobId === null ? (
        <>
          <Dropzone multiple onFiles={(files) => queue.addFiles(files)} disabled={queue.isSubmitting} />
          {queue.items.length > 0 ? (
            <Card>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
                  <span>{summaryText}</span>
                  {overCap ? (
                    <span
                      className="inline-flex cursor-help items-center"
                      title={t('bulk.deferredInfo')}
                      aria-label={t('bulk.deferredInfo')}
                    >
                      <Info className="h-3.5 w-3.5" />
                    </span>
                  ) : null}
                </div>
                {overCap ? (
                  <p className="text-xs text-muted-foreground">{t('bulk.deferredNote')}</p>
                ) : null}
                <ul className="divide-y">
                  {queue.items.map((item) => {
                    // enriched block replaces the plain reason + link when
                    // the preview carried the original entry's summary
                    const enriched =
                      item.check === 'invalid' &&
                      item.existing !== undefined &&
                      item.existingEntryId !== undefined;
                    return (
                      <li key={item.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <div className="min-w-0">
                          <span className="block truncate font-mono" dir="ltr">
                            {item.name}
                          </span>
                          <span className="text-xs text-muted-foreground" dir="ltr">
                            {formatBytes(item.size)}
                          </span>
                          {item.check === 'invalid' &&
                          item.existing !== undefined &&
                          item.existingEntryId !== undefined ? (
                            <DuplicateDetails
                              existing={item.existing}
                              entryId={item.existingEntryId}
                              fileHash={item.fileHash}
                            />
                          ) : item.check === 'invalid' && item.existingEntryId ? (
                            <a
                              href={`/${locale}/entries/${item.existingEntryId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block text-xs text-muted-foreground underline hover:text-foreground"
                            >
                              {t('conflicts.viewExisting')}
                            </a>
                          ) : null}
                        </div>
                        <span className="flex shrink-0 items-center gap-2">
                          {item.check === 'valid' ? (
                            <span className="flex items-center gap-1 text-xs text-green-700">
                              <CheckCircle2 className="h-4 w-4" />
                              {t('bulk.valid')}
                            </span>
                          ) : item.check === 'pending_check' ? (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              {t('bulk.checking')}
                            </span>
                          ) : item.check === 'pending_scope' ? (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Clock className="h-4 w-4" />
                              {t('bulk.pendingScope')}
                            </span>
                          ) : item.check === 'deferred' ? (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Clock className="h-4 w-4" />
                              {t('bulk.deferred')}
                            </span>
                          ) : enriched ? null : (
                            <span
                              className="flex items-center gap-1 text-xs text-destructive"
                              title={checkReasonText(item)}
                            >
                              <XCircle className="h-4 w-4" />
                              {checkReasonText(item)}
                            </span>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => queue.removeItem(item.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
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
            {done ? (
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {t('bulk.finished', {
                    succeeded: status?.succeeded ?? 0,
                    total: status?.total ?? 0,
                    failed: status?.failed ?? 0,
                  })}
                </p>
                <p className="text-xs text-muted-foreground">{t('bulk.savedNote')}</p>
              </div>
            ) : null}
            <ul className="divide-y">
              {resultRows.map((row) => (
                <li key={row.key} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-mono" dir="ltr">
                      {row.name}
                    </span>
                    {row.result?.status === 'error' ? (
                      <span className="text-xs text-destructive">
                        {row.result.errorCode === 'DUPLICATE_SERIAL'
                          ? t('conflicts.duplicateSerial')
                          : row.result.errorCode === 'DUPLICATE_FILE'
                            ? t('conflicts.duplicateFile')
                            : (row.result.errorMessage ?? row.result.errorCode)}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {!row.result ? (
                      <span className="text-xs text-muted-foreground">{t('bulk.waiting')}</span>
                    ) : row.result.status === 'ok' ? (
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
                        {(row.result.errorCode === 'DUPLICATE_SERIAL' ||
                          row.result.errorCode === 'DUPLICATE_FILE') &&
                        row.result.existingEntryId ? (
                          <a
                            href={`/${locale}/entries/${row.result.existingEntryId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-md border border-input bg-transparent px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground"
                          >
                            {t('conflicts.viewExisting')}
                          </a>
                        ) : row.canRetry ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => queue.retryItem(row.key)}
                          >
                            <RotateCcw className="h-4 w-4" />
                            {t('retry')}
                          </Button>
                        ) : null}
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => queue.clear()}>
                {t('bulk.newBatch')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
