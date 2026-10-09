'use client';

import { Link, usePathname } from '@/lib/navigation';
import { useTranslations } from 'next-intl';
import {
  Building2,
  FileText,
  Home,
  ScrollText,
  Settings,
  Upload,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth/auth-context';
import { useActiveJobs } from '@/lib/upload/active-jobs-context';

export function Sidebar(): JSX.Element {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const { user } = useAuth();
  const pendingJobs = useActiveJobs()?.jobs.length ?? 0;
  const roleNames = new Set((user?.roles ?? []).map((r) => r.name));
  // Upload requires CREATE ENTRY in practice; VIEWER-only users never have
  // it, so hide the entry point (the backend still enforces with 403).
  const canUpload = [...roleNames].some((r) => r !== 'VIEWER');
  const isAdmin = roleNames.has('SUPER_ADMIN') || roleNames.has('COMPANY_ADMIN');

  const items = [
    { href: '/dashboard', label: t('dashboard'), icon: Home, show: true, badge: 0 },
    { href: '/entries', label: t('entries'), icon: FileText, show: true, badge: 0 },
    { href: '/upload', label: t('upload'), icon: Upload, show: canUpload, badge: pendingJobs },
    {
      href: '/admin/users',
      label: t('users'),
      icon: Users,
      show: isAdmin,
      badge: 0,
    },
    {
      href: '/admin/audit',
      label: t('audit'),
      icon: ScrollText,
      show: isAdmin,
      badge: 0,
    },
    {
      href: '/admin/structure',
      label: t('structure'),
      icon: Building2,
      show: isAdmin,
      badge: 0,
    },
    {
      href: '/admin/settings',
      label: t('settings'),
      icon: Settings,
      show: roleNames.has('SUPER_ADMIN'),
      badge: 0,
    },
  ];

  return (
    <aside className="flex w-16 flex-col gap-1 border-e bg-card p-2 md:w-56">
      <Link href="/dashboard" className="mb-4 flex items-center gap-2 px-2 pt-2">
        <span className="text-lg font-bold">ChronicleX</span>
      </Link>
      {items
        .filter((i) => i.show)
        .map((item) => {
          const active = pathname.endsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                active && 'bg-accent text-accent-foreground',
              )}
            >
              <Icon />
              <span className="hidden md:inline">{item.label}</span>
              {item.badge > 0 ? (
                <span className="ms-auto hidden rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground md:inline">
                  {item.badge}
                </span>
              ) : null}
            </Link>
          );
        })}
    </aside>
  );
}
