import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { SCAN_JPEG, SCAN_JPEG_WITH_EXIF, SCAN_PNG } from './fixtures/images.js';
import { createTestApp, registerUser, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.close();
});

const JPEG = SCAN_JPEG;
const PNG = SCAN_PNG;

const scanOutput = {
  processingVersion: 'test-geometry-1',
  estimates: {
    shoulderCm: { valueCm: 41.5, confidence: 0.7 },
    chestCm: { valueCm: 96.2, confidence: 0.8 },
    waistCm: { valueCm: 82.4, confidence: 0.55 },
    hipsCm: { valueCm: 98.1, confidence: 0.75 },
  },
  proportions: { shoulderToHipRatio: 1.12, waistToHipRatio: 0.84, legToHeightRatio: 0.47, bodyShape: 'rectangle' },
  warnings: [],
};
const accepted = {
  heightCm: 176,
  shoulderCm: 41.5,
  chestCm: 96.2,
  waistCm: 82.4,
  hipsCm: 98.1,
  inseamCm: 80,
  armLengthCm: null,
};

function form(parts: { front?: Buffer; side?: Buffer; back?: Buffer; data?: unknown }) {
  const fd = new FormData();
  for (const view of ['front', 'side', 'back'] as const) {
    const buf = parts[view];
    if (buf) fd.append(view, new Blob([buf], { type: 'image/jpeg' }), `${view}.jpg`);
  }
  if (parts.data !== undefined) fd.append('data', JSON.stringify(parts.data));
  return fd;
}

const upload = (cookie: string, payload: FormData) =>
  ctx.app.inject({ method: 'POST', url: '/api/scans', headers: { cookie }, payload });

describe('body scans', () => {
  it('requires auth', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/scans' });
    expect(res.statusCode).toBe(401);
  });

  it('saves accepted estimates as body_scan, with scan metadata separate from results', async () => {
    const { cookie } = await registerUser(ctx.app);
    const res = await upload(cookie, form({ front: JPEG, side: JPEG, data: { scan: scanOutput, measurements: accepted } }));
    expect(res.statusCode).toBe(201);
    const { scan, measurements } = res.json();
    expect(scan).toMatchObject({ status: 'completed', views: ['front', 'side'], processingVersion: 'test-geometry-1' });
    expect(scan.completedAt).toBeTruthy();
    expect(scan.imageUrls).toEqual({ front: `/api/scans/${scan.id}/images/front`, side: `/api/scans/${scan.id}/images/side` });
    expect(measurements).toMatchObject({ source: 'body_scan', scanId: scan.id, chestCm: 96.2, inseamCm: 80 });
    expect(measurements.scanEstimates.estimates.waistCm).toEqual({ valueCm: 82.4, confidence: 0.55 });

    const current = await ctx.app.inject({ method: 'GET', url: '/api/measurements/current', headers: { cookie } });
    expect(current.json().measurements.id).toBe(measurements.id);
    expect(ctx.storage.files.size).toBe(2);
  });

  it('saves edited estimates as corrected and keeps the optional back photo', async () => {
    const { cookie } = await registerUser(ctx.app);
    const res = await upload(
      cookie,
      form({ front: JPEG, side: PNG, back: JPEG, data: { scan: scanOutput, measurements: { ...accepted, waistCm: 80 } } }),
    );
    expect(res.statusCode).toBe(201);
    expect(res.json().measurements.source).toBe('corrected');
    expect(res.json().scan.views).toEqual(['front', 'side', 'back']);

    const side = await ctx.app.inject({ method: 'GET', url: res.json().scan.imageUrls.side, headers: { cookie } });
    expect(side.statusCode).toBe(200);
    // Every scan photo is re-encoded as JPEG (metadata removed), whatever was uploaded.
    expect(side.headers['content-type']).toBe('image/jpeg');
    expect(side.headers['cache-control']).toBe('private, no-store');
    expect((await sharp(side.rawPayload).metadata()).format).toBe('jpeg');
  });

  it('strips EXIF metadata (e.g. GPS location) and rejects files that only look like images', async () => {
    const { cookie } = await registerUser(ctx.app);
    expect(SCAN_JPEG_WITH_EXIF.includes('exif-marker-should-be-removed')).toBe(true);
    const res = await upload(cookie, form({ front: SCAN_JPEG_WITH_EXIF, side: JPEG, data: { scan: scanOutput, measurements: accepted } }));
    expect(res.statusCode).toBe(201);
    const front = await ctx.app.inject({ method: 'GET', url: res.json().scan.imageUrls.front, headers: { cookie } });
    expect(front.rawPayload.includes('exif-marker-should-be-removed')).toBe(false);
    expect((await sharp(front.rawPayload).metadata()).exif).toBeUndefined();

    const fake = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 1, 2, 3, 4]);
    const bad = await upload(cookie, form({ front: fake, side: JPEG, data: { scan: scanOutput, measurements: accepted } }));
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('BAD_IMAGE');
  });

  it('serves images only to their owner', async () => {
    const owner = await registerUser(ctx.app);
    const other = await registerUser(ctx.app);
    const res = await upload(owner.cookie, form({ front: JPEG, side: JPEG, data: { scan: scanOutput, measurements: accepted } }));
    const url = res.json().scan.imageUrls.front;

    expect((await ctx.app.inject({ method: 'GET', url })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: 'GET', url, headers: { cookie: other.cookie } })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'GET', url: `/api/scans/${res.json().scan.id}`, headers: { cookie: other.cookie } })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/scans/not-a-uuid/images/front', headers: { cookie: owner.cookie } })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'GET', url, headers: { cookie: owner.cookie } })).statusCode).toBe(200);
  });

  it('rejects missing side photo, non-image files and invalid data without storing anything', async () => {
    const { cookie } = await registerUser(ctx.app);
    const before = ctx.storage.files.size;

    const noSide = await upload(cookie, form({ front: JPEG, data: { scan: scanOutput, measurements: accepted } }));
    expect(noSide.statusCode).toBe(400);
    expect(noSide.json().error.fields).toEqual({ side: 'Photo required' });

    const notImage = await upload(cookie, form({ front: Buffer.from('<svg onload=alert(1)>'), side: JPEG, data: { scan: scanOutput, measurements: accepted } }));
    expect(notImage.statusCode).toBe(400);
    expect(notImage.json().error.code).toBe('BAD_IMAGE');

    const badData = await upload(cookie, form({ front: JPEG, side: JPEG, data: { scan: scanOutput, measurements: { ...accepted, waistCm: 5 } } }));
    expect(badData.statusCode).toBe(400);
    expect(badData.json().error.fields['measurements.waistCm']).toBeDefined();

    const json = await ctx.app.inject({ method: 'POST', url: '/api/scans', headers: { cookie }, payload: { scan: scanOutput } });
    expect(json.statusCode).toBe(415);

    expect(ctx.storage.files.size).toBe(before);
  });

  it('deletes photos and the scan but keeps the measurements', async () => {
    const { cookie } = await registerUser(ctx.app);
    const res = await upload(cookie, form({ front: JPEG, side: JPEG, data: { scan: scanOutput, measurements: accepted } }));
    const { scan, measurements } = res.json();
    const before = ctx.storage.files.size;

    const del = await ctx.app.inject({ method: 'DELETE', url: `/api/scans/${scan.id}`, headers: { cookie } });
    expect(del.statusCode).toBe(204);
    expect(ctx.storage.files.size).toBe(before - 2);
    expect((await ctx.app.inject({ method: 'GET', url: scan.imageUrls.front, headers: { cookie } })).statusCode).toBe(404);

    const current = await ctx.app.inject({ method: 'GET', url: '/api/measurements/current', headers: { cookie } });
    expect(current.json().measurements).toMatchObject({ id: measurements.id, scanId: null, chestCm: 96.2 });

    const list = await ctx.app.inject({ method: 'GET', url: '/api/scans', headers: { cookie } });
    expect(list.json()).toEqual({ scans: [] });
  });
});
