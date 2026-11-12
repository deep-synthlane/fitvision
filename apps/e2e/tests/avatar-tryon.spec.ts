import { expect, test } from '@playwright/test';
import { createProduct, expectNoA11yViolations, signUpViaApi, uploadTryOnPhoto } from './helpers.js';

test('generate an avatar, then try a shirt on it (mock provider)', async ({ page }) => {
  await page.goto('/login');
  await signUpViaApi(page, 'avatar', { chestCm: 90, waistCm: 72, hipsCm: 96 });
  const productId = await createProduct(page.request, 'Avatar Shirt', null, 't_shirts');

  // No avatar yet: avatar try-on explains what to do.
  await page.goto(`/clothing/${productId}/try-on`);
  await page.getByRole('button', { name: 'Use my avatar' }).click();
  await expect(page.getByText('You need to create your avatar before using avatar try-on.')).toBeVisible();
  await page.getByRole('link', { name: 'Create my avatar' }).click();

  await expect(page).toHaveURL(/\/avatar$/);
  await page.getByRole('button', { name: 'Create my avatar' }).click();
  await expect(page.getByRole('heading', { name: 'Built from' })).toBeVisible({ timeout: 30_000 });

  await page.goto(`/clothing/${productId}/try-on`);
  await page.getByRole('button', { name: 'Use my avatar' }).click();
  await expect(page.getByText('Using your avatar')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Avatar try-on is an approximate visual preview based on your saved body measurements.')).toBeVisible();
  const render = page.getByRole('img', { name: /Front view of your avatar/ });
  await expect(render).toBeVisible();
  const renderSrc = (await render.getAttribute('src'))!;
  await expect(page.getByRole('img', { name: 'Avatar input' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Selected garment input' })).toBeVisible();
  expect(await render.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([768, 1024]);
  await expectNoA11yViolations(page, 'avatar try-on panel');

  await page.getByRole('button', { name: 'Generate try-on' }).click();
  await page.waitForURL(/\/try-ons\//);
  await expect(page.getByRole('img', { name: /Try-on result/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Mock result — not AI', { exact: true })).toBeVisible();
  await expect(page.getByText('Using your avatar.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Visual try-on result' })).toBeVisible();

  // The page shows the provider's generated output, not the avatar input.
  const resultSrc = (await page.getByRole('img', { name: /Try-on result/ }).getAttribute('src'))!;
  expect(resultSrc).toMatch(/^\/api\/try-ons\/[0-9a-f-]+\/image$/);
  const [resultBytes, avatarBytes] = await Promise.all([page.request.get(resultSrc).then((r) => r.body()), page.request.get(renderSrc).then((r) => r.body())]);
  expect(resultBytes.equals(avatarBytes)).toBe(false);
  await expect(page.getByRole('img', { name: 'Front view of your avatar' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Compare with my avatar' }).click();
  await expect(page.getByRole('img', { name: 'Front view of your avatar' })).toHaveAttribute('src', renderSrc);
  await page.getByRole('button', { name: 'View garment' }).click();
  await expect(page.getByRole('img', { name: 'Garment image used' })).toBeVisible();
  const id = page.url().split('/').pop();
  const result = (await (await page.request.get(`/api/try-ons/${id}`)).json()) as { tryOn: { personSource: string; avatarModelVersion: string } };
  expect(result.tryOn).toMatchObject({ personSource: 'avatar_render', avatarModelVersion: 'parametric-mannequin-0.1' });
});

test('mock try-on: generate, label as mock, save the look', async ({ page }) => {
  await page.goto('/login');
  await signUpViaApi(page, 'tryon');
  const productId = await createProduct(page.request, 'Wrap Dress');
  await uploadTryOnPhoto(page.request);

  await page.goto(`/clothing/${productId}/try-on`);
  await page.getByRole('radio', { name: /Your try-on photo/ }).check({ force: true });
  await page.getByRole('button', { name: 'Generate try-on' }).click();
  await page.waitForURL(/\/try-ons\//);
  await expect(page.getByRole('img', { name: /Try-on result/ })).toBeVisible({ timeout: 30_000 });
  // The mock provider's output must always be labelled as simulated.
  await expect(page.getByText('Mock result — not AI', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: /\(mock\)/ })).toBeVisible();

  await page.getByRole('button', { name: 'Save look' }).click();
  await expect(page.getByRole('button', { name: 'Saved ✓ (remove)' })).toBeVisible();
  await page.goto('/wardrobe?tab=looks');
  await expect(page.getByText('Wrap Dress').first()).toBeVisible();
});
