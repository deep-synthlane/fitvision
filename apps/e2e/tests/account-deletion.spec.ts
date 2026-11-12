import { expect, test } from '@playwright/test';
import { PASSWORD, createProduct, signUpViaApi } from './helpers.js';

test('delete the account: data and sessions are gone', async ({ page, browser }) => {
  await page.goto('/login');
  const email = await signUpViaApi(page, 'delete');
  const productId = await createProduct(page.request, 'Doomed Dress');
  const product = (await (await page.request.get(`/api/products/${productId}`)).json()) as { product: { images: { url: string }[] } };
  const imageUrl = product.product.images[0]!.url;
  expect((await page.request.get(imageUrl)).status()).toBe(200);

  await page.goto('/privacy');
  page.on('dialog', (d) => void d.accept());
  await page.getByLabel('Confirm with your password').fill('not-my-password');
  await page.getByRole('button', { name: 'Delete my account' }).click();
  await expect(page.getByText('Incorrect password')).toBeVisible();

  await page.getByLabel('Confirm with your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Delete my account' }).click();
  await expect(page.getByRole('heading', { name: 'Your account has been deleted' })).toBeVisible();
  await expect(page).toHaveURL(/\/goodbye/);

  // The old session cookie no longer works and private files are gone.
  expect((await page.request.get('/api/auth/me')).status()).toBe(401);
  expect((await page.request.get(imageUrl)).status()).toBeGreaterThanOrEqual(401);

  // The credentials no longer sign in.
  const fresh = await browser.newContext();
  const login = await fresh.request.post(`${test.info().project.use.baseURL}/api/auth/login`, { data: { email, password: PASSWORD } });
  expect(login.status()).toBe(401);
  await fresh.close();
});
