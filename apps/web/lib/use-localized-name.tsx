'use client';

import { useLocale } from 'next-intl';

export type NameFallback = 'dash' | 'empty' | 'warning';

export interface Bilingual {
  nameAr?: string | null;
  nameEn?: string | null;
}

const EMPTY_TEXT = { ar: 'غير محدد', en: 'Not set' } as const;
const WARNING_TEXT = { ar: '⚠ بيانات ناقصة', en: '⚠ Incomplete data' } as const;

export interface LocalizedName {
  text: string;
  isMissing: boolean;
}

/**
 * Context-aware bilingual name resolution.
 * - tables: { fallback: 'dash' } → '—' (dense, with a title attr by the caller)
 * - detail views: { fallback: 'empty' } → 'غير محدد' / 'Not set'
 * - required relations: { fallback: 'warning' } → '⚠ بيانات ناقصة'
 * Prefers the active locale, falls back to the other language, then the
 * fallback. isMissing lets callers add icons/styling.
 */
export function useLocalizedName(): (
  entity: Bilingual | null | undefined,
  options?: { fallback?: NameFallback; custom?: string },
) => LocalizedName {
  const locale = useLocale();
  const ar = locale === 'ar';
  return (entity, options) => {
    const primary = ar ? entity?.nameAr : entity?.nameEn;
    const secondary = ar ? entity?.nameEn : entity?.nameAr;
    const text = primary?.trim() || secondary?.trim() || null;
    if (text) {
      return { text, isMissing: false };
    }
    if (options?.custom !== undefined) {
      return { text: options.custom, isMissing: true };
    }
    const fallback = options?.fallback ?? 'dash';
    if (fallback === 'empty') {
      return { text: ar ? EMPTY_TEXT.ar : EMPTY_TEXT.en, isMissing: true };
    }
    if (fallback === 'warning') {
      return { text: ar ? WARNING_TEXT.ar : WARNING_TEXT.en, isMissing: true };
    }
    return { text: '—', isMissing: true };
  };
}
