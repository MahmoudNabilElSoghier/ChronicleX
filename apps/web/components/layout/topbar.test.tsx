import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import ar from '@/messages/ar.json';
import { Topbar } from '@/components/layout/topbar';

const pathnameMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => pathnameMock(),
}));

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({ user: null, status: 'unauthenticated', login: vi.fn(), logout: vi.fn() }),
  useRequireAuth: () => null,
}));

function renderTopbar(): void {
  render(
    <NextIntlClientProvider locale="ar" messages={ar}>
      <Topbar />
    </NextIntlClientProvider>,
  );
}

describe('Topbar breadcrumbs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders only the parent crumb for a cuid path without IntlError', () => {
    const errors: unknown[] = [];
    const orig = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args[0]);
    };
    pathnameMock.mockReturnValue('/ar/entries/cmuwgci27000zya9sjs45sgq0');
    try {
      renderTopbar();
      expect(screen.getByText('القيود')).toBeInTheDocument();
      expect(screen.queryByText('cmuwgci27000zya9sjs45sgq0')).toBeNull();
      expect(errors.join(' ')).not.toMatch(/MISSING_MESSAGE|IntlError/);
    } finally {
      console.error = orig;
    }
  });

  it('drops action segments, keeping known parents', () => {
    pathnameMock.mockReturnValue('/ar/admin/users/x1/roles');
    renderTopbar();
    expect(screen.getByText('المستخدمون')).toBeInTheDocument();
    expect(screen.queryByText('roles')).toBeNull();
    expect(screen.queryByText('x1')).toBeNull();
  });
});
