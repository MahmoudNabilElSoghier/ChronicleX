'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import * as React from 'react';
import { Lock } from 'lucide-react';
import { toast } from 'sonner';
import { AuditTimeline } from '@/components/entries/audit-timeline';
import { PdfViewer } from '@/components/entries/pdf-viewer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { catalogApi, entriesApi, type EntryDetail } from '@/lib/api/entries';
import { useAuth } from '@/lib/auth/auth-context';
import { saveBlob } from '@/lib/download';
import { formatBytes, formatDateTime } from '@/lib/format';
import { canDeleteEntries, canRestoreEntries } from '@/lib/permissions';
import { useLocalizedName, type Bilingual, type NameFallback } from '@/lib/use-localized-name';

function Field({ label, value, locked }: { label: string; value: string; locked?: boolean }): JSX.Element {
  return (
    <div className="space-y-1">
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        {locked ? <Lock className="h-3 w-3" /> : null}
      </p>
      <p className="text-sm font-medium" dir="auto">
        {value}
      </p>
    </div>
  );
}

function DetailName({
  label,
  entity,
  code,
  fallback,
}: {
  label: string;
  entity: (Bilingual & { code?: number | string }) | null | undefined;
  code: number | string | null;
  fallback: NameFallback;
}): JSX.Element {
  const localize = useLocalizedName();
  const resolved = localize(entity ?? null, { fallback });
  const codeText = code !== null && !resolved.isMissing ? ` (${String(code)})` : '';
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium" dir="auto">
        {resolved.text}
        {codeText}
      </p>
    </div>
  );
}

export default function EntryDetailPage(): JSX.Element {
  const t = useTranslations('entries');
  const locale = useLocale();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [editOpen, setEditOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [editProject, setEditProject] = React.useState('');
  const [editYear, setEditYear] = React.useState('');

  const detailQuery = useQuery({
    queryKey: ['entries', id],
    queryFn: () => entriesApi.get(id),
  });
  const auditQuery = useQuery({
    queryKey: ['entries', id, 'audit'],
    queryFn: () => entriesApi.getAudit(id),
  });
  const projectsQuery = useQuery({
    queryKey: ['projects', detailQuery.data?.companyId ?? 'none'],
    queryFn: () => catalogApi.projects(detailQuery.data?.companyId),
    enabled: editOpen,
  });

  const entry = detailQuery.data as EntryDetail | undefined;
  const canDelete = canDeleteEntries(user) && !entry?.deletedAt;
  const canRestore = canRestoreEntries(user) && !!entry?.deletedAt;

  async function download(): Promise<void> {
    try {
      const blob = await entriesApi.download(id);
      saveBlob(blob, `${entry?.serial ?? id}.pdf`);
    } catch {
      toast.error(t('downloadFailed'));
    }
  }

  async function confirmDelete(): Promise<void> {
    try {
      await entriesApi.remove(id);
      toast.success(t('deleteConfirm.done'));
      await queryClient.invalidateQueries({ queryKey: ['entries'] });
      router.push('/entries');
    } catch {
      toast.error(t('deleteConfirm.failed'));
    } finally {
      setDeleteOpen(false);
    }
  }

  async function doRestore(): Promise<void> {
    try {
      await entriesApi.restore(id);
      toast.success(t('restoreDone'));
      await queryClient.invalidateQueries({ queryKey: ['entries'] });
      await queryClient.invalidateQueries({ queryKey: ['entries', id] });
    } catch {
      toast.error(t('restoreFailed'));
    }
  }

  async function saveEdit(): Promise<void> {
    try {
      const body: { projectId?: string; year?: number } = {};
      if (editProject !== '') body.projectId = editProject;
      if (editYear !== '') body.year = Number(editYear);
      await entriesApi.update(id, body);
      toast.success(t('editDone'));
      setEditOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['entries', id] });
      await queryClient.invalidateQueries({ queryKey: ['entries'] });
    } catch {
      toast.error(t('editFailed'));
    }
  }

  if (detailQuery.isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-5">
        <Skeleton className="h-[70vh] md:col-span-3" />
        <Skeleton className="h-[70vh] md:col-span-2" />
      </div>
    );
  }

  if (detailQuery.isError || !entry) {
    return (
      <Card>
        <CardContent className="flex items-center justify-between gap-4 p-6">
          <p className="text-sm text-destructive">{t('detail.error')}</p>
          <Button variant="outline" onClick={() => void detailQuery.refetch()}>
            {t('detail.retry')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {entry.deletedAt ? (
        <Card className="border-destructive">
          <CardContent className="flex items-center justify-between gap-4 p-4">
            <p className="text-sm font-medium text-destructive">{t('detail.deletedBanner')}</p>
            {canRestore ? <Button onClick={() => void doRestore()}>{t('actions.restore')}</Button> : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-5">
        <div className="md:col-span-3">
          <ErrorBoundary
            fallback={
              <div className="flex h-full min-h-96 flex-col items-center justify-center gap-4 rounded-md border p-6 text-center">
                <p className="text-sm text-muted-foreground">{t('pdfError')}</p>
                <Button
                  variant="outline"
                  onClick={() => {
                    void entriesApi.download(id).then((blob) => saveBlob(blob, entry.fileName));
                  }}
                >
                  {t('downloadFallback')}
                </Button>
              </div>
            }
          >
            <PdfViewer id={entry.id} fileName={entry.fileName} fileSize={entry.fileSize} deleted={entry.deletedAt !== null} />
          </ErrorBoundary>
        </div>

        <div className="md:col-span-2">
          <Tabs defaultValue="metadata" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="metadata">{t('detail.tabs.metadata')}</TabsTrigger>
              <TabsTrigger value="audit">{t('detail.tabs.audit')}</TabsTrigger>
              <TabsTrigger value="actions">{t('detail.tabs.actions')}</TabsTrigger>
            </TabsList>

            <TabsContent value="metadata">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="font-mono" dir="ltr">
                    {entry.serial}
                  </CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditProject(entry.projectId);
                      setEditYear(String(entry.year));
                      setEditOpen(true);
                    }}
                  >
                    {t('actions.edit')}
                  </Button>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-4">
                  <Field label={t('detail.serial')} value={entry.serial} locked />
                  <Field label={t('detail.typePrefix')} value={entry.typePrefix} locked />
                  <Field label={t('detail.counter')} value={String(entry.counter)} locked />
                  <Field label={t('detail.year')} value={String(entry.year)} />
                  <Field label={t('detail.fileName')} value={entry.fileName} locked />
                  <Field label={t('detail.fileSize')} value={formatBytes(entry.fileSize)} locked />
                  <Field label={t('detail.mimeType')} value={entry.mimeType} locked />
                  <Field
                    label={t('detail.fileHash')}
                    value={`${entry.fileHash.slice(0, 16)}…`}
                    locked
                  />
                  <DetailName label={t('detail.company')} entity={entry.company} code={entry.company?.code ?? null} fallback="warning" />
                  <DetailName label={t('detail.project')} entity={entry.project} code={entry.project?.code ?? null} fallback="warning" />
                  <DetailName label={t('detail.uploadedBy')} entity={entry.uploadedBy} code={null} fallback="empty" />
                  <Field label={t('detail.createdAt')} value={formatDateTime(entry.createdAt, locale)} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="audit">
              <Card>
                <CardContent className="p-4">
                  {auditQuery.isLoading ? (
                    <Skeleton className="h-48" />
                  ) : (
                    <AuditTimeline items={auditQuery.data?.items ?? []} />
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="actions">
              <Card>
                <CardContent className="flex flex-col gap-2 p-4">
                  <Button variant="outline" onClick={() => void download()}>
                    {t('actions.download')}
                  </Button>
                  {canDelete ? (
                    <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
                      {t('actions.delete')}
                    </Button>
                  ) : null}
                  {canRestore ? (
                    <Button variant="outline" onClick={() => void doRestore()}>
                      {t('actions.restore')}
                    </Button>
                  ) : null}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('edit.title')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t('filters.project')}</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={editProject}
                onChange={(e) => setEditProject(e.target.value)}
              >
                {(projectsQuery.data?.items ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nameAr}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>{t('detail.year')}</Label>
              <Input dir="ltr" value={editYear} onChange={(e) => setEditYear(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              {t('edit.cancel')}
            </Button>
            <Button onClick={() => void saveEdit()}>{t('edit.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('deleteConfirm.title')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t('deleteConfirm.body')}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              {t('deleteConfirm.cancel')}
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()}>
              {t('deleteConfirm.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
