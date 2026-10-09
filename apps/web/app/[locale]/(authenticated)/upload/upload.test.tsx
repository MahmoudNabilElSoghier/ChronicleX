import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ar from '@/messages/ar.json';
import UploadPage from '@/app/[locale]/(authenticated)/upload/page';
import { uploadApi, type EntryDetail } from '@/lib/api/entries';
import { ActiveJobsProvider, useActiveJobs } from '@/lib/upload/active-jobs-context';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/lib/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/upload',
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
    uploadApi: {
      single: vi.fn(),
      bulk: vi.fn(),
      bulkStatus: vi.fn(),
      bulkCancel: vi.fn(),
      preview: vi.fn(),
    },
    entriesApi: {
      get: vi.fn(),
    },
    catalogApi: {
      companies: vi.fn().mockResolvedValue({
        items: [{ id: 'c1', code: 2000, nameAr: 'الشركة', nameEn: 'Co' }],
      }),
      projects: vi.fn().mockResolvedValue({
        items: [{ id: 'p1', code: 'R', nameAr: 'الرحاب', nameEn: 'Rehab', companyId: 'c1' }],
      }),
      years: vi.fn().mockResolvedValue({ years: [2025] }),
    },
  };
});

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({ user: null, status: 'unauthenticated', login: vi.fn(), logout: vi.fn() }),
  useRequireAuth: () => null,
}));

vi.mock('@/lib/api/settings', () => ({
  settingsApi: {
    getEntryPrefixes: vi.fn().mockResolvedValue({ prefixes: ['62', '63', '67'] }),
    updateEntryPrefixes: vi.fn(),
  },
  entryPrefixesQueryKey: ['settings', 'entry-prefixes'],
  fetchEntryPrefixes: vi.fn().mockResolvedValue(['62', '63', '67']),
}));

const singleMock = vi.mocked(uploadApi.single);
const bulkMock = vi.mocked(uploadApi.bulk);

function pdf(name: string): File {
  return new File(['%PDF'], name, { type: 'application/pdf' });
}

function entryDetail(id: string): EntryDetail {
  return {
    id,
    serial: '6200000000',
    typePrefix: '62',
    year: 2025,
    companyId: 'c1',
    projectId: 'p1',
    company: { code: 2000, nameAr: 'Co', nameEn: 'Co' },
    project: { code: 'REHAB', nameAr: 'Rehab', nameEn: 'Rehab' },
    fileName: '6200000000.pdf',
    fileSize: 4,
    createdAt: '2025-03-01T10:00:00.000Z',
    deletedAt: null,
    uploadedBy: { id: 'u1', nameAr: 'Admin' },
    counter: 0,
    mimeType: 'application/pdf',
    fileHash: 'abc123',
  };
}

function renderUpload(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <NuqsTestingAdapter hasMemory>
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="ar" messages={ar}>
          <UploadPage />
        </NextIntlClientProvider>
      </QueryClientProvider>
    </NuqsTestingAdapter>,
  );
}

/** The visible tab panel — hidden panels are aria-hidden → excluded by role queries. */
function activePanel(): HTMLElement {
  return screen.getByRole('tabpanel');
}

function activeFileInput(): HTMLInputElement {
  const input = activePanel().querySelector('input[type="file"]');
  if (!input) throw new Error('no file input in the active tab panel');
  return input as HTMLInputElement;
}

async function chooseFiles(files: File[]): Promise<void> {
  fireEvent.change(activeFileInput(), { target: { files } });
}

function renderUploadWithBadge(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <NuqsTestingAdapter hasMemory>
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="ar" messages={ar}>
          <ActiveJobsProvider>
            <BadgeProbe />
            <UploadPage />
          </ActiveJobsProvider>
        </NextIntlClientProvider>
      </QueryClientProvider>
    </NuqsTestingAdapter>,
  );
}

/** Stand-in for the sidebar Upload badge (reads the same context). */
function BadgeProbe(): JSX.Element {
  const activeJobs = useActiveJobs();
  return (
    <div>
      <span data-testid="active-badge">{activeJobs?.jobs.length ?? 0}</span>
      <button type="button" onClick={() => activeJobs?.track('job-1')}>
        track
      </button>
    </div>
  );
}

async function fillScope(): Promise<void> {
  await waitFor(() =>
    expect(
      (screen.getAllByRole('combobox')[0] as HTMLSelectElement).innerHTML.includes('value="c1"'),
    ).toBe(true),
  );
  const selects = screen.getAllByRole('combobox');
  const company = selects.find((s) => (s as HTMLSelectElement).innerHTML.includes('value="c1"'));
  fireEvent.change(company as HTMLElement, { target: { value: 'c1' } });
  await waitFor(() =>
    expect(
      (screen.getAllByRole('combobox')[1] as HTMLSelectElement).innerHTML.includes('الرحاب'),
    ).toBe(true),
  );
  fireEvent.change(screen.getAllByRole('combobox')[1] as HTMLElement, { target: { value: 'p1' } });
  fireEvent.change(screen.getByPlaceholderText(String(new Date().getFullYear())), {
    target: { value: '2025' },
  });
}

describe('UploadPage single tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('valid file enables submit; success shows the entry link', async () => {
    singleMock.mockResolvedValue(entryDetail('e1'));
    const { uploadApi: api } = await import('@/lib/api/entries');
    vi.mocked(api.preview).mockResolvedValue({ results: [{ index: 0, status: 'ok' }] });
    renderUpload();
    await chooseFiles([pdf('6200000000.pdf')]);
    // parse ok but scope missing → the badge reflects the check machine
    await waitFor(() =>
      expect(screen.getByText('بانتظار اختيار النطاق')).toBeInTheDocument(),
    );
    await fillScope();
    await waitFor(() => expect(screen.getByText(/ملف صالح/)).toBeInTheDocument(), {
      timeout: 3000,
    });
    const submit = screen.getByRole('button', { name: /رفع القيد/ });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(singleMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(/تم رفع القيد بنجاح/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /عرض القيد/ })).toBeInTheDocument();
  });

  it('invalid filename shows the specific error and blocks submit', async () => {
    renderUpload();
    await chooseFiles([pdf('9900000000.pdf')]);
    await waitFor(() => expect(screen.getByText(/بادئة غير مسموحة/)).toBeInTheDocument());
    await fillScope();
    expect(screen.getByRole('button', { name: /رفع القيد/ })).toBeDisabled();
    expect(singleMock).not.toHaveBeenCalled();
  });

  it('duplicate serial shows conflict card with existing-entry link', async () => {
    const { ApiError } = await import('@/lib/api/client');
    singleMock.mockRejectedValue(
      new ApiError(409, 'DUPLICATE_SERIAL', 'Serial already exists', { existingEntryId: 'e9' }),
    );
    const { entriesApi: fullApi, uploadApi: api } = await import('@/lib/api/entries');
    vi.mocked(api.preview).mockResolvedValue({ results: [{ index: 0, status: 'ok' }] });
    vi.mocked(fullApi.get).mockResolvedValue({
      ...entryDetail('e9'),
      company: { code: 2000, nameAr: 'الشركة', nameEn: 'Co' },
      project: { code: 'REHAB', nameAr: 'الرحاب', nameEn: 'Rehab' },
      uploadedBy: { id: 'u1', nameAr: 'مدير' },
    });
    renderUpload();
    await chooseFiles([pdf('6200000000.pdf')]);
    await waitFor(() =>
      expect(screen.getByText('بانتظار اختيار النطاق')).toBeInTheDocument(),
    );
    await fillScope();
    await waitFor(() => expect(screen.getByText(/ملف صالح/)).toBeInTheDocument(), {
      timeout: 3000,
    });
    fireEvent.click(screen.getByRole('button', { name: /رفع القيد/ }));
    // the reason now appears twice: in the status badge and in the legacy
    // conflict card (which is the no-summary fallback)
    await waitFor(() =>
      expect(screen.getAllByText(/الرقم التسلسلي مستخدم بالفعل/).length).toBeGreaterThan(0),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /عرض القيد الموجود/ })).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /رفع القيد/ })).toBeDisabled();
  });

  it('preview ok → valid badge shown and upload enabled', async () => {
    const { uploadApi: api } = await import('@/lib/api/entries');
    vi.mocked(api.preview).mockResolvedValue({ results: [{ index: 0, status: 'ok' }] });
    renderUpload();
    await chooseFiles([pdf('6200000000.pdf')]);
    await fillScope();
    await waitFor(() => expect(screen.getByText('✓ ملف صالح')).toBeInTheDocument(), {
      timeout: 3000,
    });
    expect(screen.getByRole('button', { name: /رفع القيد/ })).toBeEnabled();
  });

  it('preview duplicate_hash → already-uploaded badge, DuplicateDetails visible, upload disabled', async () => {
    const { uploadApi: api } = await import('@/lib/api/entries');
    vi.mocked(api.preview).mockResolvedValue({
      results: [
        {
          index: 0,
          status: 'duplicate_hash',
          existingEntryId: 'e9',
          existing: {
            serial: '6200000000',
            year: 2026,
            company: { nameAr: 'شركة الاسكندرية', nameEn: 'Alexandria', code: 9205 },
            project: { nameAr: 'سان ستيفانو العقارية', nameEn: 'San Stefano', code: 'SSRE' },
            uploadedBy: { nameAr: 'مدير النظام', nameEn: 'System Administrator' },
            createdAt: '2025-03-01T10:00:00.000Z',
          },
        },
      ],
    });
    renderUpload();
    await chooseFiles([pdf('6200000000.pdf')]);
    await fillScope();
    await waitFor(
      () => expect(screen.getByText(/هذا الملف مرفوع بالفعل/)).toBeInTheDocument(),
      { timeout: 3000 },
    );
    // the green "valid" badge must be gone — never two contradictory states
    expect(screen.queryByText(/ملف صالح/)).not.toBeInTheDocument();
    expect(screen.getByText('الملف مرفوع قبل كده')).toBeInTheDocument();
    expect(screen.getByText(/القيد الأصلي: 6200000000/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /رفع القيد/ })).toBeDisabled();
  });

  it('preview in flight → checking badge and upload disabled', async () => {
    const { uploadApi: api } = await import('@/lib/api/entries');
    vi.mocked(api.preview).mockImplementation(() => new Promise<never>(() => {}));
    renderUpload();
    await chooseFiles([pdf('6200000000.pdf')]);
    await fillScope();
    expect(screen.getByText('جاري التحقق من التكرار...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /رفع القيد/ })).toBeDisabled();
  });

  it('preview request fails → deferred badge and upload enabled', async () => {
    const { uploadApi: api } = await import('@/lib/api/entries');
    vi.mocked(api.preview).mockRejectedValue(new Error('network down'));
    renderUpload();
    await chooseFiles([pdf('6200000000.pdf')]);
    await fillScope();
    await waitFor(() => expect(screen.getByText('يتم التحقق عند الرفع')).toBeInTheDocument(), {
      timeout: 3000,
    });
    expect(screen.getByRole('button', { name: /رفع القيد/ })).toBeEnabled();
  });

  it('file + scope survive switching to the bulk tab and back', async () => {
    const { uploadApi: api } = await import('@/lib/api/entries');
    vi.mocked(api.preview).mockResolvedValue({ results: [{ index: 0, status: 'ok' }] });
    renderUpload();
    await chooseFiles([pdf('6200000000.pdf')]);
    await fillScope();
    await waitFor(() => expect(screen.getByText('✓ ملف صالح')).toBeInTheDocument(), {
      timeout: 3000,
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /رفع متعدد/ }));
    // still mounted (state survives) but hidden from view + assistive tech
    expect(screen.getByText('6200000000.pdf')).toBeInTheDocument();
    const hiddenPanel = screen.getByText('6200000000.pdf').closest('[role="tabpanel"]');
    expect(hiddenPanel).toHaveAttribute('aria-hidden', 'true');
    expect(hiddenPanel).toHaveAttribute('inert');

    await user.click(screen.getByRole('tab', { name: /قيد واحد/ }));
    // file and scope come back from page state, no re-selection needed
    expect(screen.getByText('6200000000.pdf')).toBeInTheDocument();
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    expect(selects[0]?.value).toBe('c1');
    expect(selects[1]?.value).toBe('p1');
    expect(
      (screen.getByPlaceholderText(String(new Date().getFullYear())) as HTMLInputElement).value,
    ).toBe('2025');
    // the check machine re-runs the preview and converges back
    await waitFor(() => expect(screen.getByText('✓ ملف صالح')).toBeInTheDocument(), {
      timeout: 3000,
    });
    expect(screen.getByRole('button', { name: /رفع القيد/ })).toBeEnabled();
  });

  it('reload clears the single tab — nothing is persisted to sessionStorage', async () => {
    const { uploadApi: api } = await import('@/lib/api/entries');
    vi.mocked(api.preview).mockResolvedValue({ results: [{ index: 0, status: 'ok' }] });
    renderUpload();
    await chooseFiles([pdf('6200000000.pdf')]);
    await fillScope();
    await waitFor(() => expect(screen.getByText('✓ ملف صالح')).toBeInTheDocument(), {
      timeout: 3000,
    });

    // simulate a reload: unmount everything, then mount a fresh page
    cleanup();
    expect(sessionStorage.length).toBe(0);
    renderUpload();
    expect(screen.queryByText('6200000000.pdf')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
  });

  it('Remove clears the file in both the queue and the page state', async () => {
    const { uploadApi: api } = await import('@/lib/api/entries');
    vi.mocked(api.preview).mockResolvedValue({ results: [{ index: 0, status: 'ok' }] });
    renderUpload();
    await chooseFiles([pdf('6200000000.pdf')]);
    await fillScope();
    await waitFor(() => expect(screen.getByText('✓ ملف صالح')).toBeInTheDocument(), {
      timeout: 3000,
    });

    fireEvent.click(screen.getByRole('button', { name: 'إزالة' }));
    await waitFor(() =>
      expect(screen.queryByText('6200000000.pdf')).not.toBeInTheDocument(),
    );
    // if page state still held the file, a tab round-trip would resurrect it
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /رفع متعدد/ }));
    await user.click(screen.getByRole('tab', { name: /قيد واحد/ }));
    expect(screen.queryByText('6200000000.pdf')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
  });
});

describe('UploadPage bulk tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('2 valid + 1 invalid: submit enabled, only valid files sent', async () => {
    bulkMock.mockResolvedValue({
      jobId: 'job1', status: 'processing', total: 2, immediateFailures: 0, statusUrl: '/x',
    });
    const { uploadApi: api } = await import('@/lib/api/entries');
    vi.mocked(api.bulkStatus).mockResolvedValue({
      jobId: 'job1', status: 'done', total: 2, processed: 2, succeeded: 2, failed: 0,
      createdAt: new Date().toISOString(), results: [], resultsTruncated: false,
    });
    renderUpload();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /رفع متعدد/ }));
    await waitFor(() => expect(activeFileInput()).toBeInTheDocument());
    const input = activeFileInput();
    fireEvent.change(input, { target: { files: [pdf('6200000000.pdf'), pdf('bad.pdf'), pdf('6300000001.pdf')] } });
    await waitFor(() =>
      expect(screen.getByText(/0 صالح، 1 خطأ، 2 بانتظار التحقق/)).toBeInTheDocument(),
    );
    await fillScope();
    const submit = screen.getByRole('button', { name: /رفع الكل/ });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(bulkMock).toHaveBeenCalledTimes(1));
    const formData = bulkMock.mock.calls[0]?.[0] as FormData;
    expect(formData.getAll('files')).toHaveLength(2);
  });

  it('restored batch after reload: results shown, view existing opens in a new tab', async () => {
    const { uploadApi: api } = await import('@/lib/api/entries');
    vi.mocked(api.bulkStatus).mockResolvedValue({
      jobId: 'job1', status: 'done', total: 1, processed: 1, succeeded: 0, failed: 1,
      createdAt: new Date().toISOString(),
      results: [{
        fileUuid: 'f1',
        originalName: '6200000000.pdf',
        status: 'error',
        errorCode: 'DUPLICATE_SERIAL',
        errorMessage: 'Serial already exists',
        existingEntryId: 'e9',
      }],
      resultsTruncated: false,
    });
    sessionStorage.setItem(
      'bulk-upload:last',
      JSON.stringify({ jobId: 'job1', companyId: 'c1', projectId: 'p1', year: 2025 }),
    );
    renderUpload();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /رفع متعدد/ }));

    await waitFor(() => expect(screen.getByText(/6200000000\.pdf/)).toBeInTheDocument());
    const link = screen.getByRole('link', { name: /عرض القيد الموجود/ });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('href', '/ar/entries/e9');
    await waitFor(() => expect(screen.getByText(/تم رفع 0 من 1/)).toBeInTheDocument());
    expect(screen.getByText(/يمكنك بدء دفعة جديدة/)).toBeInTheDocument();

    // "Start new batch" clears the queue AND the persisted key.
    fireEvent.click(screen.getByRole('button', { name: /بدء دفعة جديدة/ }));
    await waitFor(() => expect(activeFileInput()).toBeInTheDocument());
    expect(sessionStorage.getItem('bulk-upload:last')).toBeNull();
  });

  it('25 files: skips hashing and preview; shows the large-batch note', async () => {
    const digestMock = vi.fn().mockResolvedValue(new ArrayBuffer(32));
    Object.defineProperty(globalThis.crypto, 'subtle', {
      configurable: true,
      value: { digest: digestMock },
    });
    const { uploadApi: api } = await import('@/lib/api/entries');
    const files = Array.from(
      { length: 25 },
      (_, i) => pdf(`62${String(i).padStart(8, '0')}.pdf`),
    );
    renderUpload();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /رفع متعدد/ }));
    await waitFor(() => expect(activeFileInput()).toBeInTheDocument());
    const input = activeFileInput();
    fireEvent.change(input, { target: { files } });
    await waitFor(() =>
      expect(screen.getByText(/0 صالح، 0 خطأ، 25 بانتظار التحقق/)).toBeInTheDocument(),
    );
    await fillScope();

    await waitFor(() =>
      expect(screen.getByText(/دفعات ≤ 20 ملف/)).toBeInTheDocument(),
    );
    expect(screen.getAllByText('يتم التحقق عند الرفع')).toHaveLength(25);
    expect(screen.queryByText('جاري التحقق...')).not.toBeInTheDocument();

    // give a (never-scheduled) debounced preview time to prove it absent
    await new Promise((r) => setTimeout(r, 600));
    expect(vi.mocked(api.preview)).not.toHaveBeenCalled();
    expect(digestMock).not.toHaveBeenCalled();

    // submit still works — server validates the batch post-upload
    const bulkLocal = vi.mocked(api.bulk);
    bulkLocal.mockResolvedValue({
      jobId: 'job9', status: 'processing', total: 25, immediateFailures: 0, statusUrl: '/x',
    });
    vi.mocked(api.bulkStatus).mockResolvedValue({
      jobId: 'job9', status: 'done', total: 25, processed: 25, succeeded: 25, failed: 0,
      createdAt: new Date().toISOString(), results: [], resultsTruncated: false,
    });
    fireEvent.click(screen.getByRole('button', { name: /رفع الكل/ }));
    await waitFor(() => expect(bulkLocal).toHaveBeenCalledTimes(1));
    expect((bulkLocal.mock.calls[0]?.[0] as FormData).getAll('files')).toHaveLength(25);
  });

  it('summary reflects preview results: 2 duplicates + 1 new → "1 صالح، 2 خطأ"', async () => {
    const { uploadApi: api } = await import('@/lib/api/entries');
    vi.mocked(api.preview).mockResolvedValue({
      results: [
        { index: 0, status: 'ok' },
        { index: 1, status: 'duplicate_hash', existingEntryId: 'e9' },
        { index: 2, status: 'duplicate_hash', existingEntryId: 'e9' },
      ],
    });
    renderUpload();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /رفع متعدد/ }));
    await waitFor(() => expect(activeFileInput()).toBeInTheDocument());
    const input = activeFileInput();
    fireEvent.change(input, {
      target: { files: [pdf('6200000000.pdf'), pdf('6200000001.pdf'), pdf('6300000002.pdf')] },
    });
    await fillScope();

    await waitFor(() => expect(screen.getByText('1 صالح، 2 خطأ')).toBeInTheDocument(), {
      timeout: 3000,
    });
    // pending portion hidden at zero, rows agree with the counts
    expect(screen.queryByText(/بانتظار التحقق/)).not.toBeInTheDocument();
    expect(screen.getAllByText('هذا الملف مرفوع بالفعل')).toHaveLength(2);
    // legacy path: no enriched summary in the response → no details block
    expect(screen.queryByText('الملف مرفوع قبل كده')).not.toBeInTheDocument();
  });

  it('duplicate row shows original entry details and opens the link in a new tab', async () => {
    const { uploadApi: api } = await import('@/lib/api/entries');
    vi.mocked(api.preview).mockResolvedValue({
      results: [
        {
          index: 0,
          status: 'duplicate_serial',
          existingEntryId: 'e9',
          existing: {
            serial: '6200000000',
            year: 2025,
            company: { nameAr: 'شركة الاسكندرية', nameEn: 'Alexandria', code: 9205 },
            project: { nameAr: 'سان ستيفانو العقارية', nameEn: 'San Stefano', code: 'SSRE' },
            uploadedBy: { nameAr: 'مدير النظام', nameEn: 'System Administrator' },
            createdAt: '2025-03-01T10:00:00.000Z',
          },
        },
      ],
    });
    renderUpload();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /رفع متعدد/ }));
    await waitFor(() => expect(activeFileInput()).toBeInTheDocument());
    const input = activeFileInput();
    fireEvent.change(input, { target: { files: [pdf('6200000000.pdf')] } });
    await fillScope();

    await waitFor(() => expect(screen.getByText('الملف مرفوع قبل كده')).toBeInTheDocument(), {
      timeout: 3000,
    });
    expect(screen.getByText(/القيد الأصلي: 6200000000/)).toBeInTheDocument();
    expect(screen.getByText(/الشركة: شركة الاسكندرية/)).toBeInTheDocument();
    expect(screen.getByText(/المشروع: سان ستيفانو العقارية/)).toBeInTheDocument();
    expect(screen.getByText(/مرفوع بواسطة: مدير النظام/)).toBeInTheDocument();
    // the plain reason badge is replaced by the details block
    expect(screen.queryByText('الرقم التسلسلي مستخدم بالفعل')).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'عرض القيد الأصلي' });
    expect(link).toHaveAttribute('href', '/ar/entries/e9');
    expect(link).toHaveAttribute('target', '_blank');
  });
});

describe('UploadPage tab persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('bulk queue (files + scope + check states) survives switching to the single tab and back', async () => {
    const { uploadApi: api } = await import('@/lib/api/entries');
    vi.mocked(api.preview).mockResolvedValue({
      results: [{ index: 0, status: 'ok' }, { index: 1, status: 'ok' }, { index: 2, status: 'ok' }],
    });
    renderUpload();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /رفع متعدد/ }));
    await waitFor(() => expect(activeFileInput()).toBeInTheDocument());
    fireEvent.change(activeFileInput(), {
      target: { files: [pdf('6200000000.pdf'), pdf('bad.pdf'), pdf('6300000001.pdf')] },
    });
    await fillScope();
    await waitFor(() => expect(screen.getByText('2 صالح، 1 خطأ')).toBeInTheDocument(), {
      timeout: 3000,
    });

    await user.click(screen.getByRole('tab', { name: /قيد واحد/ }));
    await user.click(screen.getByRole('tab', { name: /رفع متعدد/ }));

    // same files, same check results, same scope — nothing was destroyed
    expect(screen.getByText('6200000000.pdf')).toBeInTheDocument();
    expect(screen.getByText('bad.pdf')).toBeInTheDocument();
    expect(screen.getByText('6300000001.pdf')).toBeInTheDocument();
    expect(screen.getByText('2 صالح، 1 خطأ')).toBeInTheDocument();
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    expect(selects[0]?.value).toBe('c1');
    expect(selects[1]?.value).toBe('p1');
    expect(
      (screen.getByPlaceholderText(String(new Date().getFullYear())) as HTMLInputElement).value,
    ).toBe('2025');
    // the round-trip did not re-trigger a preview (no remount → effect deps unchanged)
    expect(api.preview).toHaveBeenCalledTimes(1);
  });

  it('hidden tabs fire no preview while empty; a hidden tab with files still checks', async () => {
    const { uploadApi: api } = await import('@/lib/api/entries');
    vi.mocked(api.preview).mockResolvedValue({ results: [{ index: 0, status: 'ok' }] });
    renderUpload();
    // both tabs are mounted from the start, neither has files → nothing fires
    await new Promise((r) => setTimeout(r, 600));
    expect(api.preview).not.toHaveBeenCalled();

    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /رفع متعدد/ }));
    fireEvent.change(activeFileInput(), { target: { files: [pdf('6200000000.pdf')] } });
    await fillScope();
    // leave before the 400ms debounce lands — the hidden panel still converges
    await user.click(screen.getByRole('tab', { name: /قيد واحد/ }));
    await new Promise((r) => setTimeout(r, 600));
    // exactly one call: bulk (hidden) checked, single (visible, empty) stayed silent
    expect(api.preview).toHaveBeenCalledTimes(1);
  });

  it('sidebar badge count does not change on tab switch', async () => {
    const { uploadApi: api } = await import('@/lib/api/entries');
    vi.mocked(api.bulkStatus).mockResolvedValue({
      jobId: 'job-1',
      status: 'processing',
      total: 1,
      processed: 0,
      succeeded: 0,
      failed: 0,
      createdAt: new Date().toISOString(),
      results: [],
      resultsTruncated: false,
    });
    renderUploadWithBadge();
    fireEvent.click(screen.getByRole('button', { name: 'track' }));
    await waitFor(() => expect(screen.getByTestId('active-badge')).toHaveTextContent('1'));

    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /رفع متعدد/ }));
    expect(screen.getByTestId('active-badge')).toHaveTextContent('1');
    await user.click(screen.getByRole('tab', { name: /قيد واحد/ }));
    expect(screen.getByTestId('active-badge')).toHaveTextContent('1');
  });
});
