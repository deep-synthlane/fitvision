import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MOCK_TRY_ON_NOTICE, TRY_ON_ERROR_MESSAGES } from '@fitvision/shared';
import { products, tryOnResults } from '../src/db/schema.js';
import { MockVirtualTryOnProvider } from '../src/tryon/mockProvider.js';
import { FakeProvider, blurryPhoto, createProduct, personPhoto, providerError, suitability, uploadPhoto } from './fixtures/tryon.js';
import { createTestApp, registerUser, type TestContext } from './helpers.js';

const FAST = { AUTH_RATE_LIMIT_MAX: '1000', TRYON_POLL_MS: '10', TRYON_TIMEOUT_MS: '2000', TRYON_MAX_ACTIVE: '2', TRYON_DAILY_LIMIT: '50' };

let ctx: TestContext;
let provider: FakeProvider;
beforeAll(async () => {
  provider = new FakeProvider();
  ctx = await createTestApp({ tryOnProvider: provider, tryOnJobOptions: { retryBaseMs: 5 } }, FAST);
});
afterAll(async () => {
  await ctx.close();
});

const users = new Map<string, Promise<{ cookie: string }>>();
const user = (name: string) => {
  if (!users.has(name)) users.set(name, registerUser(ctx.app));
  return users.get(name)!;
};

async function setup(name: string, category = 't_shirts', app = ctx.app) {
  const { cookie } = await (app === ctx.app ? user(name) : registerUser(app));
  const product = await createProduct(app, cookie, category);
  const photo = (await uploadPhoto(app, cookie)).json().photo;
  return { cookie, product, photo };
}

const submit = (cookie: string, body: Record<string, unknown>, app = ctx.app) =>
  app.inject({ method: 'POST', url: '/api/try-ons', headers: { cookie }, payload: { idempotencyKey: randomUUID(), ...body } });
const get = async (cookie: string, id: string, app = ctx.app) => (await app.inject({ method: 'GET', url: `/api/try-ons/${id}`, headers: { cookie } })).json().tryOn;

describe('try-on photos', () => {
  it('validates uploads (type, size) and records server-side checks', async () => {
    const { cookie } = await user('photos');
    const notImage = await uploadPhoto(ctx.app, cookie, Buffer.from('%PDF-1.4'));
    expect(notImage.json().error).toMatchObject({ code: 'BAD_IMAGE' });
    const tiny = await uploadPhoto(ctx.app, cookie, await personPhoto(200, 300));
    expect(tiny.json().error.fields.photo).toMatch(/too small/);
    const badJson = await ctx.app.inject({
      method: 'POST',
      url: '/api/try-on-photos',
      headers: { cookie },
      payload: (() => {
        const fd = new FormData();
        fd.append('suitability', JSON.stringify({ onePerson: 'yes' }));
        return fd;
      })(),
    });
    expect(badJson.statusCode).toBe(400);

    const blurry = (await uploadPhoto(ctx.app, cookie, await blurryPhoto())).json().photo;
    expect(blurry.suitability.sharpOk).toBe(false);
    expect(blurry.suitability.issues).toContain('The photo looks blurry.');
    const ok = (await uploadPhoto(ctx.app, cookie)).json().photo;
    expect(ok.suitability).toMatchObject({ sharpOk: true, server: { width: 600, height: 900, sharpOk: true } });
  });

  it('keeps photos private and deletes their files', async () => {
    const { cookie } = await user('photo-owner');
    const other = await user('photo-other');
    const photo = (await uploadPhoto(ctx.app, cookie)).json().photo;
    expect((await ctx.app.inject({ method: 'GET', url: photo.imageUrl })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: 'GET', url: photo.imageUrl, headers: { cookie: other.cookie } })).statusCode).toBe(404);
    const own = await ctx.app.inject({ method: 'GET', url: photo.thumbnailUrl, headers: { cookie } });
    expect(own.headers).toMatchObject({ 'content-type': 'image/webp', 'cache-control': 'private, no-store' });

    expect((await ctx.app.inject({ method: 'DELETE', url: `/api/try-on-photos/${photo.id}`, headers: { cookie: other.cookie } })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'DELETE', url: `/api/try-on-photos/${photo.id}`, headers: { cookie } })).statusCode).toBe(204);
    expect((await ctx.app.inject({ method: 'GET', url: photo.imageUrl, headers: { cookie } })).statusCode).toBe(404);
    expect(ctx.storage.files.has(`tryon-photos/${photo.id}`)).toBe(false);
  });
});

describe('try-on generation', () => {
  it('runs pending → processing → ready, stores the result privately and records metadata', async () => {
    const { cookie, product, photo } = await setup('happy');
    provider.statusSteps = [async () => ({ state: 'processing', providerJobId: 'job-x' })];
    const res = await submit(cookie, { productId: product.id, personPhotoId: photo.id });
    expect(res.statusCode).toBe(202);
    expect(res.json().tryOn).toMatchObject({ status: 'pending', provider: 'fake', modelVersion: 'fake-1', source: 'real', resultImageUrl: null });

    await ctx.app.tryOnJobs.drain();
    const done = await get(cookie, res.json().tryOn.id);
    expect(done).toMatchObject({ status: 'ready', productImageId: product.tryOnImageId, personPhotoId: photo.id, productName: 'Test Garment' });
    expect(done.providerJobId).toMatch(/^job-/);
    expect(done.startedAt && done.completedAt && done.createdAt).toBeTruthy();
    expect(new Date(done.completedAt) >= new Date(done.startedAt)).toBe(true);

    const img = await ctx.app.inject({ method: 'GET', url: done.resultImageUrl, headers: { cookie } });
    expect(img.headers).toMatchObject({ 'content-type': 'image/webp', 'cache-control': 'private, no-store' });
    const other = await user('happy-other');
    expect((await ctx.app.inject({ method: 'GET', url: done.resultImageUrl, headers: { cookie: other.cookie } })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'GET', url: `/api/try-ons/${done.id}`, headers: { cookie: other.cookie } })).statusCode).toBe(404);
  });

  it('enforces ownership of products and photos', async () => {
    const a = await setup('own-a');
    const b = await setup('own-b');
    expect((await submit(a.cookie, { productId: b.product.id, personPhotoId: a.photo.id })).statusCode).toBe(404);
    expect((await submit(a.cookie, { productId: a.product.id, personPhotoId: b.photo.id })).statusCode).toBe(404);
    expect((await submit(a.cookie, { productId: a.product.id, personPhotoId: a.photo.id, productImageId: b.product.tryOnImageId })).json().error.code).toBe(
      'UNSUITABLE_GARMENT_IMAGE',
    );
  });

  it('rejects unsupported garments, unsuitable photos and unsuitable garment images', async () => {
    const { cookie, product } = await setup('unsuitable', 'skirts');
    const upperOnly = (await uploadPhoto(ctx.app, cookie, undefined, suitability({ regions: { upper_body: true, lower_body: false, full_body: false } }))).json().photo;
    const res = await submit(cookie, { productId: product.id, personPhotoId: upperOnly.id });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({ code: 'UNSUITABLE_PERSON_PHOTO', message: TRY_ON_ERROR_MESSAGES.unsuitable_person_photo });
    expect(res.json().error.fields.reason).toMatch(/lower-body garments/);

    const blurry = (await uploadPhoto(ctx.app, cookie, await blurryPhoto())).json().photo;
    expect((await submit(cookie, { productId: product.id, personPhotoId: blurry.id })).json().error.fields.reason).toMatch(/blurry/);

    const detail = await createProduct(ctx.app, cookie, 'shirts', 'detail');
    const good = (await uploadPhoto(ctx.app, cookie)).json().photo;
    expect((await submit(cookie, { productId: detail.id, personPhotoId: good.id })).json().error.code).toBe('UNSUITABLE_GARMENT_IMAGE');

    // Categories outside the supported set (e.g. legacy/foreign data) are refused.
    await ctx.db.update(products).set({ category: 'shoes' }).where(eq(products.id, product.id));
    expect((await submit(cookie, { productId: product.id, personPhotoId: good.id })).json().error.code).toBe('UNSUPPORTED_GARMENT');
  });

  it('does not charge twice for duplicate submits', async () => {
    const { cookie, product, photo } = await setup('dupes');
    provider.hang();
    const key = randomUUID();
    const first = await submit(cookie, { productId: product.id, personPhotoId: photo.id, idempotencyKey: key });
    const replay = await submit(cookie, { productId: product.id, personPhotoId: photo.id, idempotencyKey: key });
    const sameInputs = await submit(cookie, { productId: product.id, personPhotoId: photo.id });
    expect(first.statusCode).toBe(202);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().tryOn.id).toBe(first.json().tryOn.id);
    expect(sameInputs.json().tryOn.id).toBe(first.json().tryOn.id);
    await ctx.app.inject({ method: 'POST', url: `/api/try-ons/${first.json().tryOn.id}/cancel`, headers: { cookie } });
    provider.statusSteps = [];
    await ctx.app.tryOnJobs.drain();
  });

  it('limits concurrent jobs per user', async () => {
    const { cookie, product, photo } = await setup('concurrency');
    provider.hang();
    const photo2 = (await uploadPhoto(ctx.app, cookie)).json().photo;
    const photo3 = (await uploadPhoto(ctx.app, cookie)).json().photo;
    const a = await submit(cookie, { productId: product.id, personPhotoId: photo.id });
    const b = await submit(cookie, { productId: product.id, personPhotoId: photo2.id });
    const c = await submit(cookie, { productId: product.id, personPhotoId: photo3.id });
    expect([a.statusCode, b.statusCode]).toEqual([202, 202]);
    expect(c.statusCode).toBe(429);
    expect(c.json().error.code).toBe('TOO_MANY_ACTIVE');
    for (const r of [a, b]) await ctx.app.inject({ method: 'POST', url: `/api/try-ons/${r.json().tryOn.id}/cancel`, headers: { cookie } });
    provider.statusSteps = [];
    await ctx.app.tryOnJobs.drain();
    expect(provider.cancelled.length).toBeGreaterThanOrEqual(2);
    expect((await get(cookie, a.json().tryOn.id)).status).toBe('cancelled');
  });

  it('times out on the server and cancels the provider job', async () => {
    const local = await createTestApp({ tryOnProvider: new FakeProvider() }, { ...FAST, TRYON_TIMEOUT_MS: '150' });
    try {
      const fake = (local.app as unknown as { tryOnJobs: { provider: FakeProvider } }).tryOnJobs.provider;
      fake.hang();
      const { cookie, product, photo } = await setup('', 't_shirts', local.app);
      const res = await submit(cookie, { productId: product.id, personPhotoId: photo.id }, local.app);
      await local.app.tryOnJobs.drain();
      const t = await get(cookie, res.json().tryOn.id, local.app);
      expect(t).toMatchObject({ status: 'failed', errorCode: 'provider_timeout', errorMessage: TRY_ON_ERROR_MESSAGES.provider_timeout });
      expect(fake.cancelled).toContain('job-hang');
    } finally {
      await local.close();
    }
  });

  it('maps provider failures to safe messages and never exposes raw provider details', async () => {
    const { cookie, product, photo } = await setup('failures');
    provider.statusSteps = [async () => ({ state: 'failed', providerJobId: 'j', error: providerError('moderation') })];
    const res = await submit(cookie, { productId: product.id, personPhotoId: photo.id });
    await ctx.app.tryOnJobs.drain();
    const raw = await ctx.app.inject({ method: 'GET', url: `/api/try-ons/${res.json().tryOn.id}`, headers: { cookie } });
    expect(raw.json().tryOn).toMatchObject({ status: 'failed', errorCode: 'provider_moderation', errorMessage: TRY_ON_ERROR_MESSAGES.provider_moderation });
    expect(raw.body).not.toContain('secret-request-id');
    const [row] = await ctx.db.select().from(tryOnResults).where(eq(tryOnResults.id, res.json().tryOn.id));
    expect(row!.diagnostic).toContain('secret-request-id'); // kept for server-side debugging
  });

  it('retries transient submission errors and gives up on permanent ones', async () => {
    const { cookie, product, photo } = await setup('retries');
    provider.createCalls = 0;
    provider.createSteps = [
      async () => {
        throw providerError('rate_limited');
      },
      async () => {
        throw providerError('unavailable');
      },
    ];
    const ok = await submit(cookie, { productId: product.id, personPhotoId: photo.id });
    await ctx.app.tryOnJobs.drain();
    expect((await get(cookie, ok.json().tryOn.id)).status).toBe('ready');
    expect(provider.createCalls).toBe(3);

    provider.createCalls = 0;
    provider.createSteps = [
      async () => {
        throw providerError('invalid_input');
      },
    ];
    const photo2 = (await uploadPhoto(ctx.app, cookie)).json().photo;
    const bad = await submit(cookie, { productId: product.id, personPhotoId: photo2.id });
    await ctx.app.tryOnJobs.drain();
    expect((await get(cookie, bad.json().tryOn.id)).errorCode).toBe('generation_failed');
    expect(provider.createCalls).toBe(1);

    provider.createSteps = Array.from({ length: 3 }, () => async () => {
      throw providerError('unavailable');
    });
    const photo3 = (await uploadPhoto(ctx.app, cookie)).json().photo;
    const down = await submit(cookie, { productId: product.id, personPhotoId: photo3.id });
    await ctx.app.tryOnJobs.drain();
    expect((await get(cookie, down.json().tryOn.id)).errorCode).toBe('provider_unavailable');
  });

  it('enforces the daily generation limit', async () => {
    const local = await createTestApp({ tryOnProvider: new FakeProvider() }, { ...FAST, TRYON_DAILY_LIMIT: '2' });
    try {
      const { cookie, product, photo } = await setup('', 't_shirts', local.app);
      for (let i = 0; i < 2; i++) {
        expect((await submit(cookie, { productId: product.id, personPhotoId: photo.id }, local.app)).statusCode).toBe(202);
        await local.app.tryOnJobs.drain();
      }
      const third = await submit(cookie, { productId: product.id, personPhotoId: photo.id }, local.app);
      expect(third.statusCode).toBe(429);
      expect(third.json().error.code).toBe('DAILY_LIMIT');
      const info = (await local.app.inject({ method: 'GET', url: '/api/try-ons/provider', headers: { cookie } })).json();
      expect(info.limits).toEqual({ dailyLimit: 2, usedToday: 2, maxActive: 2 });
    } finally {
      await local.close();
    }
  });

  it('requires consent before sending photos to an external provider', async () => {
    const external = new FakeProvider();
    external.metadata = { ...external.metadata, external: true };
    const local = await createTestApp({ tryOnProvider: external }, FAST);
    try {
      const { cookie, product, photo } = await setup('', 't_shirts', local.app);
      const info = (await local.app.inject({ method: 'GET', url: '/api/try-ons/provider', headers: { cookie } })).json();
      expect(info.disclosure).toMatch(/third-party AI service/);
      const noConsent = await submit(cookie, { productId: product.id, personPhotoId: photo.id }, local.app);
      expect(noConsent.json().error.code).toBe('CONSENT_REQUIRED');
      expect((await submit(cookie, { productId: product.id, personPhotoId: photo.id, acknowledgeThirdParty: true }, local.app)).statusCode).toBe(202);
      await local.app.tryOnJobs.drain();
    } finally {
      await local.close();
    }
  });

  it('resumes processing jobs after a restart', async () => {
    const { cookie, product, photo } = await setup('recover');
    provider.hang();
    const res = await submit(cookie, { productId: product.id, personPhotoId: photo.id });
    await new Promise((r) => setTimeout(r, 50));
    expect((await get(cookie, res.json().tryOn.id)).status).toBe('processing');
    await ctx.app.tryOnJobs.stop(); // simulate shutdown: polling stops, job stays "processing"
    (ctx.app.tryOnJobs as unknown as { stopping: boolean }).stopping = false;
    provider.statusSteps = [];
    await ctx.app.tryOnJobs.recover();
    await ctx.app.tryOnJobs.drain();
    expect((await get(cookie, res.json().tryOn.id)).status).toBe('ready');
  });
});

describe('results and saved looks', () => {
  it('saves, lists and removes looks; deleting a result removes its image and look', async () => {
    const { cookie, product, photo } = await setup('looks');
    const res = await submit(cookie, { productId: product.id, personPhotoId: photo.id });
    await ctx.app.tryOnJobs.drain();
    const tryOn = await get(cookie, res.json().tryOn.id);

    const save = await ctx.app.inject({ method: 'POST', url: '/api/saved-looks', headers: { cookie }, payload: { tryOnResultId: tryOn.id } });
    expect(save.statusCode).toBe(201);
    const again = await ctx.app.inject({ method: 'POST', url: '/api/saved-looks', headers: { cookie }, payload: { tryOnResultId: tryOn.id } });
    expect(again.json().look.id).toBe(save.json().look.id);
    const list = (await ctx.app.inject({ method: 'GET', url: '/api/saved-looks', headers: { cookie } })).json().looks;
    expect(list).toHaveLength(1);
    expect(list[0].tryOn).toMatchObject({ id: tryOn.id, savedLookId: save.json().look.id });

    const other = await user('looks-other');
    expect((await ctx.app.inject({ method: 'POST', url: '/api/saved-looks', headers: { cookie: other.cookie }, payload: { tryOnResultId: tryOn.id } })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'DELETE', url: `/api/saved-looks/${save.json().look.id}`, headers: { cookie: other.cookie } })).statusCode).toBe(404);

    const before = ctx.storage.files.size;
    expect((await ctx.app.inject({ method: 'DELETE', url: `/api/try-ons/${tryOn.id}`, headers: { cookie } })).statusCode).toBe(204);
    expect(ctx.storage.files.size).toBe(before - 1);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/saved-looks', headers: { cookie } })).json().looks).toEqual([]);
  });

  it('only saves completed results', async () => {
    const { cookie, product, photo } = await setup('looks-pending');
    provider.hang();
    const res = await submit(cookie, { productId: product.id, personPhotoId: photo.id });
    const save = await ctx.app.inject({ method: 'POST', url: '/api/saved-looks', headers: { cookie }, payload: { tryOnResultId: res.json().tryOn.id } });
    expect(save.statusCode).toBe(409);
    await ctx.app.inject({ method: 'DELETE', url: `/api/try-ons/${res.json().tryOn.id}`, headers: { cookie } });
    provider.statusSteps = [];
    await ctx.app.tryOnJobs.drain();
  });
});

describe('mock provider', () => {
  it('labels results as mock in metadata and in the image itself', async () => {
    const local = await createTestApp({ tryOnProvider: new MockVirtualTryOnProvider(0) }, FAST);
    try {
      const { cookie, product, photo } = await setup('', 'dresses', local.app);
      const info = (await local.app.inject({ method: 'GET', url: '/api/try-ons/provider', headers: { cookie } })).json();
      expect(info).toMatchObject({ provider: 'mock', source: 'mock', external: false, disclosure: null });
      const res = await submit(cookie, { productId: product.id, personPhotoId: photo.id }, local.app);
      await local.app.tryOnJobs.drain();
      const t = await get(cookie, res.json().tryOn.id, local.app);
      expect(t).toMatchObject({ status: 'ready', source: 'mock', provider: 'mock', modelVersion: 'mock-composite-0.1' });
      expect(MOCK_TRY_ON_NOTICE).toMatch(/NOT generated by AI/);
    } finally {
      await local.close();
    }
  });
});
