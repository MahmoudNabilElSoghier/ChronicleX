'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/lib/navigation';
import { parseAsString, useQueryStates } from 'nuqs';
import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { RolePicker, type RoleSelection } from '@/components/admin/role-picker';
import { adminApi } from '@/lib/api/admin';
import { useRequireAuth } from '@/lib/auth/auth-context';

function PasswordInput({
  id,
  value,
  onChange,
  label,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  label: string;
}): JSX.Element {
  const [show, setShow] = React.useState(false);
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          dir="ltr"
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <Button type="button" variant="outline" size="sm" onClick={() => setShow((s) => !s)}>
          {show ? '***' : 'abc'}
        </Button>
      </div>
    </div>
  );
}

export default function AdminUsersPage(): JSX.Element {
  const t = useTranslations('admin');
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useRequireAuth();
  const [filters, setFilters] = useQueryStates({
    email: parseAsString.withDefault(''),
    name: parseAsString.withDefault(''),
    isActive: parseAsString.withDefault(''),
    hasRole: parseAsString.withDefault(''),
  });
  const [cursor, setCursor] = React.useState<string | undefined>(undefined);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editId, setEditId] = React.useState<string | null>(null);
  const [deactivateId, setDeactivateId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({
    email: '',
    nameAr: '',
    nameEn: '',
    password: '',
    name: '',
    active: 'true',
  });
  const [formError, setFormError] = React.useState<string | null>(null);
  const [newRole, setNewRole] = React.useState<RoleSelection>({
    roleId: '',
    scopeType: 'COMPANY',
    scopeId: '',
  });

  const params: Record<string, string | number | undefined> = {
    email: filters.email || undefined,
    name: filters.name || undefined,
    isActive: filters.isActive || undefined,
    hasRole: filters.hasRole || undefined,
    cursor,
    limit: 50,
  };
  const listQuery = useQuery({
    queryKey: ['admin-users', filters, cursor],
    queryFn: () => adminApi.users.list(params),
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

  async function submitCreate(): Promise<void> {
    setFormError(null);
    if (form.password.length < 10) {
      setFormError(t('users.passwordTooShort'));
      return;
    }
    if (!newRole.roleId || (newRole.scopeType !== 'GROUP' && !newRole.scopeId)) {
      setFormError(t('users.roleRequired'));
      return;
    }
    try {
      await adminApi.users.create({
        email: form.email,
        nameAr: form.nameAr,
        nameEn: form.nameEn,
        password: form.password,
        initialRoles: [
          {
            roleId: newRole.roleId,
            scopeType: newRole.scopeType,
            scopeId: newRole.scopeType === 'GROUP' ? '' : newRole.scopeId,
          },
        ],
      });
      toast.success(t('users.created'));
      setCreateOpen(false);
      setForm({ email: '', nameAr: '', nameEn: '', password: '', name: '', active: 'true' });
      setNewRole({ roleId: '', scopeType: 'COMPANY', scopeId: '' });
      await queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    } catch (err) {
      const apiErr = err as { status?: number };
      if (apiErr.status === 409) setFormError(t('users.duplicateEmail'));
      else if (apiErr.status === 403) setFormError(t('users.createForbidden'));
      else setFormError(t('users.createFailed'));
    }
  }

  async function submitEdit(): Promise<void> {
    if (!editId) return;
    try {
      await adminApi.users.update(editId, { nameAr: form.nameAr, nameEn: form.nameEn });
      toast.success(t('users.updated'));
      setEditId(null);
      await queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    } catch {
      toast.error(t('users.updateFailed'));
    }
  }

  async function confirmDeactivate(): Promise<void> {
    if (!deactivateId) return;
    try {
      await adminApi.users.update(deactivateId, { isActive: false });
      toast.success(t('users.deactivated'));
      setDeactivateId(null);
      await queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    } catch {
      toast.error(t('users.updateFailed'));
    }
  }

  const items = (listQuery.data?.items ?? []) as Array<{
    id: string;
    email: string;
    nameAr: string;
    nameEn: string;
    isActive: boolean;
    createdAt: string;
    roles: { name: string; scopeType: string; scopeId: string }[];
  }>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('users.title')}</h1>
        <Button onClick={() => setCreateOpen(true)}>{t('users.create')}</Button>
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-4">
          <div className="space-y-1">
            <Label>{t('users.email')}</Label>
            <Input
              dir="ltr"
              value={filters.email}
              onChange={(e) => void setFilters({ email: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>{t('users.name')}</Label>
            <Input value={filters.name} onChange={(e) => void setFilters({ name: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>{t('users.status')}</Label>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={filters.isActive}
              onChange={(e) => void setFilters({ isActive: e.target.value })}
            >
              <option value="">{t('users.all')}</option>
              <option value="true">{t('users.active')}</option>
              <option value="false">{t('users.inactive')}</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label>{t('users.role')}</Label>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={filters.hasRole}
              onChange={(e) => void setFilters({ hasRole: e.target.value })}
            >
              <option value="">{t('users.all')}</option>
              {['SUPER_ADMIN', 'COMPANY_ADMIN', 'PROJECT_ADMIN', 'ARCHIVIST', 'VIEWER'].map((r) => (
                <option key={r} value={r} dir="ltr">
                  {r}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {listQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">{t('users.empty')}</CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="[&_tr]:border-b">
                  <tr>
                    <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t('users.name')}</th>
                    <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t('users.email')}</th>
                    <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t('users.roles')}</th>
                    <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t('users.status')}</th>
                    <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t('users.actions')}</th>
                  </tr>
                </thead>
                <tbody className="[&_tr]:border-b">
                  {items.map((u) => (
                    <tr key={u.id} className="hover:bg-muted/50">
                      <td className="px-3 py-2">
                        <p className="font-medium">{u.nameAr}</p>
                        <p className="text-xs text-muted-foreground">{u.nameEn}</p>
                      </td>
                      <td className="px-3 py-2 font-mono" dir="ltr">
                        {u.email}
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex flex-wrap gap-1">
                          {u.roles.map((r, i) => (
                            <span key={i} className="rounded bg-muted px-2 py-0.5 text-xs" dir="ltr">
                              {r.name}
                              {r.scopeType !== 'GROUP' ? `:${r.scopeId}` : ''}
                            </span>
                          ))}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={
                            u.isActive
                              ? 'rounded bg-green-100 px-2 py-0.5 text-xs text-green-800'
                              : 'rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground'
                          }
                        >
                          {u.isActive ? t('users.active') : t('users.inactive')}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditId(u.id);
                              setForm((f) => ({ ...f, nameAr: u.nameAr, nameEn: u.nameEn }));
                            }}
                          >
                            {t('users.edit')}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => router.push(`/admin/users/${u.id}`)}>
                            {t('users.manageRoles')}
                          </Button>
                          {u.isActive ? (
                            <Button variant="ghost" size="sm" onClick={() => setDeactivateId(u.id)}>
                              {t('users.deactivate')}
                            </Button>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
          {listQuery.data?.nextCursor ? (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => setCursor(listQuery.data?.nextCursor ?? undefined)}>
                {t('users.loadMore')}
              </Button>
            </div>
          ) : null}
        </>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <h2 className="text-lg font-semibold">{t('users.createTitle')}</h2>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="create-email">{t('users.email')}</Label>
              <Input id="create-email" dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="create-nameAr">{t('users.nameAr')}</Label>
              <Input id="create-nameAr" value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="create-nameEn">{t('users.nameEn')}</Label>
              <Input id="create-nameEn" value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} />
            </div>
            <PasswordInput id="create-password" label={t('users.password')} value={form.password} onChange={(v) => setForm({ ...form, password: v })} />
            <p className="text-xs text-muted-foreground">{t('users.rolesNote')}</p>
            <p className="text-xs text-muted-foreground">{t('users.singleRoleNote')}</p>
            {user ? <RolePicker caller={user} targetUserId={null} value={newRole} onChange={setNewRole} /> : null}
            {formError ? (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            ) : null}
            <Button onClick={() => void submitCreate()} className="w-full">
              {t('users.createSubmit')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editId !== null} onOpenChange={(open) => !open && setEditId(null)}>
        <DialogContent>
          <DialogHeader>
            <h2 className="text-lg font-semibold">{t('users.editTitle')}</h2>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t('users.nameAr')}</Label>
              <Input value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>{t('users.nameEn')}</Label>
              <Input value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} />
            </div>
            <Button onClick={() => void submitEdit()} className="w-full">
              {t('users.save')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={deactivateId !== null} onOpenChange={(open) => !open && setDeactivateId(null)}>
        <DialogContent>
          <DialogHeader>
            <h2 className="text-lg font-semibold">{t('users.deactivateTitle')}</h2>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t('users.deactivateBody')}</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeactivateId(null)}>
              {t('users.cancel')}
            </Button>
            <Button variant="destructive" onClick={() => void confirmDeactivate()}>
              {t('users.deactivateConfirm')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
