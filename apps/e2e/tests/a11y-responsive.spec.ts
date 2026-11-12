import { expect, test } from '@playwright/test';
import { BODY_CHART, a11yViolations, createProduct, expectNoA11yViolations, expectNoHorizontalOverflow, signUpViaApi, uploadTryOnPhoto } from './helpers.js';

const VIEWPORTS = [
  { name: 'small phone', width: 320, height: 640 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'desktop', width: 1920, height: 1080 },
];

test('the audit harness detects a planted violation', async ({ page }) => {
  await page.goto('/login');
  await page.evaluate(() => {
    const img = document.createElement('img');
    img.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    document.body.append(img);
  });
  expect((await a11yViolations(page)).map((v) => v.id)).toContain('image-alt');
});

test('public pages: WCAG 2.1 AA automated checks', async ({ page }) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const path of ['/login', '/register', '/goodbye']) {
      await page.goto(path);
      await page.getByRole('heading').first().waitFor();
      await expectNoA11yViolations(page, `${path} (${scheme})`);
    }
  }
});

test('signed-in pages: WCAG 2.1 AA automated checks and 5 viewport sizes', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/login');
  await signUpViaApi(page, 'a11y', { chestCm: 91, waistCm: 73, hipsCm: 97 });
  const productId = await createProduct(page.request, 'Audit Dress', BODY_CHART);
  const photoId = await uploadTryOnPhoto(page.request);
  const tryOn = await page.request.post('/api/try-ons', { data: { productId, personPhotoId: photoId, idempotencyKey: crypto.randomUUID() } });
  const tryOnId = ((await tryOn.json()) as { tryOn: { id: string } }).tryOn.id;

  const pages = [
    '/',
    '/wardrobe',
    '/wardrobe?tab=collections',
    '/clothing/new',
    `/clothing/${productId}`,
    `/clothing/${productId}/try-on`,
    `/try-ons/${tryOnId}`,
    '/avatar',
    '/profile',
    '/privacy',
  ];
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const path of pages) {
      await page.goto(path);
      await expect(page.locator('main h1').first()).toBeVisible();
      await page.waitForLoadState('networkidle');
      await expectNoHorizontalOverflow(page, `${path} @ ${vp.width}px`);
      if (path === `/clothing/${productId}`) {
        // The manual size-chart editor is the widest UI in the app.
        await page.getByRole('button', { name: 'Edit size chart' }).click();
        await expectNoHorizontalOverflow(page, `size-chart editor @ ${vp.width}px`);
      }
      if (vp.width === 1280 || vp.width === 390) await expectNoA11yViolations(page, `${path} @ ${vp.width}px`);
    }
  }

  // Dark theme (colour contrast differs).
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const path of pages) {
    await page.goto(path);
    await expect(page.locator('main h1').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expectNoA11yViolations(page, `${path} (dark)`);
  }
});
