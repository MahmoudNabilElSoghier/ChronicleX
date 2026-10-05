import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AuthProvider, useAuth } from '@/lib/auth/auth-context';
import { api } from '@/lib/api/client';

function Probe(): JSX.Element {
  const { status, user } = useAuth();
  return <p data-testid="probe">{`${status}:${user?.email ?? 'none'}`}</p>;
}

describe('AuthProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    api.setAccessToken(null);
  });

  it('refresh success leads to authenticated', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/auth/refresh')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ accessToken: 'new.token' }),
        });
      }
      if (url.endsWith('/auth/me')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 'u1',
              email: 'a@b.c',
              nameAr: 'ن',
              nameEn: 'N',
              isActive: true,
              roles: [],
            }),
        });
      }
      throw new Error(`unexpected ${url}`);
    });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('authenticated:a@b.c'));
    expect(api.getAccessToken()).toBe('new.token');
  });

  it('refresh failure leads to unauthenticated', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('down'));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('unauthenticated:none'));
  });
});
