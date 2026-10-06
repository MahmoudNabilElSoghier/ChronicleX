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
    entriesApi: { list: vi.fn(), download: vi.fn() },
    catalogApi: {
      companies: vi.fn().mockResolvedValue({ items: [] }),
      projects: vi.fn().mockResolvedValue({ items: [] }),
      years: vi.fn().mockResolvedValue({ years: [2025, 2024] }),
    },
  };
});

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({ user: null, status: 'unauthenticated', login: vi.fn(), logout: vi.fn() }),
  useRequireAuth: () => null,
}));

import { entriesApi } from '@/lib/api/entries';

const listMock = vi.mocked(entriesApi.list);

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
});
