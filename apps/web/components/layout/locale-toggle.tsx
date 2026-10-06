'use client';

import { useLocale } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { usePathname, useRouter } from '@/lib/navigation';
import { Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function LocaleToggle(): JSX.Element {
  const locale = useLocale();
  // next-intl pathname has no locale prefix (e.g. '/entries').
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  function switchTo(next: 'ar' | 'en'): void {
    const query = searchParams.toString();
    const nextPath = query ? `${pathname}?${query}` : pathname;
    router.replace(nextPath, { locale: next });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="locale">
          <Languages />
          <span className="sr-only">{locale === 'ar' ? 'العربية' : 'English'}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => switchTo('ar')}>العربية{locale === 'ar' ? ' ✓' : ''}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => switchTo('en')}>English{locale === 'en' ? ' ✓' : ''}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
