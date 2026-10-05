'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { catalogApi } from '@/lib/api/entries';
import { Label } from '@/components/ui/label';

export interface ScopeSelection {
  companyId: string;
  projectId: string;
  year: string;
}

export function ScopeSelectors({
  value,
  onChange,
  disabled,
}: {
  value: ScopeSelection;
  onChange: (next: ScopeSelection) => void;
  disabled?: boolean;
}): JSX.Element {
  const t = useTranslations('upload');
  const companiesQuery = useQuery({ queryKey: ['companies'], queryFn: () => catalogApi.companies() });
  const projectsQuery = useQuery({
    queryKey: ['projects', value.companyId || 'all'],
    queryFn: () => catalogApi.projects(value.companyId || undefined),
    enabled: value.companyId !== '',
  });

  return (
    <div className="grid gap-3 md:grid-cols-3">
      <div className="space-y-1">
        <Label>{t('company')}</Label>
        <select
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={value.companyId}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, companyId: e.target.value, projectId: '' })}
        >
          <option value="">{t('selectCompany')}</option>
          {(companiesQuery.data?.items ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.nameAr}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label>{t('project')}</Label>
        <select
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={value.projectId}
          disabled={disabled || value.companyId === ''}
          onChange={(e) => onChange({ ...value, projectId: e.target.value })}
        >
          <option value="">{t('selectProject')}</option>
          {(projectsQuery.data?.items ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.nameAr}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label>{t('year')}</Label>
        <input
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          dir="ltr"
          inputMode="numeric"
          value={value.year}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, year: e.target.value })}
          placeholder={String(new Date().getFullYear())}
        />
      </div>
    </div>
  );
}
