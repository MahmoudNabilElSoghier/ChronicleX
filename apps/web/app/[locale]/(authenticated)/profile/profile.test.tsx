import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ar from '@/messages/ar.json';
import ProfilePage from '@/app/[locale]/(authenticated)/profile/page';
import { adminApi } from '@/lib/api/admin';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const logoutMock = vi.fn();

vi.mock('@/lib/api/admin', () => ({
  adminApi: { users: { changePassword: vi.fn() } },
}));

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({
    user: {
      id: 'u1', email: 'a@b.c', nameAr: 'مدير', nameEn: 'Admin', isActive: true, roles: [],
    },
    status: 'authenticated',
    login: vi.fn(),
    logout: logoutMock,
  }),
  useRequireAuth: () => ({ id: 'u1' }),
}));

const changeMock = vi.mocked(adminApi.users.changePassword);

function renderProfile(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="ar" messages={ar}>
        <ProfilePage />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe('ProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mismatched confirmation blocks submit with an error', async () => {
    renderProfile();
    const inputs = screen.getAllByLabelText(/كلمة المرور/);
    fireEvent.change(inputs[0] as HTMLElement, { target: { value: 'OldPassword1' } });
    fireEvent.change(inputs[1] as HTMLElement, { target: { value: 'NewPassword22' } });
    fireEvent.change(inputs[2] as HTMLElement, { target: { value: 'Different33' } });
    fireEvent.click(screen.getByRole('button', { name: /تغيير كلمة المرور/ }));
    await waitFor(() => expect(screen.getByText(/غير متطابق/)).toBeInTheDocument());
    expect(changeMock).not.toHaveBeenCalled();
  });

  it('wrong current password maps the 401 onto the current field', async () => {
    const { ApiError } = await import('@/lib/api/client');
    changeMock.mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED', 'bad'));
    renderProfile();
    const inputs = screen.getAllByLabelText(/كلمة المرور/);
    fireEvent.change(inputs[0] as HTMLElement, { target: { value: 'WrongPass99' } });
    fireEvent.change(inputs[1] as HTMLElement, { target: { value: 'NewPassword22' } });
    fireEvent.change(inputs[2] as HTMLElement, { target: { value: 'NewPassword22' } });
    fireEvent.click(screen.getByRole('button', { name: /تغيير كلمة المرور/ }));
    const message = await screen.findByText(/كلمة المرور الحالية غير صحيحة/);
    const currentInput = screen.getByLabelText(/الحالية/) as HTMLInputElement;
    expect(message.closest('div')).toContainElement(currentInput);
    expect(currentInput.getAttribute('aria-invalid')).toBe('true');
  });

  it('success calls logout and redirects to login', async () => {
    changeMock.mockResolvedValue(undefined);
    renderProfile();
    const inputs = screen.getAllByLabelText(/كلمة المرور/);
    fireEvent.change(inputs[0] as HTMLElement, { target: { value: 'OldPassword1' } });
    fireEvent.change(inputs[1] as HTMLElement, { target: { value: 'NewPassword22' } });
    fireEvent.change(inputs[2] as HTMLElement, { target: { value: 'NewPassword22' } });
    fireEvent.click(screen.getByRole('button', { name: /تغيير كلمة المرور/ }));
    await waitFor(() => expect(changeMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(logoutMock).toHaveBeenCalled());
  });
});
