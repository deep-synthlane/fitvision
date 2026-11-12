import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import sharp from 'sharp';

export const PASSWORD = 'e2e-password-123';
export const FIXTURE_ORIGIN = 'http://127.0.0.1:4599';

export const uniqueEmail = (tag: string) => `e2e-${tag}-${randomUUID().slice(0, 8)}@example.com`;

/** Synthetic garment image (no real products or people). */
export const garmentPng = (color = '#be185d') =>
  sharp({ create: { width: 500, height: 600, channels: 3, background: '#f4f4f4' } })
    .composite([{ input: { create: { width: 300, height: 420, channels: 3, background: color } }, left: 100, top: 90 }])
    .png()
    .toBuffer();

/** Synthetic textured "person" photo; its suitability is declared by the test, not detected. */
export const personJpeg = () =>
  sharp({ create: { width: 600, height: 900, channels: 3, background: '#888', noise: { type: 'gaussian', mean: 128, sigma: 40 } } })
    .jpeg()
    .toBuffer();

/** Registers through the API and fills in the basics so the app skips onboarding. Shares the page's cookies. */
export async function signUpViaApi(page: Page, tag: string, measurements: Partial<Record<'chestCm' | 'waistCm' | 'hipsCm', number>> = {}) {
  const email = uniqueEmail(tag);
  const api = page.request;
  await ok(api.post('/api/auth/register', { data: { name: 'E2E Tester', email, password: PASSWORD } }));
  await ok(
    api.put('/api/profile', {
      data: { name: 'E2E Tester', birthYear: null, clothingPreference: 'womenswear', heightCm: 168, weightKg: 62, country: 'IN', measurementUnit: 'metric' },
    }),
  );
  if (Object.keys(measurements).length) {
    await ok(api.post('/api/measurements', { data: { heightCm: 168, shoulderCm: null, inseamCm: null, armLengthCm: null, chestCm: null, waistCm: null, hipsCm: null, ...measurements } }));
  }
  return email;
}

export async function createProduct(api: APIRequestContext, name: string, sizeChart: unknown = null, category = 'dresses'): Promise<string> {
  const res = await ok(
    api.post('/api/products', {
      multipart: {
        image0: { name: 'g.png', mimeType: 'image/png', buffer: await garmentPng() },
        data: JSON.stringify({
          source: 'manual_upload',
          fields: { name, category, sizes: ['S', 'M', 'L'], sizeChart },
          images: [{ kind: 'upload', field: 'image0', imageType: 'garment_front' }],
          tryOnImageIndex: 0,
        }),
      },
    }),
  );
  return ((await res.json()) as { product: { id: string } }).product.id;
}

export async function uploadTryOnPhoto(api: APIRequestContext): Promise<string> {
  const res = await ok(
    api.post('/api/try-on-photos', {
      multipart: {
        suitability: JSON.stringify({
          checkedBy: 'e2e (synthetic photo, declared suitable)',
          onePerson: true,
          facingCamera: true,
          personHeightFraction: 0.85,
          regions: { upper_body: true, lower_body: true, full_body: true },
          lightingOk: true,
          sharpOk: true,
          issues: [],
        }),
        photo: { name: 'p.jpg', mimeType: 'image/jpeg', buffer: await personJpeg() },
      },
    }),
  );
  return ((await res.json()) as { photo: { id: string } }).photo.id;
}

const range = (a: number, b: number) => ({ raw: `${a}-${b}`, minCm: a, maxCm: b });
const row = (s: string, c: [number, number], w: [number, number], h: [number, number]) => ({
  sizeLabel: s,
  chestCm: (c[0] + c[1]) / 2,
  waistCm: (w[0] + w[1]) / 2,
  hipsCm: (h[0] + h[1]) / 2,
  shoulderCm: null,
  inseamCm: null,
  sleeveCm: null,
  raw: { chest: range(...c), waist: range(...w), hips: range(...h) },
});
export const BODY_CHART = {
  unit: 'cm',
  kind: 'body',
  source: 'html_table',
  rows: [row('S', [84, 88], [66, 70], [90, 94]), row('M', [89, 94], [71, 76], [95, 100]), row('L', [95, 100], [77, 82], [101, 106])],
};

async function ok<T extends { ok(): boolean; status(): number; text(): Promise<string> }>(p: Promise<T>): Promise<T> {
  const res = await p;
  if (!res.ok()) throw new Error(`API call failed: ${res.status()} ${await res.text()}`);
  return res;
}

const require = createRequire(import.meta.url);
const AXE_PATH = require.resolve('axe-core/axe.min.js');

interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  nodes: { target: string[] }[];
}

/** Runs axe-core's WCAG 2.1 A/AA rules on the current page. */
export async function a11yViolations(page: Page) {
  await page.addScriptTag({ path: AXE_PATH });
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: Document, opts: unknown) => Promise<{ violations: AxeViolation[] }> } }).axe;
    const result = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
    return result.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 5).map((n) => ({ target: n.target })) }));
  });
}

/** Automated checks catch only part of WCAG; the manual checks are listed in docs/ACCESSIBILITY.md. */
export async function expectNoA11yViolations(page: Page, label: string) {
  const violations = await a11yViolations(page);
  expect(violations, `${label}: ${JSON.stringify(violations, null, 2)}`).toEqual([]);
}

/** Fails when the page scrolls sideways at the current viewport. */
export async function expectNoHorizontalOverflow(page: Page, label: string) {
  const { overflow, widest } = await page.evaluate(() => {
    const vw = window.innerWidth;
    // Elements with the furthest right edge, to say what overflows (may be hidden or absolutely positioned).
    const widest = [...document.querySelectorAll('body *')]
      .map((el) => [el, el.getBoundingClientRect().right] as const)
      .filter(([, right]) => right > vw + 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([el, right]) => `${el.tagName.toLowerCase()}${[...el.classList].map((c) => `.${c}`).join('')} (right ${Math.round(right)}px)`);
    return { overflow: document.documentElement.scrollWidth - vw, widest };
  });
  expect(overflow, `${label}: horizontal overflow; widest: ${widest.join(', ')}`).toBeLessThanOrEqual(0);
}
