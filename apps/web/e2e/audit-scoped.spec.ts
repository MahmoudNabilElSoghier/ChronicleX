import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiLogin, loginAs, resolveScope } from './fixtures/auth';
import { e2eTmpDir, fixtureAs } from './fixtures/files';

/**
 * Validates the scoped-audit WHERE clause against real Prisma semantics —
 * the thing unit tests cannot prove (mocks don't evaluate WHERE).
 */

/** Upload one PDF through the single-upload UI as the logged-in user. */
async function uiUpload(page: Page, companyId: string, projectId: string, filePath: string): Promise<void> {
  await page.goto('/ar/upload');
  await page.getByLabel(/الشركة|Company/).selectOption(companyId);
  await page.getByLabel(/المشروع|Project/).selectOption(projectId);
  await page.getByPlaceholder(/\d{4}/).fill('2025');
  await page.locator('input[type="file"]').first().setInputFiles(filePath);
  await page.getByRole('button', { name: /رفع القيد|Upload entry/ }).click();
  await expect(page.getByText(/تم رفع القيد|success/i)).toBeVisible({ timeout: 60_000 });
}

/** Resolve an entry id by exact serial (superuser read). */
async function entryIdBySerial(
  request: APIRequestContext,
  token: string,
  serial: string,
): Promise<string> {
  const res = await request.get(`http://localhost:3001/entries?serial=${serial}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await res.json()) as { items: { id: string }[] };
  const id = body.items[0]?.id;
  if (!id) throw new Error(`entry ${serial} not found`);
  return id;
}

async function filterByResourceId(page: Page, id: string): Promise<void> {
  await page.goto('/ar/admin/audit');
  await page.getByLabel(/معرف المورد|Resource ID/).fill(id);
}

test.describe('scoped audit reads', () => {
  test('ARCHIVIST upload in p1 is visible to COMPANY_ADMIN c1', async ({ page, request }) => {
    const token = await apiLogin(request, 'super');
    const scope = await resolveScope(request, token);
    await loginAs(page, 'archivist');
    await uiUpload(page, scope.c1, scope.rehab, fixtureAs(e2eTmpDir(), '6200000031.pdf'));
    const id = await entryIdBySerial(request, token, '6200000031');

    await loginAs(page, 'c1admin');
    await filterByResourceId(page, id);
    await expect(page.getByText(id)).toBeVisible({ timeout: 30_000 });
  });

  // Phase 8 audit tripwire: ENTRY resourceId matching is deferred (needs a
  // denormalized scope column on AuditLog). test.fail() inverts the result —
  // the suite stays green while this fails, and goes RED the day it passes,
  // which is the signal to remove the .fail() wrapper. Search the repo for
  // "Phase 8 audit tripwire" when that day comes.
  test.fail(
    'COMPANY_ADMIN c1 sees SUPER_ADMIN\'s ENTRY update in c1',
    async ({ page, request }) => {
      const token = await apiLogin(request, 'super');
      const scope = await resolveScope(request, token);
      await loginAs(page, 'super');
      await uiUpload(page, scope.c1, scope.rehab, fixtureAs(e2eTmpDir(), '6200000032.pdf'));
      const id = await entryIdBySerial(request, token, '6200000032');

      await loginAs(page, 'c1admin');
      await filterByResourceId(page, id);
      await expect(page.getByText(id)).toBeVisible({ timeout: 30_000 });
    },
  );

  test('SUPER_ADMIN ENTRY in c2 is NOT visible to COMPANY_ADMIN c1', async ({
    page,
    request,
  }) => {
    const token = await apiLogin(request, 'super');
    const scope = await resolveScope(request, token);
    await loginAs(page, 'super');
    await uiUpload(page, scope.c2, scope.madinaty, fixtureAs(e2eTmpDir(), '6200000033.pdf'));
    const id = await entryIdBySerial(request, token, '6200000033');

    await loginAs(page, 'c1admin');
    await filterByResourceId(page, id);
    await expect(page.getByText(/لا توجد سجلات|No matching/)).toBeVisible({ timeout: 30_000 });
  });

  test('COMPANY_ADMIN c2 sees only c2-related logs', async ({ page, request }) => {
    const token = await apiLogin(request, 'super');
    const scope = await resolveScope(request, token);
    const stamp = Date.now().toString(36);
    const email = `c2admin-${stamp}@tmg.local`;
    const rolesRes = await request.get('http://localhost:3001/users/roles', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const roles = (await rolesRes.json()) as { items: { id: string; name: string }[] };
    const adminRole = roles.items.find((r) => r.name === 'COMPANY_ADMIN')?.id;
    if (!adminRole) throw new Error('COMPANY_ADMIN role missing');
    const created = await request.post('http://localhost:3001/users', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        email,
        nameAr: 'مدير',
        nameEn: 'C2',
        password: 'C2Admin!2025',
        initialRoles: [{ roleId: adminRole, scopeType: 'COMPANY', scopeId: scope.c2 }],
      },
    });
    expect(created.ok()).toBe(true);

    await loginAs(page, 'super');
    await uiUpload(page, scope.c2, scope.madinaty, fixtureAs(e2eTmpDir(), '6200000034.pdf'));
    await uiUpload(page, scope.c1, scope.rehab, fixtureAs(e2eTmpDir(), '6200000035.pdf'));
    const idInC2 = await entryIdBySerial(request, token, '6200000034');
    const idInC1 = await entryIdBySerial(request, token, '6200000035');

    await page.goto('/ar/login');
    await page.getByLabel(/البريد الإلكتروني/).fill(email);
    await page.getByLabel(/كلمة المرور/).fill('C2Admin!2025');
    await page.getByRole('button', { name: /تسجيل الدخول/ }).click();
    await expect(page).toHaveURL(/\/ar\/dashboard/);

    await filterByResourceId(page, idInC2);
    await expect(page.getByText(idInC2)).toBeVisible({ timeout: 30_000 });
    await filterByResourceId(page, idInC1);
    await expect(page.getByText(/لا توجد سجلات|No matching/)).toBeVisible({ timeout: 30_000 });
  });
});
