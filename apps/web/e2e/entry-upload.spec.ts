import { expect, test, type Page } from '@playwright/test';
import { loginAs } from './fixtures/auth';
import { e2eTmpDir, fixtureAs } from './fixtures/files';

async function uploadSingle(
  page: Page,
  companyId: string,
  projectId: string,
  filePath: string,
): Promise<void> {
  await page.goto('/ar/upload');
  const company = page.getByLabel(/الشركة|Company/);
  await company.selectOption(companyId);
  const project = page.getByLabel(/المشروع|Project/);
  await project.selectOption(projectId);
  await page.getByPlaceholder(/\d{4}/).fill('2025');
  await page.locator('input[type="file"]').first().setInputFiles(filePath);
  await page.getByRole('button', { name: /رفع القيد|Upload entry/ }).click();
}

test.describe('single upload', () => {
  test('valid PDF uploads, succeeds, and appears in the list', async ({ page, request }) => {
    const { apiLogin, resolveScope } = await import('./fixtures/auth');
    const token = await apiLogin(request, 'archivist');
    const scope = await resolveScope(request, token);
    await loginAs(page, 'archivist');
    await uploadSingle(page, scope.c1, scope.rehab, fixtureAs(e2eTmpDir(), '6200000001.pdf'));
    await expect(page.getByText(/تم رفع القيد|success/i)).toBeVisible({ timeout: 60_000 });
    await page.goto('/ar/entries');
    await expect(page.getByText('6200000001')).toBeVisible();
  });

  test('9-digit filename is rejected client-side, submit stays disabled', async ({ page }) => {
    await loginAs(page, 'archivist');
    await page.goto('/ar/upload');
    await page.locator('input[type="file"]').first().setInputFiles(fixtureAs(e2eTmpDir(), '620000001.pdf', 'sample.pdf'));
    await expect(page.getByText(/10 أرقام|10 digits/)).toBeVisible();
    await expect(page.getByRole('button', { name: /رفع القيد|Upload entry/ })).toBeDisabled();
  });

  test('wrong prefix shows the allowed-prefix error', async ({ page }) => {
    await loginAs(page, 'archivist');
    await page.goto('/ar/upload');
    await page.locator('input[type="file"]').first().setInputFiles(fixtureAs(e2eTmpDir(), '9900000000.pdf'));
    await expect(page.getByText(/62، 63، 67|62, 63, 67/)).toBeVisible();
  });

  test('same serial twice shows the conflict UI with existing-entry link', async ({
    page,
    request,
  }) => {
    // Own serial (6200000012): uploaded and re-uploaded inside this test,
    // so file-level parallelism cannot flake it.
    const { apiLogin, resolveScope } = await import('./fixtures/auth');
    const token = await apiLogin(request, 'archivist');
    const scope = await resolveScope(request, token);
    await loginAs(page, 'archivist');
    await uploadSingle(page, scope.c1, scope.rehab, fixtureAs(e2eTmpDir(), '6200000012.pdf'));
    await expect(page.getByText(/تم رفع القيد|success/i)).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: /رفع ملف آخر|another/i }).click();
    await uploadSingle(page, scope.c1, scope.rehab, fixtureAs(e2eTmpDir(), '6200000012.pdf'));
    await expect(page.getByText(/مستخدم بالفعل|already/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: /عرض القيد الموجود|existing/i })).toBeVisible();
  });

  test('non-PDF is rejected by the dropzone', async ({ page }) => {
    await loginAs(page, 'archivist');
    await page.goto('/ar/upload');
    const input = page.locator('input[type="file"]').first();
    await input.setInputFiles(fixtureAs(e2eTmpDir(), 'notes.txt', 'sample.txt'));
    await expect(page.getByRole('button', { name: /^رفع القيد$|^Upload entry$/ })).toHaveCount(0);
  });
});
