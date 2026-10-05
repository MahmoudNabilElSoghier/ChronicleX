'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Eye, Pencil, Plus, RefreshCcw, Trash2 } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';
import type { AuditEvent } from '@/lib/api/entries';
import { formatDateTime, formatRelativeTime } from '@/lib/format';

const FALLBACK = { icon: Eye, className: 'text-gray-500' };

const ICONS: Record<string, { icon: React.ElementType; className: string }> = {
  CREATE: { icon: Plus, className: 'text-green-600' },
  UPDATE: { icon: Pencil, className: 'text-blue-600' },
  DELETE: { icon: Trash2, className: 'text-red-600' },
  RESTORE: { icon: RefreshCcw, className: 'text-green-600' },
  VIEW: FALLBACK,
};

function describeEvent(t: (key: string) => string, ev: AuditEvent): string {
  switch (ev.action) {
    case 'CREATE':
      return t('created');
    case 'UPDATE':
      return t('updated');
    case 'DELETE':
      return t('deleted');
    case 'RESTORE':
      return t('restored');
    default:
      return t('viewed');
  }
}

export function AuditTimeline({ items }: { items: AuditEvent[] }): JSX.Element {
  const t = useTranslations('entries.audit');
  const locale = useLocale();
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  function toggle(id: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('empty')}</p>;
  }

  return (
    <ol className="relative space-y-4 border-s ps-5">
      {items.map((ev) => {
        const meta = ICONS[ev.action] ?? FALLBACK;
        const Icon = meta.icon;
        const open = expanded.has(ev.id);
        const hasDiff = ev.oldValues !== null || ev.newValues !== null;
        return (
          <li key={ev.id} className="relative">
            <span className="absolute -start-8 flex h-6 w-6 items-center justify-center rounded-full border bg-background">
              <Icon className={cn('h-3.5 w-3.5', meta.className)} />
            </span>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">
                {describeEvent(t as (key: string) => string, ev)}
                <span className="font-normal text-muted-foreground"> · {ev.userNameAr ?? '—'}</span>
              </p>
              <p className="text-xs text-muted-foreground" title={formatDateTime(ev.createdAt, locale)}>
                {formatRelativeTime(ev.createdAt, locale)}
              </p>
              {hasDiff ? (
                <button
                  type="button"
                  className="w-fit text-xs text-primary underline"
                  onClick={() => toggle(ev.id)}
                >
                  {open ? t('hideDiff') : t('showDiff')}
                </button>
              ) : null}
              {open && hasDiff ? (
                <pre dir="ltr" className="overflow-auto rounded-md bg-muted p-2 text-[11px]">
                  {JSON.stringify({ old: ev.oldValues, new: ev.newValues }, null, 2)}
                </pre>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
