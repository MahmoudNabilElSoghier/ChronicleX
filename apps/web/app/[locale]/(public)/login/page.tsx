'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/auth-context';

export default function LoginPage(): JSX.Element {
  const t = useTranslations('auth');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { status, login } = useAuth();
  const [serverError, setServerError] = React.useState<string | null>(null);

  const schema = React.useMemo(
    () =>
      z.object({
        email: z.string().email(t('invalidEmail')),
        password: z.string().min(8, t('passwordTooShort')),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  React.useEffect(() => {
    if (status === 'authenticated') {
      router.replace(searchParams.get('next') ?? '/dashboard');
    }
  }, [status, router, searchParams]);

  async function onSubmit(values: FormValues): Promise<void> {
    setServerError(null);
    try {
      await login(values.email, values.password);
      router.push(searchParams.get('next') ?? '/dashboard');
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setServerError(t('tooManyAttempts'));
      } else {
        setServerError(t('invalidCredentials'));
      }
    }
  }

  if (status === 'loading') {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">ChronicleX</CardTitle>
          <CardDescription>{t('tagline')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('email')}</FormLabel>
                    <FormControl>
                      <Input type="email" autoComplete="email" dir="ltr" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('password')}</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="current-password" dir="ltr" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {serverError ? (
                <p role="alert" className="text-sm font-medium text-destructive">
                  {serverError}
                </p>
              ) : null}
              <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {t('signIn')}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </main>
  );
}
