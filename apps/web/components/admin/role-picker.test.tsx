import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '@chroniclex/shared';
import ar from '@/messages/ar.json';
import { RolePicker } from '@/components/admin/role-picker';
import { adminApi } from '@/lib/api/admin';

vi.mock('@/lib/api/admin', () => ({
  adminApi: {
    users: {},
    roles: { list: vi.fn() },
    audit: {},
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

const rolesMock = vi.mocked(adminApi.roles.list);

function callerWith(roles: CurrentUser['roles']): CurrentUser {
  return {
    id: 'x', email: 'x@y.z', nameAr: 'س', nameEn: 'X', isActive: true, roles,
  };
}

function renderPicker(
  caller: CurrentUser,
  scopeType: 'GROUP' | 'COMPANY' = 'GROUP',
  scopeId = '',
): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="ar" messages={ar}>
        <RolePicker
          caller={caller}
          targetUserId="someone-else"
          value={{ roleId: '', scopeType, scopeId }}
          onChange={() => undefined}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

function options(): string[] {
  return Array.from((screen.getByLabelText(/الدور/) as HTMLSelectElement).options).map(
    (o) => o.text,
  );
}

describe('RolePicker grantability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rolesMock.mockResolvedValue({
      items: [
        { id: 'rs', name: 'SUPER_ADMIN', description: null },
        { id: 'rc', name: 'COMPANY_ADMIN', description: null },
        { id: 'ra', name: 'ARCHIVIST', description: null },
      ],
    });
  });

  it('SUPER_ADMIN at GROUP sees every role for GROUP scope', async () => {
    renderPicker(
      callerWith([{ name: 'SUPER_ADMIN', scopeType: 'GROUP', scopeId: '' }]),
    );
    await waitFor(() => expect(options()).toContain('SUPER_ADMIN'));
    expect(options()).toContain('ARCHIVIST');
  });

  it('COMPANY_ADMIN sees grantable roles for their company, nothing for GROUP', async () => {
    renderPicker(
      callerWith([{ name: 'COMPANY_ADMIN', scopeType: 'COMPANY', scopeId: 'c1' }]),
      'COMPANY',
      'c1',
    );
    await waitFor(() => expect(options()).toContain('ARCHIVIST'));
  });

  it('COMPANY_ADMIN sees zero roles for GROUP scope', async () => {
    renderPicker(
      callerWith([{ name: 'COMPANY_ADMIN', scopeType: 'COMPANY', scopeId: 'c1' }]),
      'GROUP',
    );
    await waitFor(() => expect(rolesMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        Array.from((screen.getByLabelText(/الدور/) as HTMLSelectElement).options),
      ).toHaveLength(1),
    );
  });
});
