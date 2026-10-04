import { useTranslations } from 'next-intl';

export default function LocalePage() {
  const t = useTranslations('home');
  return (
    <main className="flex min-h-screen items-center justify-center">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
    </main>
  );
}
