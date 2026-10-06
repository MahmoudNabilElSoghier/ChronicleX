'use client';

import { useRouter } from '@/lib/navigation';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { adminApi } from '@/lib/api/admin';
import { ApiError } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/auth-context';

export default function ProfilePage(): JSX.Element {
  const t = useTranslations('profile');
  const router = useRouter();
  const { user, logout } = useAuth();
  const [current, setCurrent] = React.useState('');
  const [next, setNext] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [error, setError] = React.useState<{ field: 'current' | 'form'; message: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function submit(): Promise<void> {
    setError(null);
    if (next.length < 10) {
      setError({ field: 'form', message: t('passwordTooShort') });
      return;
    }
    if (next !== confirm) {
      setError({ field: 'form', message: t('mismatch') });
      return;
    }
    if (next === current) {
      setError({ field: 'form', message: t('mustDiffer') });
      return;
    }
    setBusy(true);
    try {
      await adminApi.users.changePassword({ currentPassword: current, newPassword: next });
      toast.success(t('success'));
      await logout();
      router.replace('/login');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError({ field: 'current', message: t('wrongCurrent') });
      } else {
        setError({ field: 'form', message: t('failed') });
      }
    } finally {
      setBusy(false);
    }
  }

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Skeleton className="h-8 w-48" />
      </main>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <Card>
        <CardHeader>
          <CardTitle>{t('account')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <p>
            <span className="text-muted-foreground">{t('name')}: </span>
            {user.nameAr} · {user.nameEn}
          </p>
          <p dir="ltr" className="text-start">
            <span className="text-muted-foreground">{t('email')}: </span>
            {user.email}
          </p>
          <p>
            <span className="text-muted-foreground">{t('status')}: </span>
            {user.isActive ? t('active') : t('inactive')}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('changePassword')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="pw-current">{t('currentPassword')}</Label>
            <Input id="pw-current" dir="ltr" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} aria-invalid={error?.field === 'current'} />
            {error?.field === 'current' ? (
              <p role="alert" className="text-sm text-destructive">
                {error.message}
              </p>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="pw-new">{t('newPassword')}</Label>
            <Input id="pw-new" dir="ltr" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pw-confirm">{t('confirmPassword')}</Label>
            <Input id="pw-confirm" dir="ltr" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          {error && error.field === 'form' ? (
            <p role="alert" className="text-sm text-destructive">
              {error.message}
            </p>
          ) : null}
          <Button onClick={() => void submit()} disabled={busy} className="w-full">
            {t('submit')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
