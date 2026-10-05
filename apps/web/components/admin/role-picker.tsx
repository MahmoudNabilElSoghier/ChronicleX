'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import type { CurrentUser, ScopeType } from '@chroniclex/shared';
import { Label } from '@/components/ui/label';
import { adminApi, type AdminRole } from '@/lib/api/admin';
import { catalogApi } from '@/lib/api/entries';
import { canGrantRole } from '@/lib/permissions/grantable';

export interface RoleSelection {
  roleId: string;
  scopeType: ScopeType;
  scopeId: string;
}

export function RolePicker({
  caller,
  targetUserId,
  value,
  onChange,
}: {
  caller: CurrentUser;
  /** User receiving the grant (null when unknown, e.g. user creation). */
  targetUserId: string | null;
  value: RoleSelection;
  onChange: (next: RoleSelection) => void;
}): JSX.Element {
  const t = useTranslations('admin');
  const rolesQuery = useQuery({ queryKey: ['roles'], queryFn: () => adminApi.roles.list() });
  const companiesQuery = useQuery({ queryKey: ['companies'], queryFn: () => catalogApi.companies() });
  const projectsQuery = useQuery({
    queryKey: ['projects', 'all-for-picker'],
    queryFn: () => catalogApi.projects(undefined),
    enabled: value.scopeType === 'PROJECT',
  });

  const roles = (rolesQuery.data?.items ?? []) as AdminRole[];
  const companies = (companiesQuery.data?.items ?? []) as { id: string; nameAr: string }[];
  const projectItems = (projectsQuery.data?.items ?? []) as {
    id: string;
    nameAr: string;
    companyId: string;
  }[];

  const companyOfProject: Record<string, string> = {};
  for (const p of projectItems) companyOfProject[p.id] = p.companyId;

  const callerGrants = (caller.roles ?? []).map((r) => ({
    name: r.name,
    scopeType: r.scopeType,
    scopeId: r.scopeId,
  }));

  const grantableRoles = roles.filter((r) =>
    canGrantRole(
      { id: caller.id, roles: callerGrants },
      targetUserId,
      { roleName: r.name, scopeType: value.scopeType, scopeId: value.scopeId },
      { companyOfProject },
    ),
  );

  const scopeTargets =
    value.scopeType === 'COMPANY'
      ? companies.map((c) => ({ id: c.id, label: c.nameAr }))
      : value.scopeType === 'PROJECT'
        ? projectItems.map((p) => ({ id: p.id, label: p.nameAr }))
        : [];

  return (
    <div className="grid gap-3 md:grid-cols-3">
      <div className="space-y-1">
        <Label htmlFor="role-pick-role">{t('roles.role')}</Label>
        <select
          id="role-pick-role"
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={value.roleId}
          onChange={(e) => onChange({ ...value, roleId: e.target.value })}
        >
          <option value="">{t('roles.selectRole')}</option>
          {grantableRoles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label>{t('roles.scopeType')}</Label>
        <div className="flex h-9 items-center gap-3 text-sm">
          {(['GROUP', 'COMPANY', 'PROJECT'] as ScopeType[]).map((s) => (
            <label key={s} className="flex items-center gap-1">
              <input
                type="radio"
                name="scopeType"
                checked={value.scopeType === s}
                onChange={() => onChange({ ...value, scopeType: s, scopeId: '' })}
              />
              {t(`roles.${s.toLowerCase()}`)}
            </label>
          ))}
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="role-pick-target">{t('roles.scopeTarget')}</Label>
        <select
          id="role-pick-target"
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={value.scopeId}
          disabled={value.scopeType === 'GROUP'}
          onChange={(e) => onChange({ ...value, scopeId: e.target.value })}
        >
          <option value="">{value.scopeType === 'GROUP' ? t('roles.global') : t('roles.selectTarget')}</option>
          {scopeTargets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
