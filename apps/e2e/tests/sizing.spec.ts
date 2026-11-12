import { expect, test } from '@playwright/test';
import { BODY_CHART, createProduct, signUpViaApi } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await page.goto('/login');
  await signUpViaApi(page, 'sizing', { chestCm: 91, waistCm: 73, hipsCm: 97 });
});

test('size recommendation from an imported-style chart', async ({ page }) => {
  const id = await createProduct(page.request, 'Charted Dress', BODY_CHART);
  await page.goto(`/clothing/${id}`);
  await page.getByRole('button', { name: 'Find my size' }).click();
  await expect(page.locator('.fv-size-headline')).toContainText('M');
});

test('manual size chart entry feeds the same engine', async ({ page }) => {
  const id = await createProduct(page.request, 'Uncharted Dress');
  await page.goto(`/clothing/${id}`);
  await page.getByRole('button', { name: 'Add size information manually' }).click();
  const sizes: [string, string, string, string][] = [
    ['S', '84-88', '66-70', '90-94'],
    ['M', '89-94', '71-76', '95-100'],
    ['L', '95-100', '77-82', '101-106'],
  ];
  for (const [i, [label, chest, waist, hips]] of sizes.entries()) {
    const n = i + 1;
    if ((await page.getByLabel(`Row ${n} size label`).count()) === 0) await page.getByRole('button', { name: /add (a )?row|add size/i }).click();
    await page.getByLabel(`Row ${n} size label`).fill(label);
    await page.getByLabel(`Row ${n} Chest / bust (cm)`).fill(chest);
    await page.getByLabel(`Row ${n} Waist (cm)`).fill(waist);
    await page.getByLabel(`Row ${n} Hips (cm)`).fill(hips);
  }
  await page.getByRole('button', { name: 'Review' }).click();
  await expect(page.getByRole('heading', { name: 'Review size chart' })).toBeVisible();
  await page.getByRole('button', { name: 'Save size chart' }).click();
  await expect(page.getByText('Size chart saved.')).toBeVisible();

  await page.getByRole('button', { name: 'Find my size' }).click();
  await expect(page.locator('.fv-size-headline')).toContainText('M');
});
