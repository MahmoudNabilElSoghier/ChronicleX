'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';
import { Eye, FileText, FileX, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { entriesApi } from '@/lib/api/entries';
import { openBlob, saveBlob } from '@/lib/download';
import { formatBytes } from '@/lib/format';

export function PdfViewer({
  id,
  fileName,
  fileSize,
  deleted,
}: {
  id: string;
  fileName: string;
  fileSize: number;
  deleted: boolean;
}): JSX.Element {
  const t = useTranslations('entries');
  const [started, setStarted] = React.useState(false);
  const [url, setUrl] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const urlRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    setStarted(false);
    setUrl(null);
    setLoading(false);
    setError(null);
  }, [id]);

  React.useEffect(
    () => () => {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    },
    [id],
  );

  function showFile(): void {
    setStarted(true);
    setLoading(true);
    setError(null);
    entriesApi
      .download(id)
      .then((blob) => {
        const objectUrl = URL.createObjectURL(blob);
        urlRef.current = objectUrl;
        setUrl(objectUrl);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setLoading(false);
        setError(err instanceof Error ? err.message : 'download failed');
      });
  }

  if (deleted) {
    return (
      <div className="flex h-full min-h-96 flex-col items-center justify-center gap-3 rounded-md border p-6 text-center">
        <FileX className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium">{t('fileDeleted')}</p>
        <p className="text-xs text-muted-foreground">{t('fileDeletedHint')}</p>
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="flex h-full min-h-96 flex-col items-center justify-center gap-4 rounded-md border p-6 text-center">
        <p className="text-sm text-muted-foreground">{t('pdfError')}</p>
        <p className="font-mono text-[11px] text-muted-foreground" dir="ltr">
          {error}
        </p>
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

  if (!started || loading || !url) {
    return (
      <div className="flex h-full min-h-96 flex-col items-center justify-center gap-4 rounded-md border p-6 text-center">
        <FileText className="h-10 w-10 text-muted-foreground" />
        <div>
          <p className="truncate font-mono text-sm" dir="ltr">
            {fileName}
          </p>
          <p className="text-xs text-muted-foreground" dir="ltr">
            {formatBytes(fileSize)} · PDF
          </p>
        </div>
        <Button onClick={showFile} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
          {t('showFile')}
        </Button>
      </div>
    );
  }

  return (
    <object data={url} type="application/pdf" className="h-full min-h-[70vh] w-full rounded-md">
      <div className="flex flex-col items-center gap-3 p-6 text-center">
        <p className="text-sm text-muted-foreground">{t('pdfError')}</p>
        <a href={url} download={fileName}>
          {t('downloadFallback')}
        </a>
      </div>
    </object>
  );
}
