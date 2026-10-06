import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import ar from '@/messages/ar.json';
import EntryDetailPage from '@/app/[locale]/(authenticated)/entries/[id]/page';
import type { EntryDetail } from '@/lib/api/entries';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useParams: () => ({ id: 'e1' }),
}));

vi.mock('@/lib/api/entries', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/api/entries')>();
  return {
    ...mod,
    entriesApi: {
      get: vi.fn(),
      getAudit: vi.fn(),
      download: vi.fn(),
      remove: vi.fn(),
      restore: vi.fn(),
      update: vi.fn(),
    },
    catalogApi: { projects: vi.fn().mockResolvedValue({ items: [] }) },
  };
});

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({
    user: {
      id: 'u1', email: 'a@b.c', nameAr: 'مدير', nameEn: 'Admin', isActive: true,
      roles: [{ name: 'SUPER_ADMIN', scopeType: 'GROUP', scopeId: '' }],
    },
    status: 'authenticated',
    login: vi.fn(),
    logout: vi.fn(),
  }),
  useRequireAuth: () => ({ id: 'u1' }),
}));

import { entriesApi } from '@/lib/api/entries';

const getMock = vi.mocked(entriesApi.get);
const auditMock = vi.mocked(entriesApi.getAudit);
const downloadMock = vi.mocked(entriesApi.download);
const removeMock = vi.mocked(entriesApi.remove);

const detail = {
  id: 'e1',
  serial: '6200000000',
  typePrefix: '62',
  counter: 0,
  year: 2025,
  companyId: 'c1',
  projectId: 'p1',
  company: { code: 2000, nameAr: 'الشركة', nameEn: 'Co' },
  project: { code: 'R', nameAr: 'الرحاب', nameEn: 'Rehab' },
  fileName: '6200000000.pdf',
  fileSize: 2048,
  mimeType: 'application/pdf',
  fileHash: 'ab'.repeat(32),
  createdAt: '2025-01-01T00:00:00.000Z',
  deletedAt: null,
  uploadedBy: { id: 'u1', nameAr: 'مدير' },
} as EntryDetail;

function renderDetail(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="ar" messages={ar}>
        <EntryDetailPage />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe('EntryDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMock.mockResolvedValue(detail);
    auditMock.mockResolvedValue({ items: [] });
    downloadMock.mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }));
    globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:fake');
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  it('preview card shows file info without fetching; Show file renders the object', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getAllByText('6200000000.pdf').length).toBeGreaterThan(0));
    expect(downloadMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /عرض الملف/ }));
    await waitFor(() => expect(downloadMock).toHaveBeenCalledWith('e1'));
    const obj = document.querySelector('object') as HTMLObjectElement;
    expect(obj.data).toBe('blob:fake');
    expect(obj.type).toBe('application/pdf');
  });

  it('renders the uploader name from the response', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getAllByText('مدير').length).toBeGreaterThan(0));
  });

  it('delete confirmation dialog calls entriesApi.remove', async () => {
    const user = userEvent.setup();
    removeMock.mockResolvedValue(undefined);
    renderDetail();
    await waitFor(() => expect(screen.getAllByText('6200000000').length).toBeGreaterThan(0));
    await user.click(screen.getByRole('tab', { name: /إجراءات/ }));
    await user.click(screen.getByRole('button', { name: /حذف/ }));
    await waitFor(() => expect(screen.getByText(/سيتم حذف القيد/)).toBeInTheDocument());
    // Radix locks body pointer-events while the dialog is open; fireEvent
    // bypasses user-event's pointer check (jsdom has no real hit-testing).
    // Radix hides background from the a11y tree (aria-hidden + inert), so only
    // the dialog's own confirm button is queryable here.
    fireEvent.click(screen.getByRole('button', { name: /^حذف$/ }));
    await waitFor(() => expect(removeMock).toHaveBeenCalledWith('e1'));
  });

  it('audit timeline renders events newest-first', async () => {
    const user = userEvent.setup();
    auditMock.mockResolvedValue({
      items: [
        {
          id: 'a2', action: 'DELETE', resource: 'ENTRY', userId: 'u1', userNameAr: 'مدير',
          event: 'DELETE', createdAt: '2025-02-01T00:00:00.000Z', oldValues: null, newValues: null,
        },
        {
          id: 'a1', action: 'CREATE', resource: 'ENTRY', userId: 'u1', userNameAr: 'مدير',
          event: 'CREATE', createdAt: '2025-01-01T00:00:00.000Z', oldValues: null, newValues: null,
        },
      ],
    });
    renderDetail();
    await waitFor(() => expect(screen.getAllByText('6200000000').length).toBeGreaterThan(0));
    await user.click(screen.getByRole('tab', { name: /سجل التدقيق/ }));
    await waitFor(() => expect(screen.getByText(/حذف القيد/)).toBeInTheDocument());
    const entries = screen.getAllByText(/القيد/);
    expect(entries[0]?.textContent).toMatch(/حذف/);
  });
});
