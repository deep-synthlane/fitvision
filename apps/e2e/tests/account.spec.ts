import { expect, test } from '@playwright/test';
import { PASSWORD, uniqueEmail } from './helpers.js';

test('create an account, complete onboarding and reach the dashboard', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await page.getByRole('link', { name: /create an account/i }).click();

  await page.getByLabel('Name').fill('E2E Tester');
  await page.getByLabel('Email').fill(uniqueEmail('account'));
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();

  await page.getByLabel('Womenswear').check({ force: true });
  await page.getByLabel('Metric (cm, kg)').check({ force: true });
  await page.getByLabel('Height (cm)').fill('165');
  await page.getByLabel('Weight (kg)').fill('58');
  await page.getByLabel('Country').selectOption('IN');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Skip scan for now' }).click();
  await expect(page.getByRole('heading', { name: /^Hi, / })).toBeVisible();

  // Signing out ends the session; protected pages bounce to login.
  await page.getByRole('button', { name: /sign out/i }).click();
  await page.goto('/wardrobe');
  await expect(page).toHaveURL(/\/login/);
});
