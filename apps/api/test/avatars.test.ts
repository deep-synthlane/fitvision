import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AvatarGenerator } from '../src/avatar/generator.js';
import { readGlbJson } from '../src/avatar/glb.js';
import { SCAN_JPEG } from './fixtures/images.js';
import { createTestApp, registerUser, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.close();
});

const profile = {
  name: 'Avatar Tester',
  birthYear: null,
  clothingPreference: 'womenswear',
  heightCm: 165,
  weightKg: 58,
  country: 'IN',
  measurementUnit: 'metric',
};
const measurements = { heightCm: 165, chestCm: 88, waistCm: 70, hipsCm: 96, shoulderCm: null, inseamCm: 76, armLengthCm: null };

async function onboardedUser(app = ctx.app) {
  const { cookie } = await registerUser(app);
  await app.inject({ method: 'PUT', url: '/api/profile', headers: { cookie }, payload: profile });
  return cookie;
}
const saveMeasurements = (cookie: string, values = measurements, app = ctx.app) =>
  app.inject({ method: 'POST', url: '/api/measurements', headers: { cookie }, payload: values });
const current = async (cookie: string, app = ctx.app) =>
  (await app.inject({ method: 'GET', url: '/api/avatars/current', headers: { cookie } })).json();
const generate = (cookie: string, app = ctx.app) => app.inject({ method: 'POST', url: '/api/avatars', headers: { cookie } });

describe('avatars', () => {
  it('requires auth and saved measurements', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/avatars/current' })).statusCode).toBe(401);
    const cookie = await onboardedUser();
    expect(await current(cookie)).toEqual({ avatar: null, outdated: false, canGenerate: false });
    const res = await generate(cookie);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('NO_MEASUREMENTS');
  });

  it('generates pending → ready from the latest snapshot and stores the versions used', async () => {
    const cookie = await onboardedUser();
    const saved = (await saveMeasurements(cookie)).json().measurements;

    const started = await generate(cookie);
    expect(started.statusCode).toBe(202);
    expect(started.json().avatar).toMatchObject({ status: 'pending', measurementId: saved.id, assetUrl: null });
    await ctx.app.avatarJobs.drain();
    const { avatar, outdated } = await current(cookie);
    expect(outdated).toBe(false);
    expect(avatar).toMatchObject({
      status: 'ready',
      avatarType: 'parametric_mannequin',
      modelVersion: 'parametric-mannequin-0.1',
      measurementId: saved.id,
      bodyScanId: null,
    });
    expect(avatar.parameters.inputs.values).toMatchObject({ heightCm: 165, chestCm: 88, inseamCm: 76, shoulderCm: null });
    expect(avatar.parameters.resolved.shoulderCm.source).toBe('default');
    expect(Math.abs(avatar.parameters.fidelity.waistErrorPct)).toBeLessThan(0.5);

    const asset = await ctx.app.inject({ method: 'GET', url: avatar.assetUrl, headers: { cookie } });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['content-type']).toBe('model/gltf-binary');
    expect(asset.headers['cache-control']).toBe('private, no-store');
    expect((readGlbJson(asset.rawPayload).json.asset as { version: string }).version).toBe('2.0');

    const preview = await ctx.app.inject({ method: 'GET', url: avatar.previewUrl, headers: { cookie } });
    expect(preview.headers['content-type']).toBe('image/svg+xml');
    expect(preview.headers['content-security-policy']).toContain('sandbox');
  });

  it('keeps avatar files private to their owner', async () => {
    const owner = await onboardedUser();
    const other = await onboardedUser();
    await saveMeasurements(owner);
    await generate(owner);
    await ctx.app.avatarJobs.drain();
    const { avatar } = await current(owner);

    expect((await ctx.app.inject({ method: 'GET', url: avatar.assetUrl })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: 'GET', url: avatar.assetUrl, headers: { cookie: other } })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'DELETE', url: `/api/avatars/${avatar.id}`, headers: { cookie: other } })).statusCode).toBe(404);
  });

  it('flags the avatar as outdated when measurements or height change, and regeneration replaces it', async () => {
    const cookie = await onboardedUser();
    await saveMeasurements(cookie);
    await generate(cookie);
    await ctx.app.avatarJobs.drain();
    const first = (await current(cookie)).avatar;

    await saveMeasurements(cookie, { ...measurements, waistCm: 74 });
    expect((await current(cookie)).outdated).toBe(true);

    await generate(cookie);
    await ctx.app.avatarJobs.drain();
    const after = await current(cookie);
    expect(after.outdated).toBe(false);
    expect(after.avatar.id).not.toBe(first.id);
    expect(after.avatar.parameters.inputs.values.waistCm).toBe(74);
    // The old avatar and its files are gone.
    expect((await ctx.app.inject({ method: 'GET', url: first.assetUrl, headers: { cookie } })).statusCode).toBe(404);

    await ctx.app.inject({ method: 'PUT', url: '/api/profile', headers: { cookie }, payload: { ...profile, heightCm: 168 } });
    expect((await current(cookie)).outdated).toBe(true);
  });

  it('deletes an avatar and its files', async () => {
    const cookie = await onboardedUser();
    await saveMeasurements(cookie);
    await generate(cookie);
    await ctx.app.avatarJobs.drain();
    const { avatar } = await current(cookie);
    const files = ctx.storage.files.size;

    const del = await ctx.app.inject({ method: 'DELETE', url: `/api/avatars/${avatar.id}`, headers: { cookie } });
    expect(del.statusCode).toBe(204);
    expect(ctx.storage.files.size).toBe(files - 2);
    expect((await current(cookie)).avatar).toBeNull();
  });

  it('keeps the avatar when the body scan it came from is deleted', async () => {
    const cookie = await onboardedUser();
    const JPEG = SCAN_JPEG;
    const fd = new FormData();
    fd.append('front', new Blob([JPEG]), 'front.jpg');
    fd.append('side', new Blob([JPEG]), 'side.jpg');
    fd.append(
      'data',
      JSON.stringify({
        scan: {
          processingVersion: 'test',
          estimates: { chestCm: { valueCm: 88, confidence: 0.8 } },
          proportions: { shoulderToHipRatio: null, waistToHipRatio: null, legToHeightRatio: null, bodyShape: null },
        },
        measurements,
      }),
    );
    const scan = (await ctx.app.inject({ method: 'POST', url: '/api/scans', headers: { cookie }, payload: fd })).json().scan;
    await generate(cookie);
    await ctx.app.avatarJobs.drain();
    expect((await current(cookie)).avatar.bodyScanId).toBe(scan.id);

    await ctx.app.inject({ method: 'DELETE', url: `/api/scans/${scan.id}`, headers: { cookie } });
    const { avatar } = await current(cookie);
    expect(avatar).toMatchObject({ status: 'ready', bodyScanId: null });
    expect((await ctx.app.inject({ method: 'GET', url: avatar.assetUrl, headers: { cookie } })).statusCode).toBe(200);
  });
});

describe('avatar job concurrency', () => {
  it('runs at most one generation per user; repeat requests return the job in progress', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const real = new (await import('../src/avatar/generator.js')).ParametricAvatarGenerator();
    const slow: AvatarGenerator = {
      avatarType: real.avatarType,
      modelVersion: real.modelVersion,
      generate: async (inputs) => {
        await gate;
        return real.generate(inputs);
      },
    };
    const local = await createTestApp({ avatarGenerator: slow });
    try {
      const cookie = await onboardedUser(local.app);
      await saveMeasurements(cookie, measurements, local.app);
      const [a, b] = await Promise.all([generate(cookie, local.app), generate(cookie, local.app)]);
      expect(a.json().avatar.id).toBe(b.json().avatar.id);
      await new Promise((r) => setTimeout(r, 20));
      expect((await current(cookie, local.app)).avatar.status).toBe('processing');
      expect((await generate(cookie, local.app)).json().avatar.id).toBe(a.json().avatar.id);
      release();
      await local.app.avatarJobs.drain();
      expect((await current(cookie, local.app)).avatar.status).toBe('ready');
    } finally {
      release();
      await local.close();
    }
  });
});

describe('avatar generation failures', () => {
  it('marks the job failed, stores no files, and keeps the previous avatar until a retry succeeds', async () => {
    let fail = false;
    const real = new (await import('../src/avatar/generator.js')).ParametricAvatarGenerator();
    const flaky: AvatarGenerator = {
      avatarType: real.avatarType,
      modelVersion: real.modelVersion,
      generate: async (inputs) => {
        if (fail) throw new Error('engine unavailable');
        return real.generate(inputs);
      },
    };
    const local = await createTestApp({ avatarGenerator: flaky });
    try {
      const cookie = await onboardedUser(local.app);
      await saveMeasurements(cookie, measurements, local.app);
      await generate(cookie, local.app);
      await local.app.avatarJobs.drain();
      const good = (await current(cookie, local.app)).avatar;
      const files = local.storage.files.size;

      fail = true;
      await generate(cookie, local.app);
      await local.app.avatarJobs.drain();
      const failed = (await current(cookie, local.app)).avatar;
      expect(failed).toMatchObject({ status: 'failed', assetUrl: null });
      expect(failed.error).toMatch(/couldn’t generate/);
      expect(local.storage.files.size).toBe(files);
      expect((await local.app.inject({ method: 'GET', url: good.assetUrl, headers: { cookie } })).statusCode).toBe(200);

      fail = false;
      await generate(cookie, local.app);
      await local.app.avatarJobs.drain();
      expect((await current(cookie, local.app)).avatar.status).toBe('ready');
      expect(local.storage.files.size).toBe(files); // old avatar replaced, failed attempt cleaned up
    } finally {
      await local.close();
    }
  });
});
