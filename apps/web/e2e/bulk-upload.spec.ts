import { expect, test, type Page } from '@playwright/test';
import { apiLogin, loginAs, resolveScope } from './fixtures/auth';
import { e2eTmpDir, fixtureAs } from './fixtures/files';

async function uploadBulk(
  page: Page,
  companyId: string,
  projectId: string,
  filePaths: string[],
): Promise<void> {
  await page.goto('/ar/upload');
  await page.getByRole('tab', { name: /رفع متعدد|Bulk/ }).click();
  await page.getByLabel(/الشركة|Company/).selectOption(companyId);
  await page.getByLabel(/المشروع|Project/).selectOption(projectId);
  await page.getByPlaceholder(/\d{4}/).fill('2025');
  await page.locator('input[type="file"]').first().setInputFiles(filePaths);
  await page.getByRole('button', { name: /رفع الكل|Upload all/ }).click();
}

test.describe('bulk upload', () => {
  test('3 valid files reach done and appear in the list', async ({ page, request }) => {
    const token = await apiLogin(request, 'archivist');
    const scope = await resolveScope(request, token);
    await loginAs(page, 'archivist');
    const dir = e2eTmpDir();
    await uploadBulk(page, scope.c1, scope.rehab, [
      fixtureAs(dir, '6300000011.pdf'),
      fixtureAs(dir, '6300000012.pdf'),
      fixtureAs(dir, '6300000013.pdf'),
    ]);
    await expect(page.getByText(/3 \/ 3|done|تم/i)).toBeVisible({ timeout: 120_000 });
    await page.goto('/ar/entries');
    await expect(page.getByText('6300000011')).toBeVisible();
    await expect(page.getByText('6300000013')).toBeVisible();
  });

  test('2 valid + 1 invalid filename: invalid rejected client-side', async ({
    page,
    request,
  }) => {
    const token = await apiLogin(request, 'archivist');
    const scope = await resolveScope(request, token);
    await loginAs(page, 'archivist');
    await page.goto('/ar/upload');
    await page.getByRole('tab', { name: /رفع متعدد|Bulk/ }).click();
    const dir = e2eTmpDir();
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles([
        fixtureAs(dir, '6300000021.pdf'),
        fixtureAs(dir, 'not-a-serial.pdf'),
        fixtureAs(dir, '6300000022.pdf'),
      ]);
    await expect(page.getByText(/2 صالح|2 valid/i)).toBeVisible();
  });

  test('same serial twice: one succeeds, one fails with conflict link', async ({
    page,
    request,
  }) => {
    const token = await apiLogin(request, 'archivist');
    const scope = await resolveScope(request, token);
    await loginAs(page, 'archivist');
    const dir = e2eTmpDir();
    // Same path twice → two File objects, one serial. The loser deterministically
    // reports DUPLICATE_SERIAL thanks to the P2002 mapping in the worker.
    const dup = fixtureAs(dir, '6700000021.pdf');
    await uploadBulk(page, scope.c1, scope.rehab, [dup, dup]);
    await expect(page.getByText(/DUPLICATE_SERIAL|مستخدم بالفعل/i)).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByRole('button', { name: /عرض القيد الموجود|existing/i })).toBeVisible();
  });
});
