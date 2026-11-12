import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AVATAR_TRY_ON_MISSING } from '@fitvision/shared';
import { productImages, tryOnPhotos, tryOnResults } from '../src/db/schema.js';
import { AVATAR_RENDER_SIZE, renderAvatarFront } from '../src/avatar/render.js';
import { ParametricAvatarGenerator } from '../src/avatar/generator.js';
import { looksUnchanged } from '../src/modules/tryon/jobs.js';
import { MockVirtualTryOnProvider } from '../src/tryon/mockProvider.js';
import type { TryOnRequest } from '../src/tryon/provider.js';
import { FakeProvider, createProduct, personPhoto, suitability, uploadPhoto } from './fixtures/tryon.js';
import { createTestApp, registerUser, type TestContext } from './helpers.js';

const FAST = { AUTH_RATE_LIMIT_MAX: '1000', TRYON_POLL_MS: '10', TRYON_TIMEOUT_MS: '2000', TRYON_MAX_ACTIVE: '5', TRYON_DAILY_LIMIT: '50' };
const PROFILE = { name: 'Avatar Tester', birthYear: null, clothingPreference: 'womenswear', heightCm: 168, weightKg: 62, country: 'IN', measurementUnit: 'metric' };
const MEASUREMENTS = { heightCm: 168, chestCm: 90, waistCm: 72, hipsCm: 98, shoulderCm: null, inseamCm: null, armLengthCm: null };

let ctx: TestContext;
let provider: FakeProvider;
beforeAll(async () => {
  provider = new FakeProvider();
  ctx = await createTestApp({ tryOnProvider: provider }, FAST);
});
afterAll(async () => {
  await ctx.close();
});

const inject = (cookie: string, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) =>
  ctx.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

async function userWithAvatar() {
  const u = await registerUser(ctx.app);
  await inject(u.cookie, 'POST', '/api/measurements', MEASUREMENTS);
  await ctx.app.inject({ method: 'PUT', url: '/api/profile', headers: { cookie: u.cookie }, payload: PROFILE });
  await inject(u.cookie, 'POST', '/api/avatars');
  await ctx.app.avatarJobs.drain();
  const avatar = (await inject(u.cookie, 'GET', '/api/avatars/current')).json().avatar;
  expect(avatar.status).toBe('ready');
  return { ...u, avatar };
}

const waitReady = async (cookie: string, id: string) => {
  for (let i = 0; i < 200; i++) {
    const t = (await inject(cookie, 'GET', `/api/try-ons/${id}`)).json().tryOn;
    if (t.status !== 'pending' && t.status !== 'processing') return t;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('try-on did not finish');
};

/** Runs of non-background pixels along a row of a rendered PNG. */
async function rowSegments(png: Buffer, yFraction: number) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const y = Math.round(info.height * yFraction);
  let runs = 0;
  let inside = false;
  for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * info.channels;
    const body = Math.abs(data[i]! - 242) + Math.abs(data[i + 1]! - 242) + Math.abs(data[i + 2]! - 240) > 12;
    if (body && !inside) runs++;
    inside = body;
  }
  return runs;
}

describe('avatar renderer', () => {
  it('renders a clean front view: neutral background, standing figure, arms clear of the torso', async () => {
    const { asset } = await new ParametricAvatarGenerator().generate({ measurementId: 'm', clothingPreference: 'womenswear', values: { ...MEASUREMENTS, shoulderCm: null } });
    const full = await renderAvatarFront(asset.data, 'full_body');
    const upper = await renderAvatarFront(asset.data, 'upper_body');
    for (const png of [full, upper]) {
      const meta = await sharp(png).metadata();
      expect([meta.width, meta.height]).toEqual([AVATAR_RENDER_SIZE.width, AVATAR_RENDER_SIZE.height]);
      const { data } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
      expect([...data.subarray(0, 3)]).toEqual([242, 242, 240]); // background corner
    }
    // Upper-body framing at waist level: arm, torso, arm as separate shapes.
    expect(await rowSegments(upper, 0.6)).toBe(3);
    // Full-body framing: feet are inside the frame, with background below them.
    expect(await rowSegments(full, 0.995)).toBe(0);
    expect(await rowSegments(full, 0.94)).toBe(2);
    // Deterministic.
    expect((await renderAvatarFront(asset.data, 'full_body')).equals(full)).toBe(true);
  });
});

describe('avatar try-on', () => {
  it('without a ready avatar, explains that one is needed', async () => {
    const u = await registerUser(ctx.app);
    const product = await createProduct(ctx.app, u.cookie, 't_shirts');
    const res = await inject(u.cookie, 'POST', '/api/try-on-photos/avatar-render', { productId: product.id });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: 'AVATAR_REQUIRED', message: AVATAR_TRY_ON_MISSING });
  });

  it('renders the avatar, sends it to the provider as the person image and records the source', async () => {
    const u = await userWithAvatar();
    const shirt = await createProduct(ctx.app, u.cookie, 't_shirts');
    const render = await inject(u.cookie, 'POST', '/api/try-on-photos/avatar-render', { productId: shirt.id });
    expect(render.statusCode).toBe(201);
    const photo = render.json().photo;
    expect(photo).toMatchObject({ source: 'avatar_render', avatarId: u.avatar.id, avatarModelVersion: u.avatar.modelVersion });
    expect(photo.suitability.regions).toEqual({ upper_body: true, lower_body: false, full_body: false });

    // Same avatar and framing → the stored render is reused.
    const again = await inject(u.cookie, 'POST', '/api/try-on-photos/avatar-render', { productId: shirt.id });
    expect(again.statusCode).toBe(200);
    expect(again.json().photo.id).toBe(photo.id);
    // Renders aren't listed with the user's own photos.
    expect((await inject(u.cookie, 'GET', '/api/try-on-photos')).json().photos).toEqual([]);

    const before = provider.requests.length;
    const created = await inject(u.cookie, 'POST', '/api/try-ons', { productId: shirt.id, personPhotoId: photo.id, idempotencyKey: randomUUID() });
    expect(created.statusCode).toBe(202);
    const done = await waitReady(u.cookie, created.json().tryOn.id);
    expect(done).toMatchObject({ status: 'ready', personSource: 'avatar_render', avatarId: u.avatar.id, avatarModelVersion: 'parametric-mannequin-0.1' });

    const sent = provider.requests[before]!;
    const stored = (await inject(u.cookie, 'GET', photo.imageUrl)).rawPayload;
    expect(sent.personImage.data.equals(stored)).toBe(true);
    expect(sent.region).toBe('upper_body');
    const [row] = await ctx.db.select().from(tryOnResults).where(eq(tryOnResults.id, done.id));
    expect(row).toMatchObject({ personSource: 'avatar_render', avatarId: u.avatar.id, avatarModelVersion: 'parametric-mannequin-0.1' });
  });

  it('frames the whole body for dresses and trousers, and refuses the upper-body render for them', async () => {
    const u = await userWithAvatar();
    const shirt = await createProduct(ctx.app, u.cookie, 't_shirts');
    const dress = await createProduct(ctx.app, u.cookie, 'dresses');
    const upper = (await inject(u.cookie, 'POST', '/api/try-on-photos/avatar-render', { productId: shirt.id })).json().photo;
    const full = (await inject(u.cookie, 'POST', '/api/try-on-photos/avatar-render', { productId: dress.id })).json().photo;
    expect(full.id).not.toBe(upper.id);
    expect(full.suitability.regions).toEqual({ upper_body: true, lower_body: true, full_body: true });
    const wrong = await inject(u.cookie, 'POST', '/api/try-ons', { productId: dress.id, personPhotoId: upper.id, idempotencyKey: randomUUID() });
    expect(wrong.statusCode).toBe(422);
    expect(wrong.json().error.fields.reason).toMatch(/avatar image/);
  });

  it('records uploaded, camera and saved photo sources; renders are private and removed with the avatar', async () => {
    const u = await userWithAvatar();
    const shirt = await createProduct(ctx.app, u.cookie, 't_shirts');
    const uploaded = (await uploadPhoto(ctx.app, u.cookie)).json().photo;
    expect(uploaded.source).toBe('uploaded_photo');
    const fd = new FormData();
    fd.append('photo', new Blob([await personPhoto()]), 'cam.jpg');
    fd.append('origin', 'camera_photo');
    fd.append('suitability', JSON.stringify(suitability()));
    const camera = (await ctx.app.inject({ method: 'POST', url: '/api/try-on-photos', headers: { cookie: u.cookie }, payload: fd })).json().photo;
    expect(camera.source).toBe('camera_photo');
    const forged = new FormData();
    forged.append('origin', 'avatar_render');
    forged.append('photo', new Blob([await personPhoto()]), 'x.jpg');
    forged.append('suitability', JSON.stringify(suitability()));
    expect((await ctx.app.inject({ method: 'POST', url: '/api/try-on-photos', headers: { cookie: u.cookie }, payload: forged })).statusCode).toBe(400);

    const start = async (photoId: string) => {
      const res = await inject(u.cookie, 'POST', '/api/try-ons', { productId: shirt.id, personPhotoId: photoId, idempotencyKey: randomUUID() });
      return waitReady(u.cookie, res.json().tryOn.id);
    };
    expect((await start(uploaded.id)).personSource).toBe('uploaded_photo');
    expect((await start(camera.id)).personSource).toBe('camera_photo');
    expect((await start(uploaded.id)).personSource).toBe('saved_photo');

    // Another user can't see the render.
    const render = (await inject(u.cookie, 'POST', '/api/try-on-photos/avatar-render', { productId: shirt.id })).json().photo;
    const other = await registerUser(ctx.app);
    expect((await inject(other.cookie, 'GET', render.imageUrl)).statusCode).toBe(404);
    const avatarResult = await start(render.id);

    // Deleting the avatar deletes its renders; the result keeps its avatar model version snapshot.
    expect((await inject(u.cookie, 'DELETE', `/api/avatars/${u.avatar.id}`)).statusCode).toBe(204);
    expect((await inject(u.cookie, 'GET', render.imageUrl)).statusCode).toBe(404);
    const [photoRow] = await ctx.db.select().from(tryOnPhotos).where(eq(tryOnPhotos.id, render.id));
    expect(photoRow!.deletedAt).not.toBeNull();
    const after = (await inject(u.cookie, 'GET', `/api/try-ons/${avatarResult.id}`)).json().tryOn;
    expect(after).toMatchObject({ personSource: 'avatar_render', avatarId: null, avatarModelVersion: 'parametric-mannequin-0.1', personPhotoUrl: null });
    expect((await inject(u.cookie, 'POST', '/api/try-on-photos/avatar-render', { productId: shirt.id })).statusCode).toBe(409);
  });
});

/** The real mock provider, recording what it was given. */
class RecordingMockProvider extends MockVirtualTryOnProvider {
  requests: TryOnRequest[] = [];
  override async createTryOn(request: TryOnRequest) {
    this.requests.push(request);
    return super.createTryOn(request);
  }
}

describe('avatar try-on pipeline (mock provider)', () => {
  let mctx: TestContext;
  let mock: RecordingMockProvider;
  beforeAll(async () => {
    mock = new RecordingMockProvider(0);
    mctx = await createTestApp({ tryOnProvider: mock }, FAST);
  });
  afterAll(async () => {
    await mctx.close();
  });

  it('avatar render + garment go to the provider separately; the stored result is the generated output', async () => {
    const call = (cookie: string, method: 'GET' | 'POST', url: string, payload?: object) =>
      mctx.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
    const u = await registerUser(mctx.app);
    await call(u.cookie, 'POST', '/api/measurements', MEASUREMENTS);
    await mctx.app.inject({ method: 'PUT', url: '/api/profile', headers: { cookie: u.cookie }, payload: PROFILE });
    await call(u.cookie, 'POST', '/api/avatars');
    await mctx.app.avatarJobs.drain();
    const shirt = await createProduct(mctx.app, u.cookie, 'shirts');
    const render = (await call(u.cookie, 'POST', '/api/try-on-photos/avatar-render', { productId: shirt.id })).json().photo;

    const created = await call(u.cookie, 'POST', '/api/try-ons', { productId: shirt.id, personPhotoId: render.id, idempotencyKey: randomUUID() });
    let tryOn = created.json().tryOn;
    for (let i = 0; i < 200 && (tryOn.status === 'pending' || tryOn.status === 'processing'); i++) {
      await new Promise((r) => setTimeout(r, 10));
      tryOn = (await call(u.cookie, 'GET', `/api/try-ons/${tryOn.id}`)).json().tryOn;
    }
    expect(tryOn.status).toBe('ready');

    // 1. Person image = the avatar render; garment image supplied separately; category → region.
    const request = mock.requests.at(-1)!;
    const avatarBytes = (await call(u.cookie, 'GET', render.imageUrl)).rawPayload;
    const [garmentRow] = await mctx.db.select().from(productImages).where(eq(productImages.id, shirt.tryOnImageId));
    const garmentBytes = await mctx.storage.get(garmentRow!.imagePath);
    expect(request.personImage.data.equals(avatarBytes)).toBe(true);
    expect(request.garmentImage.data.equals(garmentBytes!)).toBe(true);
    expect(request.garmentImage.data.equals(request.personImage.data)).toBe(false);
    expect(request.region).toBe('upper_body');
    expect(request.garmentDescription).toContain('shirts');

    // 2. The stored output is a different file from the avatar input…
    const [row] = await mctx.db.select().from(tryOnResults).where(eq(tryOnResults.id, tryOn.id));
    const [renderRow] = await mctx.db.select().from(tryOnPhotos).where(eq(tryOnPhotos.id, render.id));
    expect(row!.resultImagePath).toBe(`tryons/${row!.userId}/${tryOn.id}.webp`);
    expect(row!.resultImagePath).not.toBe(renderRow!.imagePath);

    // 3. …the result URL serves that output, and it visibly differs from the avatar (garment + watermark).
    expect(tryOn.resultImageUrl).toBe(`/api/try-ons/${tryOn.id}/image`);
    expect(tryOn.resultImageUrl).not.toBe(tryOn.personPhotoUrl);
    const output = (await call(u.cookie, 'GET', tryOn.resultImageUrl)).rawPayload;
    expect(output.equals((await mctx.storage.get(row!.resultImagePath!))!)).toBe(true);
    expect(await looksUnchanged(output, avatarBytes)).toBe(false);
    const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
    const [r, g, b] = px(Math.round(info.width / 2), 8); // watermark band
    expect(r).toBeGreaterThan(150);
    expect(b).toBeLessThan(60);
    expect(g).toBeLessThan(120);
    let garmentPixels = 0; // the fixture garment is blue (#2563eb)
    for (let i = 0; i < data.length; i += info.channels) if (data[i + 2]! > 180 && data[i]! < 90) garmentPixels++;
    expect(garmentPixels).toBeGreaterThan(10_000);
  });
});

describe('provider output checks', () => {
  it('fails a try-on whose "result" is the person image returned unchanged', async () => {
    const u = await userWithAvatar();
    const shirt = await createProduct(ctx.app, u.cookie, 't_shirts');
    const render = (await inject(u.cookie, 'POST', '/api/try-on-photos/avatar-render', { productId: shirt.id })).json().photo;
    provider.statusSteps.push(async () => ({ state: 'ready', providerJobId: 'echo', image: { data: provider.requests.at(-1)!.personImage.data } }));
    const created = await inject(u.cookie, 'POST', '/api/try-ons', { productId: shirt.id, personPhotoId: render.id, idempotencyKey: randomUUID() });
    const done = await waitReady(u.cookie, created.json().tryOn.id);
    expect(done).toMatchObject({ status: 'failed', errorCode: 'generation_failed', resultImageUrl: null });
    const [row] = await ctx.db.select().from(tryOnResults).where(eq(tryOnResults.id, done.id));
    expect(row!.resultImagePath).toBeNull();
    expect(row!.diagnostic).toMatch(/unchanged/);
  });
});
