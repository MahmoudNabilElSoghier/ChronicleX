'use client';

import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { Separator } from '@/components/ui/separator';
import { LocaleToggle } from './locale-toggle';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';

/**
 * Only segments with a nav translation become crumbs. Dynamic IDs (cuids),
 * action segments (roles, bulk-upload) and anything else are dropped —
 * translating them throws IntlError, and raw IDs add no navigation value.
 */
const NAV_KEYS = new Set(['dashboard', 'entries', 'upload', 'users', 'audit', 'admin', 'profile']);

export function Topbar(): JSX.Element {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const crumbs = React.useMemo(() => {
    const segments = pathname.replace(/^\/(ar|en)/, '').split('/').filter(Boolean);
    const translate = t as unknown as (key: string) => string;
    return segments.filter((s) => NAV_KEYS.has(s)).map((s) => translate(s));
  }, [pathname, t]);

  return (
    <header className="flex h-14 items-center gap-2 border-b bg-card px-4">
      <nav className="flex items-center gap-2 text-sm text-muted-foreground" aria-label="breadcrumb">
        {crumbs.map((c, i) => (
          <React.Fragment key={`${c}-${i}`}>
            {i > 0 ? <span>/</span> : null}
            <span className={i === crumbs.length - 1 ? 'font-medium text-foreground' : undefined}>{c}</span>
          </React.Fragment>
        ))}
      </nav>
      <div className="ms-auto flex items-center gap-1">
        <LocaleToggle />
        <ThemeToggle />
        <Separator orientation="vertical" className="mx-1 h-6" />
        <UserMenu />
      </div>
    </header>
  );
}
