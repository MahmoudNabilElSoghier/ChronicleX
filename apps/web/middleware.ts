import createMiddleware from 'next-intl/middleware';

export default createMiddleware({
  locales: ['ar', 'en'],
  defaultLocale: 'ar',
  localePrefix: 'always'
});

export const config = {
  // Match all paths except:
  // - /api/*          (API routes)
  // - /_next/*        (Next.js internals)
  // - /*.*            (files with extensions: favicon.ico, image.png, etc.)
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)']
};