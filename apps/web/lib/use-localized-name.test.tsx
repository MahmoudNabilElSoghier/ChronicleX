import { renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';
import { useLocalizedName } from './use-localized-name';

function renderNameHook(locale: 'ar' | 'en'): { current: ReturnType<typeof useLocalizedName> } {
  const { result } = renderHook(() => useLocalizedName(), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <NextIntlClientProvider locale={locale} messages={locale === 'ar' ? ar : en}>
        {children}
      </NextIntlClientProvider>
    ),
  });
  return result;
}

describe('useLocalizedName', () => {
  it("dash fallback returns '—' with isMissing", () => {
    const { current } = renderNameHook('ar');
    expect(current(null)).toEqual({ text: '—', isMissing: true });
    expect(current({})).toEqual({ text: '—', isMissing: true });
  });

  it("empty fallback is localized ('غير محدد' / 'Not set')", () => {
    expect(renderNameHook('ar').current(undefined, { fallback: 'empty' })).toEqual({
      text: 'غير محدد',
      isMissing: true,
    });
    expect(renderNameHook('en').current(undefined, { fallback: 'empty' })).toEqual({
      text: 'Not set',
      isMissing: true,
    });
  });

  it("warning fallback returns '⚠ بيانات ناقصة'", () => {
    expect(renderNameHook('ar').current(null, { fallback: 'warning' }).text).toBe('⚠ بيانات ناقصة');
  });

  it('prefers the active locale and falls back to the other language', () => {
    const arHook = renderNameHook('ar').current;
    expect(arHook({ nameAr: 'الرحاب', nameEn: 'Rehab' })).toEqual({
      text: 'الرحاب',
      isMissing: false,
    });
    expect(arHook({ nameAr: '', nameEn: 'Rehab' })).toEqual({ text: 'Rehab', isMissing: false });
    const enHook = renderNameHook('en').current;
    expect(enHook({ nameAr: 'الرحاب', nameEn: '' })).toEqual({ text: 'الرحاب', isMissing: false });
  });

  it('isMissing is false when any name exists', () => {
    expect(renderNameHook('ar').current({ nameEn: 'Co' }).isMissing).toBe(false);
  });
});
