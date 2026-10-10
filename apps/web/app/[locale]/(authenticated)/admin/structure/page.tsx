'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { adminApi, type StructureCompany, type StructureProject } from '@/lib/api/admin';
import { useRequireAuth } from '@/lib/auth/auth-context';
import { Link, useRouter } from '@/lib/navigation';
import { Building2, ChevronDown, ChevronRight, FolderKanban, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { PrefixSettings } from './prefix-settings';
import { CompanyDialog, type CompanyFormValues } from './company-dialog';
import { ProjectDialog, type ProjectFormValues } from './project-dialog';
import { DeleteDialog } from './delete-dialog';

function useFormatDate(): (iso: string) => string {
  const locale = useLocale();
  return React.useCallback(
    (iso: string) =>
      new Date(iso).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    [locale],
  );
}

type VisibleRow = { company: StructureCompany; projects: StructureProject[] };
type CompanyDialogState = { mode: 'create' } | { mode: 'edit'; company: StructureCompany } | null;
type ProjectDialogState =
  | { mode: 'create'; companyId: string; companyName: string }
  | { mode: 'edit'; project: StructureProject; companyId: string; companyName: string }
  | null;
type DeleteTarget =
  | { kind: 'company'; id: string; name: string }
  | { kind: 'project'; id: string; name: string }
  | null;

export default function AdminStructurePage(): JSX.Element {
  const t = useTranslations('admin');
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useRequireAuth();
  const formatDate = useFormatDate();
  const [search, setSearch] = React.useState('');
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});
  const [companyDialog, setCompanyDialog] = React.useState<CompanyDialogState>(null);
  const [projectDialog, setProjectDialog] = React.useState<ProjectDialogState>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<DeleteTarget>(null);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = React.useState(false);

  const structureQuery = useQuery({
    queryKey: ['admin-structure'],
    queryFn: () => adminApi.structure.get(),
  });

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Skeleton className="h-8 w-48" />
      </main>
    );
  }

  const roleNames = new Set((user.roles ?? []).map((r) => r.name));
  if (!roleNames.has('SUPER_ADMIN') && !roleNames.has('COMPANY_ADMIN')) {
    router.replace('/dashboard');
    toast.error(t('permissions.denied'));
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Skeleton className="h-8 w-48" />
      </main>
    );
  }

  const isSuper = roleNames.has('SUPER_ADMIN');
  const adminCompanyIds = new Set(
    (user.roles ?? [])
      .filter((r) => r.name === 'COMPANY_ADMIN' && r.scopeType === 'COMPANY')
      .map((r) => r.scopeId),
  );
  /** Projects (not company rows) may be managed by SUPER_ADMIN or the
   * COMPANY_ADMIN of that specific company — mirrors the service check. */
  const canManageProjectsOf = (companyId: string): boolean =>
    isSuper || adminCompanyIds.has(companyId);

  const q = search.trim().toLowerCase();
  const matchCompany = (c: StructureCompany): boolean =>
    c.nameAr.toLowerCase().includes(q) ||
    c.nameEn.toLowerCase().includes(q) ||
    String(c.code).includes(q);
  const matchProject = (p: StructureProject): boolean =>
    p.nameAr.toLowerCase().includes(q) ||
    p.nameEn.toLowerCase().includes(q) ||
    p.code.toLowerCase().includes(q);

  const rows: VisibleRow[] = (structureQuery.data?.companies ?? [])
    .map((c): VisibleRow | null => {
      if (q === '' || matchCompany(c)) return { company: c, projects: c.projects };
      const projects = c.projects.filter(matchProject);
      return projects.length > 0 ? { company: c, projects } : null;
    })
    .filter((r): r is VisibleRow => r !== null);

  async function saveCompany(values: CompanyFormValues): Promise<string | null> {
    try {
      if (companyDialog?.mode === 'create') {
        await adminApi.companies.create({
          code: values.code as number,
          nameAr: values.nameAr,
          nameEn: values.nameEn,
        });
        toast.success(t('structure.createdCompany'));
      } else if (companyDialog?.mode === 'edit') {
        await adminApi.companies.update(companyDialog.company.id, {
          nameAr: values.nameAr,
          nameEn: values.nameEn,
        });
        toast.success(t('structure.updatedCompany'));
      }
      await queryClient.invalidateQueries({ queryKey: ['admin-structure'] });
      return null;
    } catch (err) {
      return (err as Error).message || t('structure.saveFailed');
    }
  }

  async function saveProject(values: ProjectFormValues): Promise<string | null> {
    try {
      if (projectDialog?.mode === 'create') {
        await adminApi.projects.create({
          code: values.code as string,
          nameAr: values.nameAr,
          nameEn: values.nameEn,
          companyId: values.companyId,
        });
        toast.success(t('structure.createdProject'));
      } else if (projectDialog?.mode === 'edit') {
        await adminApi.projects.update(projectDialog.project.id, {
          nameAr: values.nameAr,
          nameEn: values.nameEn,
        });
        toast.success(t('structure.updatedProject'));
      }
      await queryClient.invalidateQueries({ queryKey: ['admin-structure'] });
      return null;
    } catch (err) {
      return (err as Error).message || t('structure.saveFailed');
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      if (deleteTarget.kind === 'company') {
        await adminApi.companies.remove(deleteTarget.id);
        toast.success(t('structure.deletedCompany'));
      } else {
        await adminApi.projects.remove(deleteTarget.id);
        toast.success(t('structure.deletedProject'));
      }
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['admin-structure'] });
    } catch (err) {
      const e = err as { status?: number; message?: string };
      if (e.status === 400 && e.message) {
        // Guard refusal (active projects / recorded entries): keep the
        // dialog open and surface the server's count message.
        setDeleteError(e.message);
      } else {
        toast.error(t('structure.saveFailed'));
        setDeleteTarget(null);
      }
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t('structure.title')}</h1>

      {isSuper ? <PrefixSettings /> : null}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t('structure.title')}</h2>
          {isSuper ? (
            <Button type="button" onClick={() => setCompanyDialog({ mode: 'create' })}>
              <Plus className="ms-1 size-4" />
              {t('structure.addCompany')}
            </Button>
          ) : null}
        </div>

        <div className="relative">
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={t('structure.search')}
            placeholder={t('structure.search')}
            className="ps-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {structureQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : structureQuery.isError ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 p-10">
              <p className="text-sm text-muted-foreground">{t('structure.error')}</p>
              <Button variant="outline" onClick={() => void structureQuery.refetch()}>
                {t('structure.retry')}
              </Button>
            </CardContent>
          </Card>
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="p-10 text-center text-muted-foreground">
              {q === '' ? t('structure.empty') : t('structure.noResults')}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {rows.map(({ company: c, projects }) => {
              const expanded = q !== '' || !collapsed[c.id];
              const manageProjects = canManageProjectsOf(c.id);
              return (
                <Card key={c.id}>
                  <CardContent className="p-0">
                    <div className="flex flex-wrap items-center gap-2 px-4 py-3">
                      <button
                        type="button"
                        className="flex flex-1 flex-wrap items-center gap-2 text-start hover:bg-muted/40"
                        aria-expanded={expanded}
                        onClick={() =>
                          setCollapsed((prev) => ({ ...prev, [c.id]: !prev[c.id] }))
                        }
                      >
                        {expanded ? (
                          <ChevronDown className="size-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="size-4 text-muted-foreground" />
                        )}
                        <Building2 className="size-4 text-muted-foreground" />
                        <span className="font-semibold">{c.nameAr}</span>
                        <span className="text-sm text-muted-foreground" dir="ltr">
                          {c.nameEn}
                        </span>
                        <span
                          className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono"
                          dir="ltr"
                        >
                          {c.code}
                        </span>
                        <span className="ms-auto text-xs text-muted-foreground">
                          {t('structure.projectsCount', { count: c.projects.length })}
                        </span>
                        <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                          {t('structure.entriesCount', { count: c.entryCount })}
                        </span>
                      </button>
                      <div className="flex items-center gap-1">
                        {manageProjects ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setProjectDialog({
                                mode: 'create',
                                companyId: c.id,
                                companyName: c.nameAr,
                              })
                            }
                          >
                            <Plus className="size-3.5" />
                            {t('structure.addProject')}
                          </Button>
                        ) : null}
                        {isSuper ? (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              aria-label={`${t('structure.edit')} ${c.nameAr}`}
                              onClick={() => setCompanyDialog({ mode: 'edit', company: c })}
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              aria-label={`${t('structure.delete')} ${c.nameAr}`}
                              onClick={() => {
                                setDeleteError(null);
                                setDeleteTarget({ kind: 'company', id: c.id, name: c.nameAr });
                              }}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </div>
                    {expanded ? (
                      <ul className="border-t">
                        {projects.map((p) => (
                          <li
                            key={p.id}
                            className="flex flex-wrap items-center gap-2 border-b px-4 py-2 ps-10 last:border-b-0"
                          >
                            <FolderKanban className="size-4 text-muted-foreground" />
                            <span className="text-sm font-medium">{p.nameAr}</span>
                            <span className="text-xs text-muted-foreground" dir="ltr">
                              {p.code}
                            </span>
                            <span className="text-xs text-muted-foreground">{p.nameEn}</span>
                            <span className="ms-auto rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                              {t('structure.entriesCount', { count: p.entryCount })}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {t('structure.lastUpload')}:{' '}
                              {p.lastUploadAt !== null
                                ? formatDate(p.lastUploadAt)
                                : t('structure.never')}
                            </span>
                            <Link
                              href={`/entries?companyId=${c.id}&projectId=${p.id}`}
                              className="text-xs font-medium text-primary hover:underline"
                            >
                              {t('structure.viewEntries')}
                            </Link>
                            {manageProjects ? (
                              <>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  aria-label={`${t('structure.edit')} ${p.nameAr}`}
                                  onClick={() =>
                                    setProjectDialog({
                                      mode: 'edit',
                                      project: p,
                                      companyId: c.id,
                                      companyName: c.nameAr,
                                    })
                                  }
                                >
                                  <Pencil className="size-3.5" />
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  aria-label={`${t('structure.delete')} ${p.nameAr}`}
                                  onClick={() => {
                                    setDeleteError(null);
                                    setDeleteTarget({ kind: 'project', id: p.id, name: p.nameAr });
                                  }}
                                >
                                  <Trash2 className="size-3.5" />
                                </Button>
                              </>
                            ) : null}
                          </li>
                        ))}
                        {projects.length === 0 ? (
                          <li className="px-10 py-2 text-sm text-muted-foreground">
                            {t('structure.noResults')}
                          </li>
                        ) : null}
                      </ul>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {companyDialog ? (
        <CompanyDialog
          mode={companyDialog.mode}
          {...(companyDialog.mode === 'edit' ? { company: companyDialog.company } : {})}
          save={saveCompany}
          onClose={() => setCompanyDialog(null)}
        />
      ) : null}

      {projectDialog ? (
        <ProjectDialog
          mode={projectDialog.mode}
          companyId={projectDialog.companyId}
          companyName={projectDialog.companyName}
          {...(projectDialog.mode === 'edit' ? { project: projectDialog.project } : {})}
          save={saveProject}
          onClose={() => setProjectDialog(null)}
        />
      ) : null}

      {deleteTarget ? (
        <DeleteDialog
          message={
            deleteTarget.kind === 'company'
              ? t('structure.deleteCompanyConfirm', { name: deleteTarget.name })
              : t('structure.deleteProjectConfirm', { name: deleteTarget.name })
          }
          error={deleteError}
          busy={deleteBusy}
          onCancel={() => {
            setDeleteTarget(null);
            setDeleteError(null);
          }}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}
    </div>
  );
}
