import { expect, test } from '@playwright/test';
import { PREVIEW_ORIGIN } from '../playwright.config.js';
import { BODY_CHART, createProduct, personJpeg, signUpViaApi, uploadTryOnPhoto } from './helpers.js';

// The production build, served with the exact security headers from deploy/security-headers.caddy.
test.use({ baseURL: PREVIEW_ORIGIN });

test('production build runs under the production Content-Security-Policy', async ({ page }) => {
  test.setTimeout(180_000);
  const violations: string[] = [];
  page.on('console', (m) => /Content Security Policy|Refused to/i.test(m.text()) && violations.push(m.text()));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => console.error(`Refused to load (CSP ${e.violatedDirective}): ${e.blockedURI} at ${e.sourceFile}:${e.lineNumber}:${e.columnNumber} on ${location.pathname}`));
  });

  const res = await page.goto('/login');
  expect(res?.headers()['content-security-policy']).toContain("frame-ancestors 'none'");

  await signUpViaApi(page, 'csp', { chestCm: 91, waistCm: 73, hipsCm: 97 });
  const productId = await createProduct(page.request, 'CSP Dress', BODY_CHART);
  await uploadTryOnPhoto(page.request);

  for (const path of ['/', '/wardrobe', `/clothing/${productId}`, '/profile', '/privacy']) {
    await page.goto(path);
    await expect(page.locator('main h1').first()).toBeVisible();
  }

  // Product images, size recommendation and the mock try-on result (blob/same-origin images).
  await page.goto(`/clothing/${productId}`);
  await page.getByRole('button', { name: 'Find my size' }).click();
  await expect(page.locator('.fv-size-headline')).toBeVisible();
  await page.goto(`/clothing/${productId}/try-on`);
  await page.getByRole('radio', { name: /Your try-on photo/ }).check({ force: true });
  await page.getByRole('button', { name: 'Generate try-on' }).click();
  await expect(page.getByRole('img', { name: /Try-on result/ })).toBeVisible({ timeout: 30_000 });

  // three.js avatar (WebGL).
  await page.goto('/avatar');
  await page.getByRole('button', { name: 'Create my avatar' }).click();
  await expect(page.getByRole('heading', { name: 'Built from' })).toBeVisible({ timeout: 30_000 });

  // MediaPipe photo analysis loads WASM and a model from public CDNs, so it needs internet access.
  if (process.env.E2E_EXTERNAL_CDN === '1') {
    await page.goto(`/clothing/${productId}/try-on`);
    await page.getByLabel('Choose a try-on photo').setInputFiles({ name: 'p.jpg', mimeType: 'image/jpeg', buffer: await personJpeg() });
    await expect(page.getByText(/isn’t suitable for|looks suitable|Save & use this photo/).first()).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/isn’t suitable for/)).toBeVisible({ timeout: 90_000 });
  }

  expect(violations).toEqual([]);
});
