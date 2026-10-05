import { expect, test, type Page } from '@playwright/test';
import { apiLogin, loginAs, resolveScope } from './fixtures/auth';
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

test.describe('entries list', () => {
  test('shows entries for SUPER_ADMIN', async ({ page, request }) => {
    const token = await apiLogin(request, 'super');
    const scope = await resolveScope(request, token);
    await loginAs(page, 'super');
    await uploadSingle(page, scope.c1, scope.rehab, fixtureAs(e2eTmpDir(), '6200000041.pdf'));
    await expect(page.getByText(/تم رفع القيد|success/i)).toBeVisible({ timeout: 30_000 });
    await page.goto('/ar/entries');
    await expect(page.getByText('6200000041')).toBeVisible();
  });

  test('year filter narrows results', async ({ page, request }) => {
    const token = await apiLogin(request, 'super');
    await resolveScope(request, token);
    await loginAs(page, 'super');
    await uploadSingle(page, scope.c1, scope.rehab, fixtureAs(e2eTmpDir(), '6200000042.pdf'));
    await expect(page.getByText(/تم رفع القيد|success/i)).toBeVisible({ timeout: 30_000 });
    await page.goto('/ar/entries');
    await expect(page.getByText('6200000042')).toBeVisible();
    const yearSelect = page.getByLabel(/السنة|Year/);
    await yearSelect.selectOption('2025');
    await expect(page.getByText('6200000042')).toBeVisible();
  });

  test('company + project filter narrows results', async ({ page, request }) => {
    const token = await apiLogin(request, 'super');
    const scope = await resolveScope(request, token);
    await loginAs(page, 'super');
    await page.goto('/ar/entries');
    const company = page.getByLabel(/الشركة|Company/);
    await company.selectOption(scope.c1);
    await expect(page.getByText('6200000041')).toBeVisible();
  });

  test('no matches show the empty state with reset', async ({ page }) => {
    await loginAs(page, 'super');
    await page.goto('/ar/entries');
    await page.getByLabel(/رقم القيد|Serial/).fill('6299999999');
    await expect(page.getByText(/لا توجد قيود|No matching/)).toBeVisible();
    await page.getByRole('button', { name: /مسح الفلاتر|Reset/ }).click();
  });
});
