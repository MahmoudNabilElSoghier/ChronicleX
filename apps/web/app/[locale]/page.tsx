'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth/auth-context';

export default function IndexPage(): JSX.Element {
  const router = useRouter();
  const { status } = useAuth();

  React.useEffect(() => {
    if (status === 'authenticated') router.replace('/dashboard');
    else if (status === 'unauthenticated') router.replace('/login');
  }, [status, router]);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <Skeleton className="h-8 w-48" />
    </main>
  );
}
