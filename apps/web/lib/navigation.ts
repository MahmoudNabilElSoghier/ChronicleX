import { createNavigation } from 'next-intl/navigation';

export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation({
  locales: ['ar', 'en'],
  defaultLocale: 'ar',
  localePrefix: 'always',
});