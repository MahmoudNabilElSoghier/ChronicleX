import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import ar from '@/messages/ar.json';
import { LocaleToggle } from '@/components/layout/locale-toggle';
import { Sidebar } from '@/components/layout/sidebar';

const replace = vi.fn();
let mockPathname = '/entries';
let mockSearch = '?year=2024';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  usePathname: () => '/ar/entries?year=2024',
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

vi.mock('@/lib/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  usePathname: () => mockPathname,
  Link: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({
    user: {
      id: 'u1', email: 'a@b.c', nameAr: 'م', nameEn: 'A', isActive: true,
      roles: [{ name: 'ARCHIVIST', scopeType: 'PROJECT', scopeId: 'p1' }],
    },
    status: 'authenticated',
    login: vi.fn(),
    logout: vi.fn(),
  }),
  useRequireAuth: () => ({ id: 'u1' }),
}));

function renderWithProviders(ui: ReactNode): void {
  render(
    <NuqsTestingAdapter hasMemory>
      <NextIntlClientProvider locale="ar" messages={ar}>
        {ui}
      </NextIntlClientProvider>
    </NuqsTestingAdapter>,
  );
}

describe('locale navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname = '/entries';
    mockSearch = '?year=2024';
  });

  it('switching locale preserves pathname and query', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LocaleToggle />);
    await user.click(screen.getByRole('button', { name: 'locale' }));
    await user.click(await screen.findByText(/English/));
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/entries?year=2024', { locale: 'en' }),
    );
  });

  it('sidebar links delegate locale prefixing to next-intl Link (bare paths)', async () => {
    mockPathname = '/entries';
    renderWithProviders(<Sidebar />);
    const entriesLink = await screen.findByRole('link', { name: /القيود/ });
    // Bare path: next-intl Link adds the current locale prefix at runtime.
    // A hardcoded '/ar/…' or '/en/…' here would be the locale-loss bug.
    expect(entriesLink.getAttribute('href')).toBe('/entries');
  });

  it('upload link is locale-agnostic too', async () => {
    mockPathname = '/ar/dashboard';
    renderWithProviders(<Sidebar />);
    const uploadLink = await screen.findByRole('link', { name: /رفع/ });
    expect(uploadLink.getAttribute('href')).toBe('/upload');
  });
});
