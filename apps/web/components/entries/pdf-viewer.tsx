'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';
import { FileX, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { entriesApi } from '@/lib/api/entries';
import { openBlob, saveBlob } from '@/lib/download';

export function PdfViewer({
  id,
  fileName,
  deleted,
}: {
  id: string;
  fileName: string;
  deleted: boolean;
}): JSX.Element {
  const t = useTranslations('entries');
  const [url, setUrl] = React.useState<string | null>(null);
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    // Deleted entries have no viewable file (backend 404s by design).
    // Never fetch — render the tombstone immediately.
    if (deleted) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setUrl(null);
    setError(false);
    entriesApi
      .download(id)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, deleted]);

  if (deleted) {
    return (
      <div className="flex h-full min-h-96 flex-col items-center justify-center gap-3 rounded-md border p-6 text-center">
        <FileX className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium">{t('fileDeleted')}</p>
        <p className="text-xs text-muted-foreground">{t('fileDeletedHint')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full min-h-96 flex-col items-center justify-center gap-4 rounded-md border p-6 text-center">
        <p className="text-sm text-muted-foreground">{t('pdfError')}</p>
        <Button
          variant="outline"
          onClick={() => {
            void entriesApi.download(id).then((blob) => saveBlob(blob, fileName));
          }}
        >
          {t('downloadFallback')}
        </Button>
        <button
          type="button"
          className="text-sm text-primary underline"
          onClick={() => {
            void entriesApi.download(id).then((blob) => openBlob(blob));
          }}
        >
          {t('openInNewTab')}
        </button>
      </div>
    );
  }

  if (!url) {
    return (
      <div className="flex h-full min-h-96 flex-col gap-4 rounded-md border p-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="truncate">{fileName}</span>
        </div>
        <Skeleton className="h-96 flex-1" />
      </div>
    );
  }

  return <iframe src={url} title={fileName} className="h-full min-h-[70vh] w-full rounded-md border-0" />;
}
