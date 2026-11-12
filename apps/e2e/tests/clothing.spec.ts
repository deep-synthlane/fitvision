import { expect, test } from '@playwright/test';
import { FIXTURE_ORIGIN, garmentPng, signUpViaApi } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await page.goto('/login');
  await signUpViaApi(page, 'clothing');
});

test('upload a garment photo and open the product', async ({ page }) => {
  await page.goto('/clothing/new?mode=upload');
  await page.getByLabel('Choose garment photos').setInputFiles({ name: 'dress.png', mimeType: 'image/png', buffer: await garmentPng() });
  await page.getByLabel('Product name').fill('Pink Midi Dress');
  await page.getByLabel('Category', { exact: true }).selectOption('dresses');
  await page.getByLabel('Image 1 type').selectOption('garment_front');
  await page.getByRole('button', { name: 'Save to my clothing' }).click();
  await expect(page.getByRole('heading', { name: 'Pink Midi Dress' })).toBeVisible();

  await page.goto('/wardrobe');
  await expect(page.getByRole('link', { name: 'Pink Midi Dress' })).toBeVisible();
});

test('import a product from the local fixture store, review and save', async ({ page }) => {
  await page.goto('/clothing/new');
  await page.getByLabel('Product link').fill(`${FIXTURE_ORIGIN}/products/denim-jacket`);
  await page.getByRole('button', { name: 'Import product' }).click();
  await expect(page.getByRole('heading', { name: 'Review imported details' })).toBeVisible();
  await expect(page.getByLabel('Product name')).toHaveValue('Classic Denim Jacket');
  await page.getByRole('button', { name: 'Save to my clothing' }).click();
  await expect(page.getByRole('heading', { name: 'Classic Denim Jacket' })).toBeVisible();

  await page.goto('/wardrobe?brand=Acme+Apparel');
  await expect(page.getByRole('link', { name: 'Classic Denim Jacket' })).toBeVisible();
});

test('import refuses a private address with a clear reason', async ({ page }) => {
  await page.goto('/clothing/new');
  await page.getByLabel('Product link').fill(`${FIXTURE_ORIGIN}/redirect-private`);
  await page.getByRole('button', { name: 'Import product' }).click();
  await expect(page.getByRole('alert').or(page.locator('.fv-alert'))).toContainText(/Reason:/);
});
