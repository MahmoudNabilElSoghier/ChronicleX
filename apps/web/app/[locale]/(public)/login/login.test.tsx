import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ar from '@/messages/ar.json';
import { AuthProvider } from '@/lib/auth/auth-context';
import LoginPage from '@/app/[locale]/(public)/login/page';

const push = vi.fn();
const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/api/endpoints')>();
  return {
    ...mod,
    authApi: {
      login: vi.fn(),
      logout: vi.fn(),
      me: vi.fn(),
    },
  };
});

import { authApi } from '@/lib/api/endpoints';

const loginMock = vi.mocked(authApi.login);

function renderLogin(): void {
  render(
    <NextIntlClientProvider locale="ar" messages={ar}>
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    </NextIntlClientProvider>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loginMock.mockRejectedValue(new Error('no session'));
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('no session'));
  });

  it('shows validation errors for bad input', async () => {
    const user = userEvent.setup();
    renderLogin();
    await waitFor(() => expect(screen.getByRole('button', { name: /تسجيل الدخول/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /تسجيل الدخول/ }));
    expect(await screen.findByText(/بريد إلكتروني صحيح/)).toBeInTheDocument();
    expect(loginMock).not.toHaveBeenCalled();
  });

  it('submits valid credentials to authApi.login', async () => {
    const user = userEvent.setup();
    loginMock.mockResolvedValue({
      accessToken: 'a.b.c',
      user: { id: 'u1', email: 'a@b.c', nameAr: 'ن', nameEn: 'N' },
    });
    const { authApi: mocked } = await import('@/lib/api/endpoints');
    vi.mocked(mocked.me).mockResolvedValue({
      id: 'u1',
      email: 'a@b.c',
      nameAr: 'ن',
      nameEn: 'N',
      isActive: true,
      roles: [],
    });
    renderLogin();
    await waitFor(() => expect(screen.getByLabelText(/البريد الإلكتروني/)).toBeInTheDocument());
    await user.type(screen.getByLabelText(/البريد الإلكتروني/), 'archivist@example.com');
    await user.type(screen.getByLabelText(/كلمة المرور/), 'Password123');
    await user.click(screen.getByRole('button', { name: /تسجيل الدخول/ }));
    await waitFor(() =>
      expect(loginMock).toHaveBeenCalledWith('archivist@example.com', 'Password123'),
    );
  });
});
