'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { entryPrefixesQueryKey, fetchEntryPrefixes, settingsApi } from '@/lib/api/settings';
import { useRequireAuth } from '@/lib/auth/auth-context';
import { useRouter } from '@/lib/navigation';

export default function AdminSettingsPage(): JSX.Element {
  const t = useTranslations('admin');
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useRequireAuth();

  const prefixesQuery = useQuery({
    queryKey: entryPrefixesQueryKey,
    queryFn: fetchEntryPrefixes,
    staleTime: 5 * 60_000,
  });
  const data = prefixesQuery.data;

  // Edit buffer: null until the loaded list is copied in; save() resets it
  // so the invalidated query re-seeds the buffer with the server value.
  const [draft, setDraft] = React.useState<string[] | null>(null);
  React.useEffect(() => {
    if (data && draft === null) setDraft([...data]);
  }, [data, draft]);

  const [value, setValue] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Skeleton className="h-8 w-48" />
      </main>
    );
  }

  const roleNames = new Set<string>((user.roles ?? []).map((r) => r.name));
  if (!roleNames.has('SUPER_ADMIN')) {
    router.replace('/dashboard');
    toast.error(t('permissions.denied'));
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Skeleton className="h-8 w-48" />
      </main>
    );
  }

  const current = draft ?? data ?? [];
  const dirty = draft !== null && data !== undefined && draft.join(',') !== data.join(',');

  function addPrefix(): void {
    const v = value.trim();
    if (!/^\d{2}$/.test(v)) {
      setError(t('settings.invalidFormat'));
      return;
    }
    if ((draft ?? data ?? []).includes(v)) {
      setError(t('settings.duplicate'));
      return;
    }
    setError(null);
    setValue('');
    setDraft([...(draft ?? data ?? []), v]);
  }

  function removePrefix(prefix: string): void {
    setError(null);
    setDraft(current.filter((p) => p !== prefix));
  }

  async function save(): Promise<void> {
    if (draft === null) return;
    if (draft.length === 0) {
      setError(t('settings.emptyError'));
      return;
    }
    setSaving(true);
    try {
      await settingsApi.updateEntryPrefixes(draft);
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: entryPrefixesQueryKey });
      toast.success(t('settings.saved'));
    } catch (err) {
      const status = (err as { status?: number }).status;
      toast.error(status === 403 ? t('settings.forbidden') : t('settings.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t('settings.title')}</h1>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">{t('settings.heading')}</h2>
            <p className="text-sm text-muted-foreground">{t('settings.description')}</p>
          </div>

          <div className="space-y-2">
            <Label>{t('settings.current')}</Label>
            {prefixesQuery.isLoading ? (
              <Skeleton className="h-8 w-48" />
            ) : current.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('settings.noPrefixes')}</p>
            ) : (
              <div className="flex flex-wrap gap-2" dir="ltr">
                {current.map((p) => (
                  <span
                    key={p}
                    className="flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-sm font-medium text-primary"
                  >
                    <span dir="ltr">{p}</span>
                    <button
                      type="button"
                      aria-label={t('settings.remove', { prefix: p })}
                      className="rounded p-0.5 hover:bg-primary/20"
                      onClick={() => removePrefix(p)}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="prefix-input">{t('settings.addPlaceholder')}</Label>
              <Input
                id="prefix-input"
                dir="ltr"
                inputMode="numeric"
                maxLength={2}
                className="w-36"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addPrefix();
                  }
                }}
              />
            </div>
            <Button type="button" variant="outline" onClick={addPrefix}>
              {t('settings.add')}
            </Button>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <Button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || saving || prefixesQuery.isLoading}
          >
            {t('settings.save')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
