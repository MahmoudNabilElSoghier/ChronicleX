import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ar from '@/messages/ar.json';
import ManageRolesPage from '@/app/[locale]/(authenticated)/admin/users/[id]/page';
import { adminApi } from '@/lib/api/admin';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ id: 'admin1' }),
}));

vi.mock('@/lib/api/admin', () => ({
  adminApi: {
    users: {
      get: vi.fn(),
      grantRole: vi.fn(),
      revokeRole: vi.fn(),
    },
    roles: { list: vi.fn() },
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

const callerRoles = [{ name: 'SUPER_ADMIN', scopeType: 'GROUP', scopeId: '' }];

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({ user: null, status: 'unauthenticated', login: vi.fn(), logout: vi.fn() }),
  useRequireAuth: () => ({
    id: 'admin1',
    email: 'a@b.c',
    nameAr: 'مدير',
    nameEn: 'Admin',
    isActive: true,
    roles: callerRoles,
  }),
}));

const getMock = vi.mocked(adminApi.users.get);
const rolesMock = vi.mocked(adminApi.roles.list);

function renderManage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="ar" messages={ar}>
        <ManageRolesPage />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe('ManageRolesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMock.mockResolvedValue({
      id: 'u2',
      email: 'u@x.y',
      nameAr: 'مستخدم',
      nameEn: 'User',
      isActive: true,
      createdAt: '',
      roles: [],
    });
    rolesMock.mockResolvedValue({
      items: [
        { id: 'r1', name: 'ARCHIVIST', description: null },
        { id: 'r2', name: 'VIEWER', description: null },
        { id: 'rs', name: 'SUPER_ADMIN', description: null },
      ],
    });
  });

  it('SUPER_ADMIN sees all roles in the picker', async () => {
    renderManage();
    await waitFor(() =>
      expect(
        (screen.getByLabelText(/الدور/) as HTMLSelectElement).innerHTML.includes('SUPER_ADMIN'),
      ).toBe(true),
    );
    const options = Array.from(
      (screen.getByLabelText(/الدور/) as HTMLSelectElement).options,
    ).map((o) => o.text);
    expect(options).toContain('ARCHIVIST');
    expect(options).toContain('VIEWER');
    expect(options).toContain('SUPER_ADMIN');
  });

  it('revoking own SUPER_ADMIN shows the strong warning', async () => {
    getMock.mockResolvedValue({
      id: 'admin1',
      email: 'a@b.c',
      nameAr: 'مدير',
      nameEn: 'Admin',
      isActive: true,
      createdAt: '',
      roles: [{ name: 'SUPER_ADMIN', scopeType: 'GROUP', scopeId: '' }],
    });
    renderManage();
    const row = await screen.findByText('SUPER_ADMIN', { selector: 'span.font-mono' });
    const revokeBtn = row.closest('li')?.querySelector('button') as HTMLElement;
    fireEvent.click(revokeBtn);
    await waitFor(() =>
      expect(screen.getByText(/على وشك إلغاء دور مدير النظام/)).toBeInTheDocument(),
    );
  });
});
