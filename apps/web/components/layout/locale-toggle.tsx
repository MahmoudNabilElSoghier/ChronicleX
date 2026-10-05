'use client';

import { useLocale } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
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
  const pathname = usePathname();
  const router = useRouter();

  function switchTo(next: string): void {
    const rest = pathname.replace(/^\/(ar|en)(?=\/|$)/, '') || '/';
    router.replace(`/${next}${rest}`);
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
