import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ar from '@/messages/ar.json';
import AdminStructurePage from '@/app/[locale]/(authenticated)/admin/structure/page';
import { adminApi, type StructureCompany } from '@/lib/api/admin';

const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
}));

vi.mock('@/lib/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  usePathname: () => '/admin/structure',
  Link: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  redirect: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/api/admin', () => ({
  adminApi: {
    structure: { get: vi.fn() },
    users: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn() },
    roles: { list: vi.fn() },
    audit: { list: vi.fn() },
  },
}));

let rolesMock: { name: string; scopeType: string; scopeId: string }[] = [
  { name: 'SUPER_ADMIN', scopeType: 'GROUP', scopeId: '' },
];

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({ user: null, status: 'authenticated', login: vi.fn(), logout: vi.fn() }),
  useRequireAuth: () => ({
    id: 'admin1',
    email: 'a@b.c',
    nameAr: 'مدير',
    nameEn: 'Admin',
    isActive: true,
    roles: rolesMock,
  }),
}));

const structureMock = vi.mocked(adminApi.structure.get);

const structure = {
  companies: [
    {
      id: 'c1',
      code: 2000,
      nameAr: 'شركة النيل',
      nameEn: 'Nile Co',
      entryCount: 10,
      lastUploadAt: '2025-03-01T12:00:00.000Z',
      projects: [
        {
          id: 'p1',
          code: 'REHAB',
          nameAr: 'مشروع الترميم',
          nameEn: 'Rehab',
          entryCount: 7,
          lastUploadAt: '2025-03-01T12:00:00.000Z',
        },
        {
          id: 'p2',
          code: 'NEWBLD',
          nameAr: 'مشروع جديد',
          nameEn: 'New building',
          entryCount: 0,
          lastUploadAt: null,
        },
      ],
    },
    {
      id: 'c2',
      code: 3000,
      nameAr: 'شركة المستقبل',
      nameEn: 'Future Co',
      entryCount: 4,
      lastUploadAt: null,
      projects: [],
    },
  ] as StructureCompany[],
};

function renderStructure(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="ar" messages={ar}>
        <AdminStructurePage />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe('AdminStructurePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rolesMock = [{ name: 'SUPER_ADMIN', scopeType: 'GROUP', scopeId: '' }];
    structureMock.mockResolvedValue(structure);
  });

  it('renders the company tree with counts and project entry links', async () => {
    renderStructure();
    await waitFor(() => expect(screen.getByText('شركة النيل')).toBeInTheDocument());
    expect(screen.getByText('Nile Co')).toBeInTheDocument();
    expect(screen.getByText('شركة المستقبل')).toBeInTheDocument();
    expect(screen.getByText('مشروع الترميم')).toBeInTheDocument();
    expect(screen.getByText('مشروع جديد')).toBeInTheDocument();

    const links = screen.getAllByRole('link', { name: 'عرض القيود' });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', '/entries?companyId=c1&projectId=p1');
    expect(links[1]).toHaveAttribute('href', '/entries?companyId=c1&projectId=p2');
  });

  it('company header collapses and re-expands its projects', async () => {
    renderStructure();
    const header = await screen.findByRole('button', { name: /شركة النيل/ });
    expect(screen.getByText('مشروع الترميم')).toBeInTheDocument();
    fireEvent.click(header);
    expect(screen.queryByText('مشروع الترميم')).not.toBeInTheDocument();
    expect(screen.getByText('شركة النيل')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /شركة النيل/ }));
    expect(screen.getByText('مشروع الترميم')).toBeInTheDocument();
  });

  it('search narrows companies and projects', async () => {
    renderStructure();
    const search = await screen.findByLabelText('ابحث عن شركة أو مشروع...');
    await waitFor(() => expect(screen.getByText('شركة النيل')).toBeInTheDocument());

    fireEvent.change(search, { target: { value: 'مستقبل' } });
    expect(screen.getByText('شركة المستقبل')).toBeInTheDocument();
    expect(screen.queryByText('شركة النيل')).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'rehab' } });
    expect(screen.getByText('شركة النيل')).toBeInTheDocument();
    expect(screen.queryByText('شركة المستقبل')).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByText('لا توجد نتائج مطابقة')).toBeInTheDocument();
    expect(screen.queryByText('شركة النيل')).not.toBeInTheDocument();
  });

  it('non-admin users are redirected away', async () => {
    rolesMock = [{ name: 'ARCHIVIST', scopeType: 'PROJECT', scopeId: 'p1' }];
    renderStructure();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
  });
});
