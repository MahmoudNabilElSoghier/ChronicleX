import { useTranslations } from 'next-intl';

export default function LocalePage() {
  const t = useTranslations('home');
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="text-sm opacity-70">{t('tagline')}</p>
    </main>
  );
}
