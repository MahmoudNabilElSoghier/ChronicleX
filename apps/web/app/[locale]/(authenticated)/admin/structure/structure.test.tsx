import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { toast } from 'sonner';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ar from '@/messages/ar.json';
import AdminStructurePage from '@/app/[locale]/(authenticated)/admin/structure/page';
import { adminApi, type StructureCompany } from '@/lib/api/admin';
import { fetchEntryPrefixes, settingsApi } from '@/lib/api/settings';

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
    companies: { create: vi.fn(), update: vi.fn(), remove: vi.fn() },
    projects: { create: vi.fn(), update: vi.fn(), remove: vi.fn() },
    users: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn() },
    roles: { list: vi.fn() },
    audit: { list: vi.fn() },
  },
}));

vi.mock('@/lib/api/settings', () => ({
  entryPrefixesQueryKey: ['settings', 'entry-prefixes'],
  fetchEntryPrefixes: vi.fn(),
  settingsApi: { getEntryPrefixes: vi.fn(), updateEntryPrefixes: vi.fn() },
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
const companiesCreateMock = vi.mocked(adminApi.companies.create);
const companiesUpdateMock = vi.mocked(adminApi.companies.update);
const companiesRemoveMock = vi.mocked(adminApi.companies.remove);
const projectsCreateMock = vi.mocked(adminApi.projects.create);
const projectsUpdateMock = vi.mocked(adminApi.projects.update);
const projectsRemoveMock = vi.mocked(adminApi.projects.remove);
const fetchPrefixesMock = vi.mocked(fetchEntryPrefixes);
const updatePrefixesMock = vi.mocked(settingsApi.updateEntryPrefixes);

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
    fetchPrefixesMock.mockResolvedValue(['62', '63', '67']);
    updatePrefixesMock.mockResolvedValue({ prefixes: [] });
    companiesCreateMock.mockResolvedValue({ id: 'c9', code: 9900, nameAr: 'A', nameEn: 'B' });
    companiesUpdateMock.mockResolvedValue({ id: 'c1', code: 2000, nameAr: 'A', nameEn: 'B' });
    companiesRemoveMock.mockResolvedValue({ id: 'c1', code: 2000, nameAr: 'A', nameEn: 'B' });
    projectsCreateMock.mockResolvedValue({ id: 'p9', code: 'X', nameAr: 'A', nameEn: 'B', companyId: 'c1' });
    projectsUpdateMock.mockResolvedValue({ id: 'p1', code: 'REHAB', nameAr: 'A', nameEn: 'B', companyId: 'c1' });
    projectsRemoveMock.mockResolvedValue({ id: 'p1', code: 'REHAB', nameAr: 'A', nameEn: 'B', companyId: 'c1' });
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
    const header = await screen.findByRole('button', { name: /^شركة النيل/ });
    expect(screen.getByText('مشروع الترميم')).toBeInTheDocument();
    fireEvent.click(header);
    expect(screen.queryByText('مشروع الترميم')).not.toBeInTheDocument();
    expect(screen.getByText('شركة النيل')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^شركة النيل/ }));
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

  it('settings section is visible to SUPER_ADMIN with the fetched prefixes', async () => {
    renderStructure();
    await waitFor(() => expect(screen.getByText('62')).toBeInTheDocument());
    expect(screen.getByText('63')).toBeInTheDocument();
    expect(screen.getByText('67')).toBeInTheDocument();
    expect(screen.getByLabelText('بادئة جديدة (رقمان)')).toBeInTheDocument();
  });

  it('settings section is hidden for COMPANY_ADMIN', async () => {
    rolesMock = [{ name: 'COMPANY_ADMIN', scopeType: 'COMPANY', scopeId: 'c1' }];
    renderStructure();
    await waitFor(() => expect(screen.getByText('شركة النيل')).toBeInTheDocument());
    expect(screen.queryByLabelText('بادئة جديدة (رقمان)')).not.toBeInTheDocument();
    expect(screen.queryByText('62')).not.toBeInTheDocument();
  });

  it('prefix save regression: PUT is sent, chips keep the new list, save disables', async () => {
    renderStructure();
    await waitFor(() => expect(screen.getByText('62')).toBeInTheDocument());
    // The invalidate-refetch after save converges on the saved list.
    fetchPrefixesMock.mockResolvedValue(['62', '63', '67', '99']);
    updatePrefixesMock.mockResolvedValue({ prefixes: ['62', '63', '67', '99'] });

    fireEvent.change(screen.getByLabelText('بادئة جديدة (رقمان)'), {
      target: { value: '99' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'إضافة' }));
    expect(screen.getByText('99')).toBeInTheDocument();

    const save = screen.getByRole('button', { name: 'حفظ التغييرات' });
    expect(save).not.toBeDisabled();
    fireEvent.click(save);

    await waitFor(() =>
      expect(updatePrefixesMock).toHaveBeenCalledWith(['62', '63', '67', '99']),
    );
    expect(toast.success).toHaveBeenCalledWith('تم حفظ البادئات');
    // Regression: chips must NOT revert to the pre-save list, and the save
    // button must settle back to disabled once the refetch lands.
    expect(screen.getByText('99')).toBeInTheDocument();
    expect(screen.getByText('62')).toBeInTheDocument();
    await waitFor(() => expect(save).toBeDisabled());
  });

  it('SUPER_ADMIN opens the create-company modal and POSTs the code + names', async () => {
    renderStructure();
    await waitFor(() => expect(screen.getByText('شركة النيل')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'إضافة شركة' }));
    fireEvent.change(screen.getByLabelText('الكود'), { target: { value: '9900' } });
    fireEvent.change(screen.getByLabelText('الاسم بالعربية'), { target: { value: 'شركة جديدة' } });
    fireEvent.change(screen.getByLabelText('الاسم بالإنجليزية'), { target: { value: 'New Co' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }));
    await waitFor(() =>
      expect(companiesCreateMock).toHaveBeenCalledWith({
        code: 9900,
        nameAr: 'شركة جديدة',
        nameEn: 'New Co',
      }),
    );
    expect(toast.success).toHaveBeenCalledWith('تم إنشاء الشركة بنجاح');
  });

  it('edit-company modal renames only (no code field)', async () => {
    renderStructure();
    await waitFor(() => expect(screen.getByText('شركة النيل')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'تعديل شركة النيل' }));
    expect(screen.queryByLabelText('الكود')).not.toBeInTheDocument();
    const nameAr = screen.getByLabelText('الاسم بالعربية') as HTMLInputElement;
    expect(nameAr.value).toBe('شركة النيل');
    fireEvent.change(nameAr, { target: { value: 'شركة النيل الجديدة' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }));
    await waitFor(() =>
      expect(companiesUpdateMock).toHaveBeenCalledWith('c1', {
        nameAr: 'شركة النيل الجديدة',
        nameEn: 'Nile Co',
      }),
    );
  });

  it('delete company asks for confirmation, then soft-deletes', async () => {
    renderStructure();
    await waitFor(() => expect(screen.getByText('شركة النيل')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'حذف شركة النيل' }));
    expect(
      screen.getByText(/حذف الشركة شركة النيل/),
    ).toBeInTheDocument();
    expect(companiesRemoveMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'حذف' }));
    await waitFor(() => expect(companiesRemoveMock).toHaveBeenCalledWith('c1'));
    expect(toast.success).toHaveBeenCalledWith('تم حذف الشركة');
  });

  it('delete company refused (active projects) shows the blocking message in the dialog', async () => {
    renderStructure();
    await waitFor(() => expect(screen.getByText('شركة النيل')).toBeInTheDocument());
    companiesRemoveMock.mockRejectedValueOnce({
      status: 400,
      message: 'لا يمكن حذف الشركة — تحتوي على 2 مشروع نشط',
    });
    fireEvent.click(screen.getByRole('button', { name: 'حذف شركة النيل' }));
    fireEvent.click(screen.getByRole('button', { name: 'حذف' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'لا يمكن حذف الشركة — تحتوي على 2 مشروع نشط',
      ),
    );
    // Dialog stays open — the delete is blocked, not just toasted.
    expect(screen.getByText(/تأكيد الحذف/)).toBeInTheDocument();
  });

  it('add-project modal pre-fills the parent company and POSTs with its id', async () => {
    renderStructure();
    await waitFor(() => expect(screen.getByText('شركة النيل')).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: 'إضافة مشروع' })[0]);
    fireEvent.change(screen.getByLabelText('الكود'), { target: { value: 'SSC2' } });
    fireEvent.change(screen.getByLabelText('الاسم بالعربية'), { target: { value: 'مشروع' } });
    fireEvent.change(screen.getByLabelText('الاسم بالإنجليزية'), { target: { value: 'Proj' } });
    expect(screen.getByLabelText('الشركة')).toHaveValue('شركة النيل');
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }));
    await waitFor(() =>
      expect(projectsCreateMock).toHaveBeenCalledWith({
        code: 'SSC2',
        nameAr: 'مشروع',
        nameEn: 'Proj',
        companyId: 'c1',
      }),
    );
  });

  it('edit-project modal renames only', async () => {
    renderStructure();
    await waitFor(() => expect(screen.getByText('مشروع الترميم')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'تعديل مشروع الترميم' }));
    expect(screen.queryByLabelText('الكود')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('الاسم بالعربية'), { target: { value: 'ترميم' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }));
    await waitFor(() =>
      expect(projectsUpdateMock).toHaveBeenCalledWith('p1', {
        nameAr: 'ترميم',
        nameEn: 'Rehab',
      }),
    );
  });

  it('delete project with recorded entries shows the blocking dialog', async () => {
    renderStructure();
    await waitFor(() => expect(screen.getByText('مشروع الترميم')).toBeInTheDocument());
    projectsRemoveMock.mockRejectedValueOnce({
      status: 400,
      message: 'لا يمكن حذف المشروع — يحتوي على 3 قيد مسجل',
    });
    fireEvent.click(screen.getByRole('button', { name: 'حذف مشروع الترميم' }));
    expect(screen.getByText(/لن تتأثر القيود المسجلة/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'حذف' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'لا يمكن حذف المشروع — يحتوي على 3 قيد مسجل',
      ),
    );
    expect(projectsRemoveMock).toHaveBeenCalledWith('p1');
  });

  it('COMPANY_ADMIN of c1: no company mutations, project actions only inside c1', async () => {
    rolesMock = [{ name: 'COMPANY_ADMIN', scopeType: 'COMPANY', scopeId: 'c1' }];
    renderStructure();
    await waitFor(() => expect(screen.getByText('شركة النيل')).toBeInTheDocument());

    // Company-level actions are SUPER_ADMIN only.
    expect(screen.queryByRole('button', { name: 'إضافة شركة' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'تعديل شركة النيل' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'حذف شركة النيل' })).not.toBeInTheDocument();

    // Project actions exist inside their own company…
    expect(screen.getByRole('button', { name: 'إضافة مشروع' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'تعديل مشروع الترميم' })).toBeInTheDocument();
    // …but not inside another company.
    expect(screen.queryByRole('button', { name: 'تعديل شركة المستقبل' })).not.toBeInTheDocument();
  });
});
