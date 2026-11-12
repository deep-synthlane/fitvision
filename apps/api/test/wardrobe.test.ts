import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyticsEvents, avatars, bodyMeasurements, bodyScans, products, sizeRecommendations, tryOnPhotos, tryOnResults, users } from '../src/db/schema.js';
import { garmentPng } from './fixtures/productSite.js';
import { FakeProvider, uploadPhoto } from './fixtures/tryon.js';
import { SCAN_JPEG } from './fixtures/images.js';
import { createTestApp, registerUser, type TestContext } from './helpers.js';

let ctx: TestContext;
let provider: FakeProvider;
beforeAll(async () => {
  provider = new FakeProvider();
  ctx = await createTestApp({ tryOnProvider: provider }, { AUTH_RATE_LIMIT_MAX: '1000', TRYON_POLL_MS: '10' });
});
afterAll(async () => {
  await ctx.close();
});

const PROFILE = { name: 'W', birthYear: null, clothingPreference: 'unisex', heightCm: 170, weightKg: 70, country: 'IN', measurementUnit: 'metric' };
const CHART = {
  unit: 'cm',
  kind: 'body',
  source: 'user',
  rows: [
    { sizeLabel: 'S', chestCm: 90, waistCm: null, hipsCm: null, shoulderCm: 42, inseamCm: null, sleeveCm: null, raw: {} },
    { sizeLabel: 'M', chestCm: 96, waistCm: null, hipsCm: null, shoulderCm: 44, inseamCm: null, sleeveCm: null, raw: {} },
  ],
};

async function user() {
  const { cookie, res } = await registerUser(ctx.app);
  await ctx.app.inject({ method: 'PUT', url: '/api/profile', headers: { cookie }, payload: PROFILE });
  return { cookie, id: res.json().user.id as string };
}
async function product(cookie: string, fields: Record<string, unknown>) {
  const fd = new FormData();
  fd.append('image0', new Blob([await garmentPng(`#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`)]), 'g.png');
  fd.append('data', JSON.stringify({ source: 'manual_upload', fields: { category: 't_shirts', ...fields }, images: [{ kind: 'upload', field: 'image0', imageType: 'garment_front' }], tryOnImageIndex: 0 }));
  return (await ctx.app.inject({ method: 'POST', url: '/api/products', headers: { cookie }, payload: fd })).json().product;
}
const get = async (cookie: string, url: string) => (await ctx.app.inject({ method: 'GET', url, headers: { cookie } })).json();

describe('wardrobe listing', () => {
  it('searches, filters, sorts and returns facets', async () => {
    const { cookie } = await user();
    const a = await product(cookie, { name: 'Linen Shirt', brand: 'Acme', color: 'White', category: 'shirts' });
    const b = await product(cookie, { name: 'Denim Jacket', brand: 'Blue Co', color: 'Indigo', category: 'jackets' });
    const c = await product(cookie, { name: 'White Tee', brand: 'acme', color: 'white' });

    const all = await get(cookie, '/api/products');
    expect(all.total).toBe(3);
    expect(all.products.map((p: { id: string }) => p.id)).toEqual([c.id, b.id, a.id]);
    expect(all.facets.categories).toEqual(['jackets', 'shirts', 't_shirts']);
    expect(all.facets.brands.map((b: string) => b.toLowerCase())).toEqual(['acme', 'blue co']);

    expect((await get(cookie, '/api/products?q=denim')).products.map((p: { id: string }) => p.id)).toEqual([b.id]);
    expect((await get(cookie, '/api/products?q=acme')).products).toHaveLength(2); // brand search, case-insensitive
    expect((await get(cookie, '/api/products?brand=ACME')).products).toHaveLength(2);
    expect((await get(cookie, '/api/products?color=white&category=shirts')).products.map((p: { id: string }) => p.id)).toEqual([a.id]);
    expect((await get(cookie, '/api/products?sort=oldest')).products[0].id).toBe(a.id);
    expect((await get(cookie, '/api/products?sort=name')).products.map((p: { name: string }) => p.name)).toEqual(['Denim Jacket', 'Linen Shirt', 'White Tee']);
    expect((await get(cookie, '/api/products?q=100%25')).products).toEqual([]); // LIKE wildcards are escaped
    expect((await ctx.app.inject({ method: 'GET', url: '/api/products?category=shoes', headers: { cookie } })).statusCode).toBe(400);
  });

  it('tracks favourites and recently viewed', async () => {
    const { cookie } = await user();
    const a = await product(cookie, { name: 'A' });
    const b = await product(cookie, { name: 'B' });
    await ctx.app.inject({ method: 'POST', url: `/api/products/${a.id}/favourite`, headers: { cookie }, payload: { favourite: true } });
    expect((await get(cookie, '/api/products?favourite=true')).products.map((p: { id: string }) => p.id)).toEqual([a.id]);

    await get(cookie, `/api/products/${a.id}`);
    await new Promise((r) => setTimeout(r, 5));
    await get(cookie, `/api/products/${b.id}`);
    const viewed = await get(cookie, '/api/products?viewed=true&sort=recently_viewed');
    expect(viewed.products.map((p: { id: string }) => p.id)).toEqual([b.id, a.id]);
    expect(viewed.products[0].lastViewedAt).toBeTruthy();
  });
});

describe('collections', () => {
  it('creates, renames, adds/removes items and filters by collection', async () => {
    const { cookie } = await user();
    const p = await product(cookie, { name: 'Blazer', category: 'jackets' });
    const created = (await ctx.app.inject({ method: 'POST', url: '/api/collections', headers: { cookie }, payload: { name: 'Work' } })).json().collections;
    const work = created[0];
    expect((await ctx.app.inject({ method: 'POST', url: '/api/collections', headers: { cookie }, payload: { name: 'work' } })).statusCode).toBe(409);

    await ctx.app.inject({ method: 'PUT', url: `/api/collections/${work.id}/items/${p.id}`, headers: { cookie } });
    await ctx.app.inject({ method: 'PUT', url: `/api/collections/${work.id}/items/${p.id}`, headers: { cookie } }); // idempotent
    expect((await get(cookie, '/api/collections')).collections[0]).toMatchObject({ name: 'Work', productIds: [p.id] });
    expect((await get(cookie, `/api/products?collectionId=${work.id}`)).products[0].collectionIds).toEqual([work.id]);

    await ctx.app.inject({ method: 'PATCH', url: `/api/collections/${work.id}`, headers: { cookie }, payload: { name: 'Office' } });
    await ctx.app.inject({ method: 'DELETE', url: `/api/collections/${work.id}/items/${p.id}`, headers: { cookie } });
    expect((await get(cookie, '/api/collections')).collections[0]).toMatchObject({ name: 'Office', productIds: [] });

    expect((await ctx.app.inject({ method: 'DELETE', url: `/api/collections/${work.id}`, headers: { cookie } })).statusCode).toBe(204);
    expect((await get(cookie, `/api/products/${p.id}`)).product.id).toBe(p.id); // product kept
  });

  it('is private to its owner', async () => {
    const a = await user();
    const b = await user();
    const pa = await product(a.cookie, { name: 'Mine' });
    const pb = await product(b.cookie, { name: 'Theirs' });
    const col = (await ctx.app.inject({ method: 'POST', url: '/api/collections', headers: { cookie: a.cookie }, payload: { name: 'Party' } })).json().collections[0];
    expect((await ctx.app.inject({ method: 'PUT', url: `/api/collections/${col.id}/items/${pa.id}`, headers: { cookie: b.cookie } })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'PUT', url: `/api/collections/${col.id}/items/${pb.id}`, headers: { cookie: a.cookie } })).statusCode).toBe(404);
    expect((await get(b.cookie, '/api/collections')).collections).toEqual([]);
  });
});

describe('size feedback', () => {
  it('records outcomes with the recommendation and engine version, for offline analysis only', async () => {
    const { cookie } = await user();
    const p = await product(cookie, { name: 'Tee', brand: 'Acme', sizes: ['S', 'M'], sizeChart: CHART });
    await ctx.app.inject({ method: 'POST', url: '/api/measurements', headers: { cookie }, payload: { heightCm: 170, chestCm: 95, shoulderCm: 44, waistCm: null, hipsCm: null, inseamCm: null, armLengthCm: null } });
    const rec = (await ctx.app.inject({ method: 'POST', url: `/api/products/${p.id}/size-recommendation`, headers: { cookie } })).json().recommendation;
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/products/${p.id}/size-feedback`,
      headers: { cookie },
      payload: { recommendationId: rec.id, fitRating: 'slightly_small', purchasedSize: 'M', returned: true, returnReason: 'Tight across the shoulders', fitPreference: 'looser' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().feedback).toMatchObject({ recommendedSize: rec.result.recommendedSize, engineVersion: rec.result.algorithmVersion, fitRating: 'slightly_small', returned: true });
    expect((await get(cookie, `/api/products/${p.id}/size-feedback`)).feedback).toHaveLength(1);
    // The engine's answer is unchanged by feedback.
    const again = (await ctx.app.inject({ method: 'POST', url: `/api/products/${p.id}/size-recommendation`, headers: { cookie } })).json().recommendation;
    expect(again.result.recommendedSize).toBe(rec.result.recommendedSize);

    expect((await ctx.app.inject({ method: 'POST', url: `/api/products/${p.id}/size-feedback`, headers: { cookie }, payload: { fitRating: 'perfect' } })).statusCode).toBe(400);
    const other = await user();
    expect((await ctx.app.inject({ method: 'POST', url: `/api/products/${p.id}/size-feedback`, headers: { cookie: other.cookie }, payload: { fitRating: 'just_right' } })).statusCode).toBe(404);
  });
});

describe('data controls', () => {
  async function richUser() {
    const u = await user();
    const p = await product(u.cookie, { name: 'Dress', category: 'dresses', sizes: ['S', 'M'] });
    const JPEG = SCAN_JPEG;
    const fd = new FormData();
    fd.append('front', new Blob([JPEG]), 'f.jpg');
    fd.append('side', new Blob([JPEG]), 's.jpg');
    fd.append(
      'data',
      JSON.stringify({
        scan: { processingVersion: 't', estimates: { chestCm: { valueCm: 90, confidence: 0.8 } }, proportions: { shoulderToHipRatio: null, waistToHipRatio: null, legToHeightRatio: null, bodyShape: null } },
        measurements: { heightCm: 170, chestCm: 90, waistCm: 70, hipsCm: 95, shoulderCm: null, inseamCm: null, armLengthCm: null },
      }),
    );
    await ctx.app.inject({ method: 'POST', url: '/api/scans', headers: { cookie: u.cookie }, payload: fd });
    await ctx.app.inject({ method: 'POST', url: '/api/avatars', headers: { cookie: u.cookie } });
    await ctx.app.avatarJobs.drain();
    await ctx.app.inject({ method: 'POST', url: `/api/products/${p.id}/size-recommendation`, headers: { cookie: u.cookie } });
    const photo = (await uploadPhoto(ctx.app, u.cookie)).json().photo;
    const t = (await ctx.app.inject({ method: 'POST', url: '/api/try-ons', headers: { cookie: u.cookie }, payload: { productId: p.id, personPhotoId: photo.id, idempotencyKey: randomUUID() } })).json().tryOn;
    await ctx.app.tryOnJobs.drain();
    await ctx.app.inject({ method: 'POST', url: '/api/saved-looks', headers: { cookie: u.cookie }, payload: { tryOnResultId: t.id } });
    const files = () => [...ctx.storage.files.keys()].filter((k) => k.includes(u.id));
    return { ...u, product: p, tryOn: t, photo, files };
  }
  const del = (cookie: string, kind: string) => ctx.app.inject({ method: 'DELETE', url: `/api/account/data/${kind}`, headers: { cookie } });

  it('deleting measurements also removes avatars (and files) and size recommendations, but keeps scans', async () => {
    const u = await richUser();
    expect(u.files().some((k) => k.startsWith('avatars/'))).toBe(true);
    expect((await del(u.cookie, 'measurements')).statusCode).toBe(204);
    expect(await ctx.db.select().from(bodyMeasurements).where(eq(bodyMeasurements.userId, u.id))).toEqual([]);
    expect(await ctx.db.select().from(avatars).where(eq(avatars.userId, u.id))).toEqual([]);
    expect(await ctx.db.select().from(sizeRecommendations).where(eq(sizeRecommendations.userId, u.id))).toEqual([]);
    expect(u.files().some((k) => k.startsWith('avatars/'))).toBe(false);
    expect((await ctx.db.select().from(bodyScans).where(eq(bodyScans.userId, u.id))).length).toBe(1);
  });

  it('deleting scans keeps measurements; deleting try-on photos keeps results; deleting products removes their try-ons and files', async () => {
    const u = await richUser();
    await del(u.cookie, 'scans');
    expect(u.files().some((k) => k.startsWith('scans/'))).toBe(false);
    expect((await ctx.db.select().from(bodyMeasurements).where(eq(bodyMeasurements.userId, u.id)))[0]!.scanId).toBeNull();

    await del(u.cookie, 'try-on-photos');
    expect((await ctx.db.select().from(tryOnPhotos).where(eq(tryOnPhotos.userId, u.id)))[0]!.deletedAt).not.toBeNull();
    expect((await get(u.cookie, `/api/try-ons/${u.tryOn.id}`)).tryOn).toMatchObject({ status: 'ready', personPhotoUrl: null });

    await del(u.cookie, 'products');
    expect(await ctx.db.select().from(products).where(eq(products.userId, u.id))).toEqual([]);
    expect(await ctx.db.select().from(tryOnResults).where(eq(tryOnResults.userId, u.id))).toEqual([]);
    expect(u.files().filter((k) => k.startsWith('products/') || k.startsWith('tryons/'))).toEqual([]);
    expect((await get(u.cookie, '/api/saved-looks')).looks).toEqual([]);
    expect((await ctx.app.inject({ method: 'DELETE', url: '/api/account/data/everything', headers: { cookie: u.cookie } })).statusCode).toBe(404);
  });

  it('deletes the whole account: password required, all rows and files gone, private resources inaccessible', async () => {
    const u = await richUser();
    const resultUrl = (await get(u.cookie, `/api/try-ons/${u.tryOn.id}`)).tryOn.resultImageUrl;
    expect(u.files().length).toBeGreaterThan(5);
    const subject = ctx.app.analytics.subject(u.id);
    const events = () => ctx.db.select().from(analyticsEvents).where(eq(analyticsEvents.subject, subject));
    await new Promise((r) => setTimeout(r, 50)); // analytics writes are fire-and-forget
    expect((await events()).length).toBeGreaterThan(0);

    const wrong = await ctx.app.inject({ method: 'DELETE', url: '/api/account', headers: { cookie: u.cookie }, payload: { password: 'nope' } });
    expect(wrong.statusCode).toBe(403);
    const ok = await ctx.app.inject({ method: 'DELETE', url: '/api/account', headers: { cookie: u.cookie }, payload: { password: 'correct-horse-battery' } });
    expect(ok.statusCode).toBe(204);

    expect(await ctx.db.select().from(users).where(eq(users.id, u.id))).toEqual([]);
    expect(u.files()).toEqual([]);
    expect(await events()).toEqual([]);
    for (const url of ['/api/auth/me', '/api/products', `/api/try-ons/${u.tryOn.id}`, resultUrl, u.photo.imageUrl]) {
      expect((await ctx.app.inject({ method: 'GET', url, headers: { cookie: u.cookie } })).statusCode).toBe(401);
    }
  });
});

describe('account deletion password attempts', () => {
  it('are rate limited per user', async () => {
    const u = await registerUser(ctx.app);
    const attempt = () => ctx.app.inject({ method: 'DELETE', url: '/api/account', headers: { cookie: u.cookie }, payload: { password: 'wrong' } });
    for (let i = 0; i < 5; i++) expect((await attempt()).statusCode).toBe(403);
    expect((await attempt()).statusCode).toBe(429);
  });
});

describe('job modes', () => {
  it('an API process in "api" mode only queues; a worker picks the job up', async () => {
    const api = await createTestApp({ tryOnProvider: new FakeProvider() }, { JOB_MODE: 'api', AUTH_RATE_LIMIT_MAX: '1000' });
    try {
      const { cookie } = await registerUser(api.app);
      await api.app.inject({ method: 'PUT', url: '/api/profile', headers: { cookie }, payload: PROFILE });
      await api.app.inject({ method: 'POST', url: '/api/measurements', headers: { cookie }, payload: { heightCm: 170, chestCm: 90, waistCm: null, hipsCm: null, shoulderCm: null, inseamCm: null, armLengthCm: null } });
      await api.app.inject({ method: 'POST', url: '/api/avatars', headers: { cookie } });
      await new Promise((r) => setTimeout(r, 50));
      expect((await api.app.inject({ method: 'GET', url: '/api/avatars/current', headers: { cookie } })).json().avatar.status).toBe('pending');

      // Simulate the worker process against the same database: switch on job running and poll.
      (api.app.avatarJobs as unknown as { hooks: { runsJobs: boolean } }).hooks.runsJobs = true;
      expect(await api.app.avatarJobs.pollPending()).toBe(1);
      await api.app.avatarJobs.drain();
      expect((await api.app.inject({ method: 'GET', url: '/api/avatars/current', headers: { cookie } })).json().avatar.status).toBe('ready');
      // Polling again (duplicate delivery) does nothing.
      expect(await api.app.avatarJobs.pollPending()).toBe(0);
    } finally {
      await api.close();
    }
  });
});
