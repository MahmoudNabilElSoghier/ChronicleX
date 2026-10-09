'use client';

import { useQuery } from '@tanstack/react-query';
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
import { Building2, ChevronDown, ChevronRight, FolderKanban, Search } from 'lucide-react';

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

export default function AdminStructurePage(): JSX.Element {
  const t = useTranslations('admin');
  const router = useRouter();
  const user = useRequireAuth();
  const formatDate = useFormatDate();
  const [search, setSearch] = React.useState('');
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('structure.title')}</h1>
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
            return (
              <Card key={c.id}>
                <CardContent className="p-0">
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-start hover:bg-muted/40"
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
  );
}
