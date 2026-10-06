'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/lib/navigation';
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs';
import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EntriesTable, TableSkeleton, type RowActions } from '@/components/entries/entries-table';
import { catalogApi, entriesApi, type EntriesFilters, type EntryListItem } from '@/lib/api/entries';
import { useAuth } from '@/lib/auth/auth-context';
import { saveBlob } from '@/lib/download';
import { canDeleteEntries, canRestoreEntries } from '@/lib/permissions';

const PAGE_SIZE = 50;

export default function EntriesListPage(): JSX.Element {
  const t = useTranslations('entries');
  const locale = useLocale();
  const router = useRouter();
  const { user } = useAuth();
  const [filters, setFilters] = useQueryStates({
    companyId: parseAsString.withDefault(''),
    projectId: parseAsString.withDefault(''),
    year: parseAsInteger,
    typePrefix: parseAsString.withDefault(''),
    serial: parseAsString.withDefault(''),
    serialFrom: parseAsString.withDefault(''),
    serialTo: parseAsString.withDefault(''),
    q: parseAsString.withDefault(''),
    includeDeleted: parseAsString.withDefault(''),
  });

  const [cursorStack, setCursorStack] = React.useState<(string | null)[]>([null]);
  const cursor = cursorStack[cursorStack.length - 1] ?? undefined;

  const queryFilters: EntriesFilters = React.useMemo(() => {
    const f: EntriesFilters = { limit: PAGE_SIZE };
    if (filters.companyId !== '') f.companyId = filters.companyId;
    if (filters.projectId !== '') f.projectId = filters.projectId;
    if (filters.year !== null) f.year = filters.year;
    if (filters.typePrefix !== '') f.typePrefix = filters.typePrefix;
    if (filters.serial !== '') f.serial = filters.serial;
    if (filters.serialFrom !== '') f.serialFrom = filters.serialFrom;
    if (filters.serialTo !== '') f.serialTo = filters.serialTo;
    if (filters.q !== '') f.q = filters.q;
    if (filters.includeDeleted === 'true') f.includeDeleted = true;
    if (cursor !== undefined) f.cursor = cursor;
    return f;
  }, [filters, cursor]);

  // Serials are fixed-width digits, so string comparison is numeric order.
  const serialRangeInvalid =
    filters.serialFrom !== '' && filters.serialTo !== '' && filters.serialFrom > filters.serialTo;

  const entriesQuery = useQuery({
    queryKey: ['entries', queryFilters],
    queryFn: () => entriesApi.list(queryFilters),
    enabled: !serialRangeInvalid,
  });
  const companiesQuery = useQuery({ queryKey: ['companies'], queryFn: () => catalogApi.companies() });
  const projectsQuery = useQuery({
    queryKey: ['projects', filters.companyId || 'all'],
    queryFn: () => catalogApi.projects(filters.companyId || undefined),
  });
  const yearsQuery = useQuery({ queryKey: ['entry-years'], queryFn: () => catalogApi.years() });

  function resetFilters(): void {
    void setFilters({
      companyId: '',
      projectId: '',
      year: null,
      typePrefix: '',
      serial: '',
      serialFrom: '',
      serialTo: '',
      q: '',
      includeDeleted: '',
    });
    setCursorStack([null]);
  }

  function patchFilters(patch: Partial<typeof filters>): void {
    void setFilters({ ...patch });
    setCursorStack([null]);
  }

  const items = (entriesQuery.data?.items ?? []) as EntryListItem[];
  const hasMore = entriesQuery.data?.hasMore ?? false;
  const [allItems, setAllItems] = React.useState<EntryListItem[]>([]);
  const filterKey = JSON.stringify({ ...queryFilters, cursor: undefined });
  const lastFilterKey = React.useRef(filterKey);

  // "Load more" appends pages; any filter change restarts the list.
  React.useEffect(() => {
    if (lastFilterKey.current !== filterKey) {
      lastFilterKey.current = filterKey;
      setAllItems(items);
    } else if (items.length > 0) {
      setAllItems((prev) => {
        const seen = new Set(prev.map((i) => i.id));
        return [...prev, ...items.filter((i) => !seen.has(i.id))];
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entriesQuery.data]);

  async function download(entry: EntryListItem): Promise<void> {
    try {
      const blob = await entriesApi.download(entry.id);
      saveBlob(blob, `${entry.serial}.pdf`);
    } catch {
      toast.error(t('downloadFailed'));
    }
  }

  const actions: RowActions = React.useMemo(
    () => ({
      onView: (entry) => router.push(`/entries/${entry.id}`),
      onDownload: (entry) => void download(entry),
      onDelete: () => undefined,
      onRestore: () => undefined,
      canDelete: canDeleteEntries(user),
      canRestore: canRestoreEntries(user),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, router, t],
  );

  const showDeletedToggle = canDeleteEntries(user);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('list.title')}</h1>
        <Button onClick={() => router.push('/upload')}>{t('list.upload')}</Button>
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="f-company">{t('filters.company')}</Label>
            <select
              id="f-company"
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={filters.companyId}
              onChange={(e) => patchFilters({ companyId: e.target.value, projectId: '' })}
            >
              <option value="">{t('filters.all')}</option>
              {(companiesQuery.data?.items ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nameAr}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="f-project">{t('filters.project')}</Label>
            <select
              id="f-project"
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={filters.projectId}
              disabled={!filters.companyId}
              onChange={(e) => patchFilters({ projectId: e.target.value })}
            >
              <option value="">{t('filters.all')}</option>
              {(projectsQuery.data?.items ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nameAr}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="f-year">{t('filters.year')}</Label>
            <select
              id="f-year"
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={filters.year === null ? '' : String(filters.year)}
              onChange={(e) => patchFilters({ year: e.target.value === '' ? null : Number(e.target.value) })}
            >
              <option value="">{t('filters.all')}</option>
              {(yearsQuery.data?.years ?? []).map((y) => (
                <option key={y} value={y} dir="ltr">
                  {y}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="f-type">{t('filters.typePrefix')}</Label>
            <select
              id="f-type"
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={filters.typePrefix}
              onChange={(e) => patchFilters({ typePrefix: e.target.value })}
            >
              <option value="">{t('filters.all')}</option>
              {['62', '63', '67'].map((p) => (
                <option key={p} value={p} dir="ltr">
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="f-serial">{t('filters.serial')}</Label>
            <Input
              id="f-serial"
              dir="ltr"
              value={filters.serial}
              onChange={(e) => patchFilters({ serial: e.target.value })}
              placeholder="6200000000"
            />
          </div>
          <div className="space-y-1 md:col-span-2">
            <span className="text-sm font-medium leading-none">{t('filters.serialRange')}</span>
            <div className="flex items-center gap-2">
              <Label htmlFor="f-serial-from" className="text-muted-foreground">
                {t('filters.serialFrom')}
              </Label>
              <Input
                id="f-serial-from"
                dir="ltr"
                inputMode="numeric"
                maxLength={10}
                placeholder="6200000000"
                value={filters.serialFrom}
                onChange={(e) => patchFilters({ serialFrom: e.target.value })}
              />
              <Label htmlFor="f-serial-to" className="text-muted-foreground">
                {t('filters.serialTo')}
              </Label>
              <Input
                id="f-serial-to"
                dir="ltr"
                inputMode="numeric"
                maxLength={10}
                placeholder="6200000000"
                value={filters.serialTo}
                onChange={(e) => patchFilters({ serialTo: e.target.value })}
              />
              {filters.serialFrom !== '' || filters.serialTo !== '' ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => patchFilters({ serialFrom: '', serialTo: '' })}
                >
                  {t('filters.clearRange')}
                </Button>
              ) : null}
            </div>
            {serialRangeInvalid ? (
              <p className="text-sm text-destructive" role="alert">
                {t('filters.serialRangeInvalid')}
              </p>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="f-q">{t('filters.search')}</Label>
            <Input id="f-q" value={filters.q} onChange={(e) => patchFilters({ q: e.target.value })} />
          </div>
          <div className="flex items-end gap-2">
            {showDeletedToggle ? (
              <label className="flex h-9 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={filters.includeDeleted === 'true'}
                  onChange={(e) => patchFilters({ includeDeleted: e.target.checked ? 'true' : '' })}
                />
                {t('filters.includeDeleted')}
              </label>
            ) : null}
            <Button variant="outline" onClick={resetFilters}>
              {t('filters.reset')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {entriesQuery.isLoading ? (
        <TableSkeleton />
      ) : entriesQuery.isError ? (
        <Card>
          <CardContent className="flex items-center justify-between gap-4 p-6">
            <p className="text-sm text-destructive">{t('list.error')}</p>
            <Button variant="outline" onClick={() => void entriesQuery.refetch()}>
              {t('list.retry')}
            </Button>
          </CardContent>
        </Card>
      ) : allItems.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <p className="text-muted-foreground">{t('list.empty')}</p>
            <Button variant="outline" onClick={resetFilters}>
              {t('filters.reset')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <EntriesTable items={allItems} actions={actions} locale={locale} />
          {hasMore ? (
            <div className="flex justify-center">
              <Button
                variant="outline"
                disabled={entriesQuery.isFetching}
                onClick={() =>
                  setCursorStack((s) => [...s, entriesQuery.data?.nextCursor ?? null])
                }
              >
                {t('list.loadMore')}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
