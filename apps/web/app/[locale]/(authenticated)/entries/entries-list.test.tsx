import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import type { ReactNode } from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ar from '@/messages/ar.json';
import EntriesListPage from '@/app/[locale]/(authenticated)/entries/page';
import type { EntriesListResponse, EntryListItem } from '@/lib/api/entries';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/ar/entries',
}));

vi.mock('@/lib/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/ar/entries',
  useParams: () => ({ id: 'e1' }),
  Link: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  redirect: vi.fn(),
}));

vi.mock('@/lib/api/entries', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/api/entries')>();
  return {
    ...mod,
    entriesApi: { list: vi.fn(), download: vi.fn(), exportCsv: vi.fn(), bundleDownload: vi.fn() },
    catalogApi: {
      companies: vi.fn().mockResolvedValue({ items: [] }),
      projects: vi.fn().mockResolvedValue({ items: [] }),
      years: vi.fn().mockResolvedValue({ years: [2025, 2024] }),
    },
  };
});

vi.mock('@/lib/download', () => ({
  saveBlob: vi.fn(),
  openBlob: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    // Real toast.loading returns a toast id used to update the same toast.
    loading: vi.fn(() => 'progress-toast'),
    dismiss: vi.fn(),
  },
}));

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({ user: null, status: 'unauthenticated', login: vi.fn(), logout: vi.fn() }),
  useRequireAuth: () => null,
}));

import { entriesApi } from '@/lib/api/entries';
import { saveBlob } from '@/lib/download';
import { toast } from 'sonner';

const listMock = vi.mocked(entriesApi.list);
const exportMock = vi.mocked(entriesApi.exportCsv);
const bundleMock = vi.mocked(entriesApi.bundleDownload);

function item(id: string, serial: string): EntryListItem {
  return {
    id,
    serial,
    typePrefix: '62',
    year: 2025,
    companyId: 'c1',
    projectId: 'p1',
    company: { code: 2000, nameAr: 'الشركة', nameEn: 'Co' },
    project: { code: 'R', nameAr: 'الرحاب', nameEn: 'Rehab' },
    fileName: `${serial}.pdf`,
    fileSize: 1024,
    createdAt: '2025-01-01T00:00:00.000Z',
    deletedAt: null,
    uploadedBy: { id: 'u1', nameAr: 'مدير' },
  };
}

type UrlUpdate = { searchParams: URLSearchParams; queryString: string };

function renderList(opts?: { onUrlUpdate?: (event: UrlUpdate) => void }): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <NuqsTestingAdapter hasMemory onUrlUpdate={opts?.onUrlUpdate}>
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="ar" messages={ar}>
          <EntriesListPage />
        </NextIntlClientProvider>
      </QueryClientProvider>
    </NuqsTestingAdapter>,
  );
}

describe('EntriesListPage', () => {
  const widthDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  const heightDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');

  beforeAll(() => {
    // jsdom reports zero layout boxes (offsetWidth/Height === 0), which
    // starves the virtualizer. Report a viewport-sized box instead.
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get: () => 1024,
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get: () => 600,
    });
  });

  afterAll(() => {
    if (widthDesc) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', widthDesc);
    if (heightDesc) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', heightDesc);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    listMock.mockResolvedValue({
      items: ['1', '2', '3', '4', '5'].map((i) => item(`e${i}`, `620000000${i}`)),
      nextCursor: null,
      hasMore: false,
    } satisfies EntriesListResponse);
    exportMock.mockResolvedValue(new Blob(['csv']));
    bundleMock.mockResolvedValue(new Blob(['PK'], { type: 'application/zip' }));
  });

  it('renders 5 mock items', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('6200000001')).toBeInTheDocument());
    expect(screen.getByText('6200000005')).toBeInTheDocument();
  });

  it('year filter changes the request queryKey', async () => {
    const user = userEvent.setup();
    renderList();
    await waitFor(() => expect(screen.getByText('6200000001')).toBeInTheDocument());
    const selects = screen.getAllByRole('combobox');
    const yearSelect = selects.find((s) => s.innerHTML.includes('2025'));
    expect(yearSelect).toBeDefined();
    await user.selectOptions(yearSelect as HTMLElement, '2024');
    await waitFor(() =>
      expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ year: 2024 })),
    );
  });

  it('Load more appends the next page', async () => {
    const user = userEvent.setup();
    listMock
      .mockResolvedValueOnce({
        items: ['1', '2'].map((i) => item(`e${i}`, `620000000${i}`)),
        nextCursor: 'e2',
        hasMore: true,
      })
      .mockResolvedValueOnce({
        items: ['3'].map((i) => item(`e${i}`, `620000000${i}`)),
        nextCursor: null,
        hasMore: false,
      });
    renderList();
    await waitFor(() => expect(screen.getByText('6200000001')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /عرض المزيد/ }));
    await waitFor(() => expect(screen.getByText('6200000003')).toBeInTheDocument());
    expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'e2' }));
  });

  it('serial range triggers a request with serialFrom and serialTo in the queryKey', async () => {
    const user = userEvent.setup();
    renderList();
    await waitFor(() => expect(screen.getByText('6200000001')).toBeInTheDocument());
    await user.type(screen.getByLabelText('من'), '6200000010');
    await user.type(screen.getByLabelText('إلى'), '6200000050');
    await waitFor(() =>
      expect(listMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ serialFrom: '6200000010', serialTo: '6200000050' }),
      ),
    );
    // Cursor pagination restarts on any filter change.
    expect(listMock).not.toHaveBeenCalledWith(expect.objectContaining({ cursor: expect.anything() }));
  });

  it('serialFrom > serialTo shows the validation message and does NOT fire the request', async () => {
    const user = userEvent.setup();
    renderList();
    await waitFor(() => expect(screen.getByText('6200000001')).toBeInTheDocument());
    await user.type(screen.getByLabelText('من'), '6200000050');
    await user.type(screen.getByLabelText('إلى'), '6200000010');
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'يجب أن يكون الرقم الأول أصغر من أو يساوي الثاني',
      ),
    );
    expect(listMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ serialFrom: '6200000050', serialTo: '6200000010' }),
    );
  });

  it('"مسح المدى" clears both inputs and removes them from the URL', async () => {
    const user = userEvent.setup();
    const onUrlUpdate = vi.fn();
    renderList({ onUrlUpdate });
    await waitFor(() => expect(screen.getByText('6200000001')).toBeInTheDocument());
    await user.type(screen.getByLabelText('من'), '6200000010');
    await user.type(screen.getByLabelText('إلى'), '6200000050');
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'مسح المدى' }));
    await waitFor(() => expect(screen.getByLabelText('من')).toHaveValue(''));
    expect(screen.getByLabelText('إلى')).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'مسح المدى' })).not.toBeInTheDocument();
    const lastUrl = onUrlUpdate.mock.calls.at(-1)?.[0] as UrlUpdate;
    expect(lastUrl.searchParams.has('serialFrom')).toBe(false);
    expect(lastUrl.searchParams.has('serialTo')).toBe(false);
  });

  describe('selection + CSV export', () => {
    it('row and header checkboxes: partial selection → indeterminate, all → checked', async () => {
      const user = userEvent.setup();
      renderList();
      await waitFor(() => expect(screen.getByText('6200000001')).toBeInTheDocument());
      const header = screen.getByLabelText('تحديد الكل') as HTMLInputElement;
      expect(header).not.toBeChecked();
      expect(header.indeterminate).toBe(false);

      await user.click(screen.getByLabelText('6200000001'));
      expect(screen.getByLabelText('6200000001')).toBeChecked();
      await waitFor(() =>
        expect((screen.getByLabelText('تحديد الكل') as HTMLInputElement).indeterminate).toBe(true),
      );

      await user.click(screen.getByLabelText('تحديد الكل'));
      await waitFor(() => expect(screen.getByLabelText('تحديد الكل')).toBeChecked());
      for (const s of ['1', '2', '3', '4', '5']) {
        expect(screen.getByLabelText(`620000000${s}`)).toBeChecked();
      }
    });

    it('selection toolbar is a11y-hidden (role query) until a row is selected', async () => {
      const user = userEvent.setup();
      renderList();
      await waitFor(() => expect(screen.getByText('6200000001')).toBeInTheDocument());
      // aria-hidden container → excluded from role queries
      expect(
        screen.queryByRole('button', { name: 'تصدير المحدد' }),
      ).not.toBeInTheDocument();

      await user.click(screen.getByLabelText('6200000001'));
      expect(
        await screen.findByRole('button', { name: 'تصدير المحدد' }),
      ).toBeInTheDocument();
      expect(screen.getByText('1 صف محدد')).toBeInTheDocument();
    });

    it('changing a filter clears the selection', async () => {
      const user = userEvent.setup();
      renderList();
      await waitFor(() => expect(screen.getByText('6200000001')).toBeInTheDocument());
      await user.click(screen.getByLabelText('6200000001'));
      await waitFor(() => expect(screen.getByText('1 صف محدد')).toBeInTheDocument());

      const yearSelect = screen
        .getAllByRole('combobox')
        .find((s) => s.innerHTML.includes('2025'));
      await user.selectOptions(yearSelect as HTMLElement, '2024');
      await waitFor(() =>
        expect(screen.getByLabelText('6200000001')).not.toBeChecked(),
      );
      expect(screen.queryByText('1 صف محدد')).not.toBeInTheDocument();
    });

    it('export dropdown: selected item disabled at 0, enabled with a count; Escape closes', async () => {
      const user = userEvent.setup();
      renderList();
      await waitFor(() => expect(screen.getByText('6200000001')).toBeInTheDocument());

      await user.click(screen.getByRole('button', { name: 'تصدير' }));
      const selectedItem = await screen.findByRole('menuitem', {
        name: 'تصدير المحدد (0)',
      });
      expect(selectedItem).toHaveAttribute('aria-disabled', 'true');
      expect(screen.getByRole('menuitem', { name: 'تصدير حسب الفلاتر' })).not.toHaveAttribute(
        'aria-disabled',
      );

      await user.keyboard('{Escape}');
      await waitFor(() =>
        expect(screen.queryByRole('menuitem', { name: 'تصدير حسب الفلاتر' })).not.toBeInTheDocument(),
      );

      // With a selection the item is enabled and carries the count.
      await user.click(screen.getByLabelText('6200000001'));
      await user.click(screen.getByRole('button', { name: 'تصدير' }));
      const withSelection = await screen.findByRole('menuitem', {
        name: 'تصدير المحدد (1)',
      });
      expect(withSelection).not.toHaveAttribute('aria-disabled');
      await user.keyboard('{Escape}');
    });

    it('exports selected rows: payload, saveBlob filename, success toast', async () => {
      const user = userEvent.setup();
      renderList();
      await waitFor(() => expect(screen.getByText('6200000001')).toBeInTheDocument());

      await user.click(screen.getByLabelText('6200000001'));
      await user.click(screen.getByLabelText('6200000002'));
      await user.click(await screen.findByRole('button', { name: 'تصدير المحدد' }));

      await waitFor(() =>
        expect(exportMock).toHaveBeenCalledWith({
          mode: 'selected',
          entryIds: ['e1', 'e2'],
        }),
      );
      expect(saveBlob).toHaveBeenCalledWith(
        expect.any(Blob),
        expect.stringMatching(/^entries-\d{4}-\d{2}-\d{2}\.csv$/),
      );
      expect(toast.success).toHaveBeenCalledWith('تم تصدير 2 صف');
    });

    it('exports filtered rows: payload carries filters without cursor/limit', async () => {
      const user = userEvent.setup();
      renderList();
      await waitFor(() => expect(screen.getByText('6200000001')).toBeInTheDocument());

      const yearSelect = screen
        .getAllByRole('combobox')
        .find((s) => s.innerHTML.includes('2025'));
      await user.selectOptions(yearSelect as HTMLElement, '2024');
      await waitFor(() =>
        expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ year: 2024 })),
      );

      await user.click(screen.getByRole('button', { name: 'تصدير' }));
      await user.click(
        await screen.findByRole('menuitem', { name: 'تصدير حسب الفلاتر' }),
      );

      await waitFor(() =>
        expect(exportMock).toHaveBeenCalledWith({
          mode: 'filtered',
          filters: { year: 2024 },
        }),
      );
      expect(toast.success).toHaveBeenCalledWith('تم تصدير السجلات المطابقة للفلاتر');
    });

    it('export failure shows the error toast', async () => {
      const user = userEvent.setup();
      exportMock.mockRejectedValue(new Error('boom'));
      renderList();
      await waitFor(() => expect(screen.getByText('6200000001')).toBeInTheDocument());

      await user.click(screen.getByLabelText('6200000001'));
      await user.click(await screen.findByRole('button', { name: 'تصدير المحدد' }));

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith('تعذر التصدير، حاول مرة أخرى'),
      );
      expect(saveBlob).not.toHaveBeenCalled();
    });
  });

  describe('ZIP bundle download', () => {
    it('dropdown shows "تنزيل الملفات (ZIP)" section with labels and lucide icons', async () => {
      const user = userEvent.setup();
      renderList();
      await waitFor(() => expect(screen.getByText('6200000001')).toBeInTheDocument());

      await user.click(screen.getByRole('button', { name: 'تصدير' }));
      expect(await screen.findByText('تصدير Excel (CSV)')).toBeInTheDocument();
      expect(screen.getByText('تنزيل الملفات (ZIP)')).toBeInTheDocument();
      expect(document.querySelector('.lucide-file-spreadsheet')).not.toBeNull();
      expect(document.querySelector('.lucide-package')).not.toBeNull();
      // Two items per section — CSV "تصدير …" vs ZIP "تنزيل …" names differ.
      expect(screen.getAllByRole('menuitem')).toHaveLength(4);
      expect(screen.getByRole('menuitem', { name: 'تصدير المحدد (0)' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'تصدير حسب الفلاتر' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'تنزيل المحدد (0)' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'تنزيل حسب الفلاتر' })).toBeInTheDocument();
      await user.keyboard('{Escape}');
    });

    it('تنزيل المحدد calls entriesApi.bundleDownload with mode=selected', async () => {
      const user = userEvent.setup();
      renderList();
      await waitFor(() => expect(screen.getByText('6200000001')).toBeInTheDocument());

      await user.click(screen.getByLabelText('6200000001'));
      await user.click(screen.getByLabelText('6200000002'));
      await user.click(screen.getByRole('button', { name: 'تصدير' }));
      await user.click(await screen.findByRole('menuitem', { name: 'تنزيل المحدد (2)' }));

      await waitFor(() =>
        expect(bundleMock).toHaveBeenCalledWith({
          mode: 'selected',
          entryIds: ['e1', 'e2'],
        }),
      );
      expect(exportMock).not.toHaveBeenCalled();
      expect(toast.loading).toHaveBeenCalledWith('جاري تجهيز الملفات...');
    });

    it('saveBlob receives a filename ending in .zip', async () => {
      const user = userEvent.setup();
      // The server sends entries-selected-{count}-{date}.zip via
      // Content-Disposition; fetchBlob exposes it as blob.filename.
      bundleMock.mockResolvedValue(
        Object.assign(new Blob(['PK'], { type: 'application/zip' }), {
          filename: 'entries-selected-1-2026-10-09.zip',
        }),
      );
      renderList();
      await waitFor(() => expect(screen.getByText('6200000001')).toBeInTheDocument());

      await user.click(screen.getByLabelText('6200000001'));
      await user.click(screen.getByRole('button', { name: 'تصدير' }));
      await user.click(await screen.findByRole('menuitem', { name: 'تنزيل المحدد (1)' }));

      await waitFor(() =>
        expect(saveBlob).toHaveBeenCalledWith(
          expect.any(Blob),
          expect.stringMatching(/\.zip$/),
        ),
      );
      expect(saveBlob.mock.calls[0][1]).toBe('entries-selected-1-2026-10-09.zip');
      const saved = saveBlob.mock.calls[0][0] as Blob;
      expect(saved.type).toBe('application/zip');
    });

    it('Success toast: "تم تنزيل N ملف"', async () => {
      const user = userEvent.setup();
      renderList();
      await waitFor(() => expect(screen.getByText('6200000001')).toBeInTheDocument());

      await user.click(screen.getByLabelText('6200000001'));
      await user.click(screen.getByLabelText('6200000002'));
      await user.click(screen.getByRole('button', { name: 'تصدير' }));
      await user.click(await screen.findByRole('menuitem', { name: 'تنزيل المحدد (2)' }));

      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith('تم تنزيل 2 ملف', {
          id: 'progress-toast',
        }),
      );
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('count === 1 → toast message is the singular form', async () => {
      const user = userEvent.setup();
      // Single matched entry comes back as the raw PDF (application/pdf),
      // with its {serial}.pdf filename from Content-Disposition.
      bundleMock.mockResolvedValue(
        Object.assign(new Blob(['%PDF'], { type: 'application/pdf' }), {
          filename: '6200000001.pdf',
        }),
      );
      renderList();
      await waitFor(() => expect(screen.getByText('6200000001')).toBeInTheDocument());

      await user.click(screen.getByLabelText('6200000001'));
      await user.click(screen.getByRole('button', { name: 'تصدير' }));
      await user.click(await screen.findByRole('menuitem', { name: 'تنزيل المحدد (1)' }));

      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith('تم تنزيل الملف', {
          id: 'progress-toast',
        }),
      );
      expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), '6200000001.pdf');
    });

    it('CSV export still works unchanged', async () => {
      const user = userEvent.setup();
      renderList();
      await waitFor(() => expect(screen.getByText('6200000001')).toBeInTheDocument());

      await user.click(screen.getByLabelText('6200000001'));
      await user.click(await screen.findByRole('button', { name: 'تصدير المحدد' }));

      await waitFor(() =>
        expect(exportMock).toHaveBeenCalledWith({
          mode: 'selected',
          entryIds: ['e1'],
        }),
      );
      expect(bundleMock).not.toHaveBeenCalled();
      expect(saveBlob).toHaveBeenCalledWith(
        expect.any(Blob),
        expect.stringMatching(/^entries-\d{4}-\d{2}-\d{2}\.csv$/),
      );
      expect(toast.success).toHaveBeenCalledWith('تم تصدير 1 صف');
      expect(toast.loading).not.toHaveBeenCalled();
    });
  });
});
