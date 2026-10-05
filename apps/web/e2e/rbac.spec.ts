import { expect, test } from '@playwright/test';
import { loginAs } from './fixtures/auth';

test.describe('rbac', () => {
  test('ARCHIVIST cannot see the Delete action, but sees the Upload nav item', async ({
    page,
  }) => {
    await loginAs(page, 'archivist');
    await expect(page.getByRole('link', { name: /رفع|Upload/ })).toBeVisible();
    await page.goto('/ar/entries');
    const firstRowMenu = page.getByRole('button', { name: /خيارات|Options/ }).first();
    if (await firstRowMenu.count()) {
      await firstRowMenu.click();
      await expect(page.getByRole('menuitem', { name: /حذف|Delete/ })).toHaveCount(0);
    }
  });

  test('VIEWER cannot see the Upload nav item', async ({ page }) => {
    await loginAs(page, 'viewer');
    await expect(page.getByRole('link', { name: /رفع|Upload/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /القيود|Entries/ })).toBeVisible();
  });

  test('PROJECT_ADMIN p1 cannot see entries from outside projects', async ({
    page,
    request,
  }) => {
    const { apiLogin, resolveScope } = await import('./fixtures/auth');
    const token = await apiLogin(request, 'super');
    const scope = await resolveScope(request, token);
    await loginAs(page, 'p1admin');
    await page.goto('/ar/entries');
    await expect(page.getByText(/القيود المحاسبية|Accounting Entries/)).toBeVisible();
    // p2 serial namespace (6700...) must never appear for a p1-scoped admin.
    await expect(page.getByText('6700000021')).toHaveCount(0);
    expect(scope.outsideC1.length).toBeGreaterThan(0);
  });

  test('COMPANY_ADMIN c1 cannot see users from c2', async ({ page, request }) => {
    const { apiLogin } = await import('./fixtures/auth');
    const token = await apiLogin(request, 'super');
    const stamp = Date.now().toString(36);
    const email = `c2ghost-${stamp}@tmg.local`;
    const companiesRes = await request.get('http://localhost:3001/companies', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const companies = (await companiesRes.json()) as { items: { id: string; code: number }[] };
    const c2 = companies.items.find((c) => c.code === 1001)?.id;
    if (!c2) throw new Error('seed c2 missing');
    const rolesRes = await request.get('http://localhost:3001/users/roles', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const roles = (await rolesRes.json()) as { items: { id: string; name: string }[] };
    const viewerRole = roles.items.find((r) => r.name === 'VIEWER')?.id;
    if (!viewerRole) throw new Error('VIEWER role missing');
    const created = await request.post('http://localhost:3001/users', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        email,
        nameAr: 'شبح',
        nameEn: 'Ghost',
        password: 'GhostPass99',
        initialRoles: [{ roleId: viewerRole, scopeType: 'COMPANY', scopeId: c2 }],
      },
    });
    expect(created.ok()).toBe(true);
    await loginAs(page, 'c1admin');
    await page.goto('/ar/admin/users');
    await expect(page.getByText(/إدارة المستخدمين|User management/)).toBeVisible();
    await expect(page.getByText(email)).toHaveCount(0);
  });
});
