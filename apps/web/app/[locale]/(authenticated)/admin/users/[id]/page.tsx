'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';
import type { ScopeType } from '@chroniclex/shared';
import { RolePicker, type RoleSelection } from '@/components/admin/role-picker';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { adminApi, type AdminUser } from '@/lib/api/admin';
import { useRequireAuth } from '@/lib/auth/auth-context';

export default function ManageRolesPage(): JSX.Element {
  const t = useTranslations('admin');
  const params = useParams<{ id: string }>();
  const id = params.id;
  const queryClient = useQueryClient();
  const caller = useRequireAuth();
  const [grant, setGrant] = React.useState<RoleSelection>({
    roleId: '',
    scopeType: 'COMPANY',
    scopeId: '',
  });
  const [revoke, setRevoke] = React.useState<{
    roleId: string;
    roleName: string;
    scopeType: ScopeType;
    scopeId: string;
  } | null>(null);

  const userQuery = useQuery({
    queryKey: ['admin-users', id],
    queryFn: () => adminApi.users.get(id),
  });
  const target = userQuery.data as AdminUser | undefined;
  const isSelfSuperAdminRevoke =
    revoke !== null &&
    caller?.id === id &&
    revoke.roleName === 'SUPER_ADMIN' &&
    revoke.scopeType === 'GROUP';

  async function doGrant(): Promise<void> {
    if (!grant.roleId || (grant.scopeType !== 'GROUP' && !grant.scopeId)) {
      toast.error(t('roles.incomplete'));
      return;
    }
    try {
      await adminApi.users.grantRole(id, {
        roleId: grant.roleId,
        scopeType: grant.scopeType,
        scopeId: grant.scopeType === 'GROUP' ? '' : grant.scopeId,
      });
      toast.success(t('roles.granted'));
      setGrant({ roleId: '', scopeType: 'COMPANY', scopeId: '' });
      await queryClient.invalidateQueries({ queryKey: ['admin-users', id] });
      await queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      if (caller?.id === id) {
        await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
      }
    } catch {
      toast.error(t('roles.grantFailed'));
    }
  }

  async function doRevoke(): Promise<void> {
    if (!revoke || revoke.roleId === '') {
      toast.error(t('roles.revokeFailed'));
      return;
    }
    try {
      await adminApi.users.revokeRole(id, revoke.roleId, revoke.scopeType, revoke.scopeId);
      toast.success(t('roles.revoked'));
      setRevoke(null);
      await queryClient.invalidateQueries({ queryKey: ['admin-users', id] });
      await queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      if (caller?.id === id) {
        await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
      }
    } catch {
      toast.error(t('roles.revokeFailed'));
    }
  }

  if (!caller) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Skeleton className="h-8 w-48" />
      </main>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{t('roles.title')}</h1>
        {target ? (
          <p className="text-sm text-muted-foreground" dir="ltr">
            {target.email} · {target.isActive ? t('users.active') : t('users.inactive')}
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('roles.current')}</CardTitle>
          </CardHeader>
          <CardContent>
            {!target ? (
              <Skeleton className="h-24" />
            ) : target.roles.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('roles.empty')}</p>
            ) : (
              <ul className="divide-y">
                {target.roles.map((r, i) => (
                  <li key={`${r.name}-${r.scopeType}-${r.scopeId}-${i}`} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <span>
                      <span className="font-mono" dir="ltr">
                        {r.name}
                      </span>
                      <span className="text-muted-foreground" dir="ltr">
                        {' '}
                        · {r.scopeType}
                        {r.scopeType !== 'GROUP' ? `:${r.scopeId}` : ''}
                      </span>
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setRevoke({
                          roleId: r.roleId ?? '',
                          roleName: r.name,
                          scopeType: r.scopeType as ScopeType,
                          scopeId: r.scopeId,
                        })
                      }
                    >
                      {t('roles.revoke')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('roles.add')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <RolePicker caller={caller} targetUserId={id} value={grant} onChange={setGrant} />
            <Button onClick={() => void doGrant()} className="w-full">
              {t('roles.grant')}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Dialog open={revoke !== null} onOpenChange={(open) => !open && setRevoke(null)}>
        <DialogContent>
          <DialogHeader>
            <h2 className="text-lg font-semibold">{t('roles.revokeTitle')}</h2>
          </DialogHeader>
          {isSelfSuperAdminRevoke ? (
            <p className="rounded-md border border-destructive p-3 text-sm text-destructive">
              {t('roles.lastSuperAdminWarning')}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">{t('roles.revokeBody')}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevoke(null)}>
              {t('roles.cancel')}
            </Button>
            <Button variant="destructive" onClick={() => void doRevoke()}>
              {t('roles.revokeConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
