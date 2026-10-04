import { getRequestConfig } from 'next-intl/server';

export default getRequestConfig(async ({ locale }) => {
  const resolved = locale === 'en' ? 'en' : 'ar';
  return { locale: resolved, messages: (await import(`./messages/${resolved}.json`)).default };
});
