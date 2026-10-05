'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { parseAsString, useQueryStates } from 'nuqs';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { adminApi, type AuditRow } from '@/lib/api/admin';
import { formatDateTime, formatRelativeTime } from '@/lib/format';

const ACTION_COLORS: Record<string, string> = {
  CREATE: 'bg-green-100 text-green-800',
  UPDATE: 'bg-blue-100 text-blue-800',
  DELETE: 'bg-red-100 text-red-800',
  RESTORE: 'bg-green-100 text-green-800',
  VIEW: 'bg-muted text-muted-foreground',
  EXPORT: 'bg-purple-100 text-purple-800',
};

export default function AuditViewerPage(): JSX.Element {
  const t = useTranslations('admin');
  const locale = useLocale();
  const [filters, setFilters] = useQueryStates({
    userId: parseAsString.withDefault(''),
    resource: parseAsString.withDefault(''),
    action: parseAsString.withDefault(''),
    resourceId: parseAsString.withDefault(''),
    from: parseAsString.withDefault(''),
    to: parseAsString.withDefault(''),
  });
  const [cursor, setCursor] = React.useState<string | undefined>(undefined);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  const query = useQuery({
    queryKey: ['audit-logs', filters, cursor],
    queryFn: () =>
      adminApi.audit.list({
        userId: filters.userId || undefined,
        resource: filters.resource || undefined,
        action: filters.action || undefined,
        resourceId: filters.resourceId || undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
        cursor,
        limit: 50,
      }),
    retry: false,
  });

  function toggle(id: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const items = (query.data?.items ?? []) as AuditRow[];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t('audit.title')}</h1>

      {query.isError ? (
        <Card>
          <CardContent className="flex items-center justify-between gap-4 p-6">
            <p className="text-sm text-destructive">{t('audit.error')}</p>
            <Button variant="outline" onClick={() => void query.refetch()}>
              {t('audit.retry')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="grid gap-3 p-4 md:grid-cols-4">
              <div className="space-y-1">
                <Label htmlFor="a-userId">{t('audit.userId')}</Label>
                <Input
                  id="a-userId"
                  dir="ltr"
                  value={filters.userId}
                  onChange={(e) => void setFilters({ userId: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="a-resource">{t('audit.resource')}</Label>
                <select
                  id="a-resource"
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={filters.resource}
                  onChange={(e) => void setFilters({ resource: e.target.value })}
                >
                  <option value="">{t('audit.all')}</option>
                  {['ENTRY', 'PROJECT', 'COMPANY', 'USER', 'AUDIT', 'AUTH'].map((r) => (
                    <option key={r} value={r} dir="ltr">
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="a-action">{t('audit.action')}</Label>
                <select
                  id="a-action"
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={filters.action}
                  onChange={(e) => void setFilters({ action: e.target.value })}
                >
                  <option value="">{t('audit.all')}</option>
                  {['CREATE', 'UPDATE', 'DELETE', 'RESTORE', 'VIEW', 'EXPORT'].map((a) => (
                    <option key={a} value={a} dir="ltr">
                      {a}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="a-resourceId">{t('audit.resourceId')}</Label>
                <Input
                  id="a-resourceId"
                  dir="ltr"
                  value={filters.resourceId}
                  onChange={(e) => void setFilters({ resourceId: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="a-from">{t('audit.from')}</Label>
                <Input
                  id="a-from"
                  type="date"
                  dir="ltr"
                  value={filters.from}
                  onChange={(e) => void setFilters({ from: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="a-to">{t('audit.to')}</Label>
                <Input
                  id="a-to"
                  type="date"
                  dir="ltr"
                  value={filters.to}
                  onChange={(e) => void setFilters({ to: e.target.value })}
                />
              </div>
              <div className="flex items-end">
                <Button
                  variant="outline"
                  onClick={() =>
                    void setFilters({
                      userId: '',
                      resource: '',
                      action: '',
                      resourceId: '',
                      from: '',
                      to: '',
                    })
                  }
                >
                  {t('audit.clear')}
                </Button>
              </div>
            </CardContent>
          </Card>

          {query.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <Card>
              <CardContent className="p-10 text-center text-muted-foreground">
                {t('audit.empty')}
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <thead className="[&_tr]:border-b">
                      <tr>
                        <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t('audit.timestamp')}</th>
                        <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t('audit.action')}</th>
                        <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t('audit.resource')}</th>
                        <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t('audit.resourceId')}</th>
                        <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t('audit.event')}</th>
                      </tr>
                    </thead>
                    <tbody className="[&_tr]:border-b">
                      {items.map((row) => {
                        const open = expanded.has(row.id);
                        const newValues = row.newValues as Record<string, unknown> | null;
                        const event =
                          newValues && typeof newValues.event === 'string' ? newValues.event : '—';
                        return (
                          <React.Fragment key={row.id}>
                            <tr
                              key={row.id}
                              className="cursor-pointer hover:bg-muted/50"
                              onClick={() => toggle(row.id)}
                            >
                              <td
                                className="px-3 py-2 text-muted-foreground"
                                title={formatDateTime(row.createdAt, locale)}
                              >
                                {formatRelativeTime(row.createdAt, locale)}
                              </td>
                              <td className="px-3 py-2">
                                <span
                                  className={`rounded px-2 py-0.5 text-xs ${ACTION_COLORS[row.action] ?? 'bg-muted'}`}
                                  dir="ltr"
                                >
                                  {row.action}
                                </span>
                              </td>
                              <td className="px-3 py-2" dir="ltr">
                                {row.resource}
                              </td>
                              <td className="max-w-32 truncate px-3 py-2 font-mono text-xs" dir="ltr" title={row.resourceId ?? ''}>
                                {row.resourceId ?? '—'}
                              </td>
                              <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                                {event}
                              </td>
                            </tr>
                            {open ? (
                              <tr key={`${row.id}-diff`}>
                                <td colSpan={5} className="bg-muted/30 px-3 py-2">
                                  <pre dir="ltr" className="overflow-auto text-[11px]">
                                    {JSON.stringify(
                                      { old: row.oldValues, new: row.newValues },
                                      null,
                                      2,
                                    )}
                                  </pre>
                                </td>
                              </tr>
                            ) : null}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
              {query.data?.hasMore ? (
                <div className="flex justify-center">
                  <Button variant="outline" onClick={() => setCursor(query.data?.nextCursor ?? undefined)}>
                    {t('audit.loadMore')}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  );
}
