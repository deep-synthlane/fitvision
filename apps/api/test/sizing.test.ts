import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SIZE_ENGINE_VERSION, recommendSize } from '@fitvision/shared';
import { garmentPng } from './fixtures/productSite.js';
import { createTestApp, registerUser, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestApp({}, { AUTH_RATE_LIMIT_MAX: '1000' });
});
afterAll(async () => {
  await ctx.close();
});

const range = (min: number, max: number) => ({ raw: `${min}-${max}`, minCm: min, maxCm: max });
const row = (sizeLabel: string, chest: [number, number], waist: [number, number], hips: [number, number]) => ({
  sizeLabel,
  chestCm: (chest[0] + chest[1]) / 2,
  waistCm: (waist[0] + waist[1]) / 2,
  hipsCm: (hips[0] + hips[1]) / 2,
  shoulderCm: null,
  inseamCm: null,
  sleeveCm: null,
  raw: { chest: range(...chest), waist: range(...waist), hips: range(...hips) },
});
const BRIEF_CHART = {
  unit: 'cm',
  kind: 'body',
  source: 'html_table',
  rows: [row('S', [88, 92], [72, 76], [92, 96]), row('M', [93, 98], [77, 83], [97, 102]), row('L', [99, 104], [84, 90], [103, 108])],
};

async function product(cookie: string, sizeChart: unknown = BRIEF_CHART) {
  const fd = new FormData();
  fd.append('image0', new Blob([await garmentPng('#7c3aed')]), 'g.png');
  fd.append(
    'data',
    JSON.stringify({
      source: 'manual_upload',
      fields: { name: 'Wrap Dress', category: 'dresses', sizes: ['S', 'M', 'L'], sizeChart },
      images: [{ kind: 'upload', field: 'image0', imageType: 'garment_front' }],
      tryOnImageIndex: 0,
    }),
  );
  return (await ctx.app.inject({ method: 'POST', url: '/api/products', headers: { cookie }, payload: fd })).json().product;
}
const measure = (cookie: string, values: Record<string, number | null>) =>
  ctx.app.inject({
    method: 'POST',
    url: '/api/measurements',
    headers: { cookie },
    payload: { heightCm: 168, chestCm: null, waistCm: null, hipsCm: null, shoulderCm: null, inseamCm: null, armLengthCm: null, ...values },
  });
const compute = (cookie: string, id: string) => ctx.app.inject({ method: 'POST', url: `/api/products/${id}/size-recommendation`, headers: { cookie } });
const current = async (cookie: string, id: string) => (await ctx.app.inject({ method: 'GET', url: `/api/products/${id}/size-recommendation`, headers: { cookie } })).json();

describe('size recommendations', () => {
  it('needs saved measurements', async () => {
    const { cookie } = await registerUser(ctx.app);
    const p = await product(cookie);
    expect(await current(cookie, p.id)).toEqual({ recommendation: null, stale: [], canCompute: false });
    expect((await compute(cookie, p.id)).json().error.code).toBe('NO_MEASUREMENTS');
  });

  it('recommends a size with reasoning, stores the snapshot, and is reproducible', async () => {
    const { cookie } = await registerUser(ctx.app);
    const p = await product(cookie);
    const m = (await measure(cookie, { chestCm: 96, waistCm: 82, hipsCm: 98 })).json().measurements;
    const res = await compute(cookie, p.id);
    expect(res.statusCode).toBe(201);
    const rec = res.json().recommendation;
    expect(rec).toMatchObject({ measurementId: m.id, measurementSource: 'manual', scanVersion: null });
    expect(rec.recommendedVariantId).toBe(p.variants.find((v: { sizeLabel: string }) => v.sizeLabel === 'M').id);
    expect(rec.result).toMatchObject({
      algorithmVersion: SIZE_ENGINE_VERSION,
      recommendedSize: 'M',
      confidence: 'high',
      chartQuality: 'complete',
      chartSource: 'product_body_chart',
    });
    expect(rec.result.measurements.map((x: { label: string; matchedSize: string }) => [x.label, x.matchedSize])).toEqual([
      ['Chest / bust', 'M'],
      ['Waist', 'M'],
      ['Hips', 'M'],
    ]);
    // The stored inputs replay to exactly the stored result.
    expect(recommendSize(rec.result.inputs)).toEqual(rec.result);
    expect(await current(cookie, p.id)).toMatchObject({ recommendation: { id: rec.id }, stale: [], canCompute: true });
  });

  it('marks recommendations stale when measurements or the size chart change, and recomputes', async () => {
    const { cookie } = await registerUser(ctx.app);
    const p = await product(cookie);
    await measure(cookie, { chestCm: 96, waistCm: 82, hipsCm: 98 });
    await compute(cookie, p.id);

    await measure(cookie, { chestCm: 96, waistCm: 80, hipsCm: 105 });
    expect((await current(cookie, p.id)).stale).toEqual(['measurements_changed']);
    const fresh = (await compute(cookie, p.id)).json().recommendation.result;
    expect(fresh).toMatchObject({ recommendedSize: 'L', alternativeSize: 'M', confidence: 'medium' });
    expect(fresh.summary).toContain('We recommend L for a more comfortable fit');
    expect((await current(cookie, p.id)).stale).toEqual([]);

    await new Promise((r) => setTimeout(r, 5));
    await ctx.app.inject({ method: 'PATCH', url: `/api/products/${p.id}`, headers: { cookie }, payload: { fields: { sizeChart: null } } });
    expect((await current(cookie, p.id)).stale).toEqual(['product_changed']);
    const none = (await compute(cookie, p.id)).json().recommendation;
    expect(none).toMatchObject({ recommendedVariantId: null, result: { recommendedSize: null, confidence: 'none', chartQuality: 'missing' } });
  });

  it('keeps recommendations private to their owner', async () => {
    const owner = await registerUser(ctx.app);
    const other = await registerUser(ctx.app);
    const p = await product(owner.cookie);
    await measure(other.cookie, { chestCm: 96 });
    expect((await compute(other.cookie, p.id)).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'GET', url: `/api/products/${p.id}/size-recommendation`, headers: { cookie: other.cookie } })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'GET', url: `/api/products/${p.id}/size-recommendation` })).statusCode).toBe(401);
  });
});
