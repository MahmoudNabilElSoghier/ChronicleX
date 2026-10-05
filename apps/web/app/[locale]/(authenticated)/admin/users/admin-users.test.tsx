import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ar from '@/messages/ar.json';
import AdminUsersPage from '@/app/[locale]/(authenticated)/admin/users/page';
import { adminApi } from '@/lib/api/admin';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/lib/api/admin', () => ({
  adminApi: {
    users: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn() },
    roles: {
      list: vi.fn().mockResolvedValue({
        items: [{ id: 'r1', name: 'ARCHIVIST', description: null }],
      }),
    },
    audit: { list: vi.fn() },
  },
}));

vi.mock('@/lib/api/entries', () => ({
  catalogApi: {
    companies: vi.fn().mockResolvedValue({
      items: [{ id: 'c1', code: 2000, nameAr: 'الشركة', nameEn: 'Co' }],
    }),
    projects: vi.fn().mockResolvedValue({ items: [] }),
  },
}));

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({ user: null, status: 'unauthenticated', login: vi.fn(), logout: vi.fn() }),
  useRequireAuth: () => ({
    id: 'admin1',
    email: 'a@b.c',
    nameAr: 'مدير',
    nameEn: 'Admin',
    isActive: true,
    roles: [{ name: 'SUPER_ADMIN', scopeType: 'GROUP', scopeId: '' }],
  }),
}));

const listMock = vi.mocked(adminApi.users.list);
const createMock = vi.mocked(adminApi.users.create);
const updateMock = vi.mocked(adminApi.users.update);

function userRow(id: string, email: string, roles: { name: string }[]): Record<string, unknown> {
  return {
    id,
    email,
    nameAr: 'مستخدم',
    nameEn: 'User',
    isActive: true,
    createdAt: '2025-01-01T00:00:00.000Z',
    roles: roles.map((r) => ({ ...r, scopeType: 'COMPANY', scopeId: 'c1' })),
  };
}

function renderUsers(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <NuqsTestingAdapter hasMemory>
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="ar" messages={ar}>
          <AdminUsersPage />
        </NextIntlClientProvider>
      </QueryClientProvider>
    </NuqsTestingAdapter>,
  );
}

describe('AdminUsersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMock.mockResolvedValue({
      items: [
        userRow('u1', 'one@x.y', [{ name: 'ARCHIVIST' }]),
        userRow('u2', 'two@x.y', [{ name: 'VIEWER' }]),
        userRow('u3', 'three@x.y', [{ name: 'COMPANY_ADMIN' }]),
      ],
      nextCursor: null,
    });
  });

  it('renders users with role chips', async () => {
    renderUsers();
    await waitFor(() => expect(screen.getByText('one@x.y')).toBeInTheDocument());
    expect(screen.getByText('two@x.y')).toBeInTheDocument();
    expect(screen.getByText('three@x.y')).toBeInTheDocument();
    expect(screen.getAllByText('ARCHIVIST').length).toBeGreaterThan(0);
  });

  it('valid create submits; 409 shows the field error', async () => {
    createMock.mockResolvedValue({ id: 'u9' });
    renderUsers();
    await waitFor(() => expect(screen.getByText('one@x.y')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /إضافة مستخدم/ }));
    fireEvent.change(screen.getByLabelText(/البريد الإلكتروني/), { target: { value: 'new@x.y' } });
    fireEvent.change(screen.getByLabelText(/الاسم بالعربية/), { target: { value: 'جديد' } });
    fireEvent.change(screen.getByLabelText(/الاسم بالإنجليزية/), { target: { value: 'New' } });
    fireEvent.change(screen.getByLabelText(/كلمة المرور/), { target: { value: 'Secret123456' } });
    expect(createMock).not.toHaveBeenCalled();
    // pick the grantable role + target (scope defaults to COMPANY)
    await waitFor(() =>
      expect(
        (screen.getByLabelText(/الدور/) as HTMLSelectElement).innerHTML.includes('ARCHIVIST'),
      ).toBe(true),
    );
    const roleSelect = screen.getByLabelText(/الدور/);
    fireEvent.change(roleSelect, { target: { value: 'r1' } });
    await waitFor(() =>
      expect(screen.getByLabelText(/الجهة/).innerHTML.includes('الشركة')).toBe(true),
    );
    fireEvent.change(screen.getByLabelText(/الجهة/), { target: { value: 'c1' } });
    createMock.mockRejectedValueOnce({ status: 409 });
    fireEvent.click(screen.getByRole('button', { name: /إنشاء/ }));
    await waitFor(() =>
      expect(screen.getByText(/البريد الإلكتروني مسجل بالفعل/)).toBeInTheDocument(),
    );
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'new@x.y',
        initialRoles: [{ roleId: 'r1', scopeType: 'COMPANY', scopeId: 'c1' }],
      }),
    );
  });

  it('deactivate asks for confirmation before PATCH', async () => {
    updateMock.mockResolvedValue({});
    renderUsers();
    await waitFor(() => expect(screen.getByText('one@x.y')).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: /إلغاء التنشيط/ })[0] as HTMLElement);
    await waitFor(() =>
      expect(screen.getByText(/سيتم إلغاء تنشيط المستخدم/)).toBeInTheDocument(),
    );
    expect(updateMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /تأكيد الإلغاء/ }));
    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith('u1', { isActive: false }),
    );
  });
});
