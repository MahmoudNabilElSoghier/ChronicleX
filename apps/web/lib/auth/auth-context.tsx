'use client';

import { useRouter } from '@/lib/navigation';
import * as React from 'react';
import type { CurrentUser } from '@chroniclex/shared';
import { api } from '@/lib/api/client';
import { authApi } from '@/lib/api/endpoints';

interface AuthState {
  user: CurrentUser | null;
  status: 'loading' | 'authenticated' | 'unauthenticated';
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = React.createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [user, setUser] = React.useState<CurrentUser | null>(null);
  const [status, setStatus] = React.useState<AuthState['status']>('loading');

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/$/, '')}/auth/refresh`,
          { method: 'POST', credentials: 'include' },
        );
        if (!res.ok) throw new Error('no session');
        const body = (await res.json()) as { accessToken: string };
        api.setAccessToken(body.accessToken);
        const me = await authApi.me();
        if (!cancelled) {
          setUser(me);
          setStatus('authenticated');
        }
      } catch {
        if (!cancelled) {
          api.setAccessToken(null);
          setStatus('unauthenticated');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = React.useCallback(async (email: string, password: string): Promise<void> => {
    const result = await authApi.login(email, password);
    api.setAccessToken(result.accessToken);
    const me = await authApi.me();
    setUser(me);
    setStatus('authenticated');
  }, []);

  const logout = React.useCallback(async (): Promise<void> => {
    try {
      await authApi.logout();
    } catch {
      // Server-side session already gone — clear local state regardless.
    }
    api.setAccessToken(null);
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  const value = React.useMemo(() => ({ user, status, login, logout }), [user, status, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function useRequireAuth(): CurrentUser | null {
  const router = useRouter();
  const { user, status } = useAuth();
  React.useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    }
  }, [status, router]);
  return status === 'authenticated' ? user : null;
}
