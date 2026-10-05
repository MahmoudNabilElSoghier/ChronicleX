import { expect, test } from '@playwright/test';
import { loginAs } from './fixtures/auth';

test('invalid credentials show the Arabic error', async ({ page }) => {
  await page.goto('/ar/login');
  await page.getByLabel(/البريد الإلكتروني/).fill('nobody@tmg.local');
  await page.getByLabel(/كلمة المرور/).fill('WrongPass1');
  await page.getByRole('button', { name: /تسجيل الدخول/ }).click();
  await expect(page.getByText(/بيانات الدخول غير صحيحة/)).toBeVisible();
});

test('valid super-admin login lands on the dashboard', async ({ page }) => {
  await loginAs(page, 'super');
  await expect(page.getByText(/أهلاً/)).toBeVisible();
});

test('session persists across reload via refresh rotation', async ({ page }) => {
  await loginAs(page, 'super');
  await page.reload();
  await expect(page).toHaveURL(/\/ar\/dashboard/);
  await expect(page.getByText(/أهلاً/)).toBeVisible();
});

test('logout redirects to login and back does not restore the session', async ({ page }) => {
  await loginAs(page, 'super');
  await page.getByRole('button', { name: /الحساب|Account/ }).click();
  await page.getByRole('menuitem', { name: /تسجيل الخروج/ }).click();
  await expect(page).toHaveURL(/\/ar\/login/);
  await page.goBack();
  await expect(page).toHaveURL(/\/ar\/login/);
});
