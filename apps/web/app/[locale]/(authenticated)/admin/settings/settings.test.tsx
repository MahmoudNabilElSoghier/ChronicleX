import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ar from '@/messages/ar.json';
import AdminSettingsPage from '@/app/[locale]/(authenticated)/admin/settings/page';
import { fetchEntryPrefixes, settingsApi } from '@/lib/api/settings';

const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
}));

vi.mock('@/lib/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  usePathname: () => '/admin/settings',
  redirect: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
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

const fetchMock = vi.mocked(fetchEntryPrefixes);
const updateMock = vi.mocked(settingsApi.updateEntryPrefixes);

function renderSettings(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="ar" messages={ar}>
        <AdminSettingsPage />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe('AdminSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rolesMock = [{ name: 'SUPER_ADMIN', scopeType: 'GROUP', scopeId: '' }];
    fetchMock.mockResolvedValue(['62', '63', '67']);
    updateMock.mockResolvedValue({ prefixes: [] });
  });

  it('renders the fetched prefixes as removable chips', async () => {
    renderSettings();
    await waitFor(() => expect(screen.getByText('62')).toBeInTheDocument());
    expect(screen.getByText('63')).toBeInTheDocument();
    expect(screen.getByText('67')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'حذف البادئة 63' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'حفظ التغييرات' }),
    ).toBeDisabled();
  });

  it('rejects invalid and duplicate prefixes inline', async () => {
    renderSettings();
    const input = await screen.findByLabelText('بادئة جديدة (رقمان)');
    await waitFor(() => expect(screen.getByText('62')).toBeInTheDocument());

    fireEvent.change(input, { target: { value: '6A' } });
    fireEvent.click(screen.getByRole('button', { name: 'إضافة' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'أدخل رقمين رقميين فقط (مثل 62)',
    );
    expect(screen.queryByText('6A')).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: '62' } });
    fireEvent.click(screen.getByRole('button', { name: 'إضافة' }));
    expect(screen.getByRole('alert')).toHaveTextContent('البادئة موجودة بالفعل');
  });

  it('adding a prefix enables save; PUT sends the full list, then resets', async () => {
    renderSettings();
    const input = await screen.findByLabelText('بادئة جديدة (رقمان)');
    await waitFor(() => expect(screen.getByText('62')).toBeInTheDocument());

    const save = screen.getByRole('button', { name: 'حفظ التغييرات' });
    fireEvent.change(input, { target: { value: '99' } });
    fireEvent.click(screen.getByRole('button', { name: 'إضافة' }));
    expect(screen.getByText('99')).toBeInTheDocument();
    expect(save).not.toBeDisabled();

    fireEvent.click(save);
    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith(['62', '63', '67', '99']),
    );
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    await waitFor(() => expect(save).toBeDisabled());
  });

  it('removing a chip then saving sends the reduced list', async () => {
    renderSettings();
    await waitFor(() => expect(screen.getByText('63')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'حذف البادئة 63' }));
    expect(screen.queryByText('63')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'حفظ التغييرات' }));
    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith(['62', '67']),
    );
  });

  it('a 403 on save shows the permission message and keeps the draft', async () => {
    renderSettings();
    await waitFor(() => expect(screen.getByText('63')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'حذف البادئة 63' }));
    updateMock.mockRejectedValueOnce({ status: 403 });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ التغييرات' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('لا تملك صلاحية تعديل إعدادات المجموعة'),
    );
    expect(screen.queryByText('63')).not.toBeInTheDocument();
  });

  it('non-super-admins are redirected away', async () => {
    rolesMock = [{ name: 'COMPANY_ADMIN', scopeType: 'COMPANY', scopeId: 'c1' }];
    renderSettings();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
  });
});
