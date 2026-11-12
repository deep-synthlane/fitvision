/**
 * Demo data for local development and demos only (`pnpm --filter @fitvision/api seed`).
 *
 * - Refuses to run in staging/production.
 * - Goes through the real API routes (validation, storage, size engine), not direct inserts.
 * - Everything is labelled as demo data; the try-on provider stays whatever is configured (mock by default).
 * - The password is random unless DEMO_PASSWORD is set, and is printed once.
 */
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { buildApp } from './app.js';
import { openDb } from './db/client.js';
import { createStorage, loadConfigOrExit } from './runtime.js';

const DEMO_EMAIL = process.env.DEMO_EMAIL ?? 'demo@fitvision.local';
const config = loadConfigOrExit();
if (config.deployed) {
  console.error(`Refusing to seed demo data into ${config.appEnv}.`);
  process.exit(1);
}

const password = process.env.DEMO_PASSWORD ?? randomBytes(12).toString('base64url');
const { db, close } = await openDb(config);
const app = await buildApp(config, { db, storage: createStorage(config) });

try {
  const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'Demo User', email: DEMO_EMAIL, password } });
  if (reg.statusCode === 409) {
    console.error(`${DEMO_EMAIL} already exists. Delete it from the Privacy page (or use DEMO_EMAIL=...) and run again.`);
    process.exitCode = 1;
  } else {
    if (reg.statusCode !== 201) throw new Error(`register: ${reg.statusCode} ${reg.body}`);
    const cookie = reg.headers['set-cookie']!.toString().split(';')[0]!;
    const call = async (method: 'POST' | 'PUT', url: string, payload: unknown) => {
      const res = await app.inject({ method, url, payload: payload as object, headers: { cookie } });
      if (res.statusCode >= 300) throw new Error(`${method} ${url}: ${res.statusCode} ${res.body}`);
      return res.json() as Record<string, unknown>;
    };

    await call('PUT', '/api/profile', { name: 'Demo User', birthYear: null, clothingPreference: 'womenswear', heightCm: 168, weightKg: 62, country: 'IN', measurementUnit: 'metric' });
    await call('POST', '/api/measurements', { source: 'manual', heightCm: 168, chestCm: 91, waistCm: 74, hipsCm: 98, shoulderCm: 39, inseamCm: 78, armLengthCm: 58 });

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
    const chart = { unit: 'cm', kind: 'body', source: 'user', rows: [row('S', [84, 88], [66, 70], [90, 94]), row('M', [89, 94], [71, 76], [95, 100]), row('L', [95, 100], [77, 82], [101, 106])] };
    const items = [
      { name: 'Demo · Linen Shirt', category: 'shirts', color: 'White', hex: '#f8fafc', sizeChart: chart },
      { name: 'Demo · Wrap Dress', category: 'dresses', color: 'Rose', hex: '#be185d', sizeChart: chart },
      { name: 'Demo · Denim Jacket', category: 'jackets', color: 'Indigo', hex: '#1e3a8a', sizeChart: null },
    ];
    const ids: string[] = [];
    for (const item of items) {
      const png = await sharp({ create: { width: 500, height: 600, channels: 3, background: '#f4f4f4' } })
        .composite([{ input: { create: { width: 300, height: 420, channels: 3, background: item.hex } }, left: 100, top: 90 }])
        .png()
        .toBuffer();
      const fd = new FormData();
      fd.append('image0', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'demo.png');
      fd.append(
        'data',
        JSON.stringify({
          source: 'manual_upload',
          fields: { name: item.name, brand: 'FitVision Demo', category: item.category, color: item.color, sizes: ['S', 'M', 'L'], sizeChart: item.sizeChart },
          images: [{ kind: 'upload', field: 'image0', imageType: 'garment_front' }],
          tryOnImageIndex: 0,
        }),
      );
      const req = new Request('http://seed.local/', { method: 'POST', body: fd });
      const res = await app.inject({
        method: 'POST',
        url: '/api/products',
        payload: Buffer.from(await req.arrayBuffer()),
        headers: { cookie, 'content-type': req.headers.get('content-type')! },
      });
      if (res.statusCode !== 201) throw new Error(`product: ${res.statusCode} ${res.body}`);
      ids.push((res.json() as { product: { id: string } }).product.id);
    }
    const { collections } = (await call('POST', '/api/collections', { name: 'Demo · Summer' })) as { collections: { id: string }[] };
    await call('PUT', `/api/collections/${collections[0]!.id}/items/${ids[1]}`, {});

    console.log(`Demo account ready (demo data, ${config.appEnv}):\n  email:    ${DEMO_EMAIL}\n  password: ${password}`);
  }
} finally {
  await app.close();
  await close();
}
