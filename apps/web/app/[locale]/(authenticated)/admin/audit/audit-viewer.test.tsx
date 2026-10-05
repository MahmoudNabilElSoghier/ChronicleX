import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ar from '@/messages/ar.json';
import AuditViewerPage from '@/app/[locale]/(authenticated)/admin/audit/page';
import { adminApi } from '@/lib/api/admin';
import { ApiError } from '@/lib/api/client';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/lib/api/admin', () => ({
  adminApi: {
    users: {},
    roles: {},
    audit: { list: vi.fn() },
  },
}));

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({ user: null, status: 'unauthenticated', login: vi.fn(), logout: vi.fn() }),
  useRequireAuth: () => null,
}));

const listMock = vi.mocked(adminApi.audit.list);

function renderAudit(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <NuqsTestingAdapter hasMemory>
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="ar" messages={ar}>
          <AuditViewerPage />
        </NextIntlClientProvider>
      </QueryClientProvider>
    </NuqsTestingAdapter>,
  );
}

const row = (id: string) => ({
  id,
  action: 'CREATE',
  resource: 'ENTRY',
  userId: 'u1',
  resourceId: 'e1',
  oldValues: null,
  newValues: { event: 'x' },
  ipAddress: null,
  userAgent: null,
  createdAt: '2025-01-01T00:00:00.000Z',
});

describe('AuditViewerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('403 shows the coming-soon card', async () => {
    listMock.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'nope'));
    renderAudit();
    await waitFor(() =>
      expect(screen.getByText(/العرض الكامل قريباً/)).toBeInTheDocument(),
    );
  });

  it('200 renders table rows', async () => {
    listMock.mockResolvedValue({
      items: [row('a1'), row('a2'), row('a3'), row('a4'), row('a5')],
      nextCursor: null,
      hasMore: false,
    });
    renderAudit();
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText('CREATE').length).toBeGreaterThanOrEqual(5));
  });
});
