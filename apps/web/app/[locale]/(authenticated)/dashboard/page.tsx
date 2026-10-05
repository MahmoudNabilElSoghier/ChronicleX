'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations, useLocale } from 'next-intl';
import * as React from 'react';
import { Building2, FolderKanban, FileText, UploadCloud } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EntriesByTypeChart, EntriesByYearChart } from '@/components/dashboard/charts';
import { dashboardApi } from '@/lib/api/endpoints';
import { useAuth } from '@/lib/auth/auth-context';

function StatCard({ title, value, icon: Icon }: { title: string; value: number | string; icon: React.ElementType }): JSX.Element {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage(): JSX.Element {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const { user } = useAuth();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => dashboardApi.summary(),
  });

  const today = new Date().toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">
          {t('greeting', { name: user?.nameAr ?? user?.nameEn ?? '' })}
        </h1>
        <p className="text-sm text-muted-foreground">{today}</p>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : isError || !data ? (
        <Card>
          <CardContent className="flex items-center justify-between gap-4 p-6">
            <p className="text-sm text-destructive">{t('loadError')}</p>
            <button type="button" className="text-sm underline" onClick={() => void refetch()}>
              {t('retry')}
            </button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <StatCard title={t('totalCompanies')} value={data.companies} icon={Building2} />
            <StatCard title={t('totalProjects')} value={data.projects} icon={FolderKanban} />
            <StatCard title={t('totalEntries')} value={data.entries.total} icon={FileText} />
            <StatCard
              title={t('recentUploadsCount')}
              value={data.recentUploads.length}
              icon={UploadCloud}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{t('entriesByYear')}</CardTitle>
              </CardHeader>
              <CardContent>
                {data.entries.byYear.length > 0 ? (
                  <React.Suspense fallback={<Skeleton className="h-[220px]" />}>
                    <EntriesByYearChart data={data.entries.byYear} />
                  </React.Suspense>
                ) : (
                  <p className="text-sm text-muted-foreground">{t('noData')}</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t('byType')}</CardTitle>
              </CardHeader>
              <CardContent>
                {data.entries.byTypePrefix.length > 0 ? (
                  <React.Suspense fallback={<Skeleton className="h-[220px]" />}>
                    <EntriesByTypeChart data={data.entries.byTypePrefix} />
                  </React.Suspense>
                ) : (
                  <p className="text-sm text-muted-foreground">{t('noData')}</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t('recentUploads')}</CardTitle>
              <CardDescription>{t('recentUploadsHint')}</CardDescription>
            </CardHeader>
            <CardContent>
              {data.recentUploads.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('noData')}</p>
              ) : (
                <ul className="divide-y">
                  {data.recentUploads.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                      <span className="font-mono" dir="ltr">
                        {r.serial}
                      </span>
                      <span className="truncate text-muted-foreground">{r.fileName}</span>
                      <span className="hidden text-muted-foreground md:inline">
                        {r.project.nameAr} · {r.company.nameAr}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
