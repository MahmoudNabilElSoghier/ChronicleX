'use client';

import { Loader2 } from 'lucide-react';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { useRequireAuth } from '@/lib/auth/auth-context';
import { ActiveJobsProvider } from '@/lib/upload/active-jobs-context';

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }): JSX.Element {
  const user = useRequireAuth();
  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </main>
    );
  }
  return (
    <ActiveJobsProvider>
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main className="flex-1 p-4 md:p-6">{children}</main>
        </div>
      </div>
    </ActiveJobsProvider>
  );
}
