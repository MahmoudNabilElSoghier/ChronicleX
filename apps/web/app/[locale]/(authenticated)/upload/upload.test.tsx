import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ar from '@/messages/ar.json';
import UploadPage from '@/app/[locale]/(authenticated)/upload/page';
import { uploadApi } from '@/lib/api/entries';

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

const singleMock = vi.mocked(uploadApi.single);
const bulkMock = vi.mocked(uploadApi.bulk);

function pdf(name: string): File {
  return new File(['%PDF'], name, { type: 'application/pdf' });
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

async function chooseFiles(files: File[]): Promise<void> {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
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
  });

  it('valid file enables submit; success shows the entry link', async () => {
    singleMock.mockResolvedValue({ id: 'e1' });
    renderUpload();
    await chooseFiles([pdf('6200000000.pdf')]);
    await waitFor(() => expect(screen.getByText(/ملف صالح/)).toBeInTheDocument());
    await fillScope();
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
    const { entriesApi: fullApi } = await import('@/lib/api/entries');
    vi.mocked(fullApi.get).mockResolvedValue({
      id: 'e9',
      serial: '6200000000',
      company: { nameAr: 'الشركة' },
      project: { nameAr: 'الرحاب' },
      year: 2025,
      uploadedBy: { nameAr: 'مدير' },
    });
    renderUpload();
    await chooseFiles([pdf('6200000000.pdf')]);
    await waitFor(() => expect(screen.getByText(/ملف صالح/)).toBeInTheDocument());
    await fillScope();
    fireEvent.click(screen.getByRole('button', { name: /رفع القيد/ }));
    await waitFor(() =>
      expect(screen.getByText(/الرقم التسلسلي مستخدم بالفعل/)).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /عرض القيد الموجود/ })).toBeInTheDocument(),
    );
  });
});

describe('UploadPage bulk tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    await waitFor(() =>
      expect(document.querySelectorAll('input[type="file"]')).toHaveLength(1),
    );
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pdf('6200000000.pdf'), pdf('bad.pdf'), pdf('6300000001.pdf')] } });
    await waitFor(() => expect(screen.getByText(/2 صالح، 1 خطأ/)).toBeInTheDocument());
    await fillScope();
    const submit = screen.getByRole('button', { name: /رفع الكل/ });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(bulkMock).toHaveBeenCalledTimes(1));
    const formData = bulkMock.mock.calls[0]?.[0] as FormData;
    expect(formData.getAll('files')).toHaveLength(2);
  });
});
