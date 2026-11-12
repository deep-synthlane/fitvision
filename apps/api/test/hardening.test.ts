import { eq } from 'drizzle-orm';
import { mkdtemp, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';
import { analyticsEvents } from '../src/db/schema.js';
import { LocalDiskStorage, S3Storage } from '../src/storage/index.js';
import { startFakeS3 } from './fixtures/fakeS3.js';
import { createTestApp, registerUser, sessionCookie, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestApp({}, { AUTH_RATE_LIMIT_MAX: '1000', METRICS_TOKEN: 'metrics-token-0123456789', WEB_ORIGIN: 'https://app.example.com' });
});
afterAll(async () => {
  await ctx.close();
});

describe('sessions', () => {
  it('"sign out everywhere" revokes every existing session', async () => {
    const { cookie, payload } = await registerUser(ctx.app);
    const second = sessionCookie(await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: payload.email, password: payload.password } }));
    expect((await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: second } })).statusCode).toBe(200);
    expect((await ctx.app.inject({ method: 'POST', url: '/api/auth/logout-all', headers: { cookie } })).statusCode).toBe(204);
    for (const c of [cookie, second]) expect((await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: c } })).statusCode).toBe(401);
    // Logging in again works.
    const fresh = sessionCookie(await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: payload.email, password: payload.password } }));
    expect((await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: fresh } })).statusCode).toBe(200);
  });
});

describe('request protections and headers', () => {
  it('rejects state-changing requests from another origin', async () => {
    const { cookie } = await registerUser(ctx.app);
    const evil = await ctx.app.inject({ method: 'POST', url: '/api/auth/logout-all', headers: { cookie, origin: 'https://evil.example' } });
    expect(evil.statusCode).toBe(403);
    expect(evil.json().error.code).toBe('BAD_ORIGIN');
    const ok = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie, origin: 'https://evil.example' } });
    expect(ok.statusCode).toBe(200); // reads are fine (CORS still applies in browsers)
    const same = await ctx.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { origin: 'https://app.example.com' } });
    expect(same.statusCode).toBe(204);
  });

  it('echoes or generates request ids and sets security headers', async () => {
    const withId = await ctx.app.inject({ method: 'GET', url: '/api/health', headers: { 'x-request-id': 'trace-abc12345' } });
    expect(withId.headers['x-request-id']).toBe('trace-abc12345');
    const generated = await ctx.app.inject({ method: 'GET', url: '/api/health', headers: { 'x-request-id': 'bad id!' } });
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(withId.headers).toMatchObject({ 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' });
  });
});

describe('health, readiness and metrics', () => {
  it('reports readiness of database, storage and jobs', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ready', checks: { database: 'ok', storage: 'ok', jobs: 'ok' }, jobMode: 'inline' });
  });

  it('serves Prometheus metrics only with the token', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/metrics' })).statusCode).toBe(401);
    const res = await ctx.app.inject({ method: 'GET', url: '/api/metrics', headers: { authorization: 'Bearer metrics-token-0123456789' } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('fitvision_http_requests_total{method="GET",route="/api/ready",status="2xx"}');
    const off = await createTestApp();
    expect((await off.app.inject({ method: 'GET', url: '/api/metrics' })).statusCode).toBe(404);
    await off.close();
  });
});

describe('analytics', () => {
  it('records funnel events pseudonymously with only allow-listed properties', async () => {
    const { cookie, res } = await registerUser(ctx.app);
    const userId = res.json().user.id;
    await ctx.app.inject({
      method: 'PUT',
      url: '/api/profile',
      headers: { cookie },
      payload: { name: 'A', birthYear: null, clothingPreference: 'unisex', heightCm: 170, weightKg: 70, country: 'IN', measurementUnit: 'metric' },
    });
    expect((await ctx.app.inject({ method: 'POST', url: '/api/analytics/events', headers: { cookie }, payload: { name: 'scan_started' } })).statusCode).toBe(204);
    expect((await ctx.app.inject({ method: 'POST', url: '/api/analytics/events', headers: { cookie }, payload: { name: 'try_on_completed' } })).statusCode).toBe(400);
    await new Promise((r) => setTimeout(r, 30));
    const subject = ctx.app.analytics.subject(userId);
    const rows = await ctx.db.select().from(analyticsEvents).where(eq(analyticsEvents.subject, subject));
    expect(rows.map((r) => r.name).sort()).toEqual(['onboarding_completed', 'scan_started']);
    expect(subject).not.toContain(userId);
    expect(JSON.stringify(rows)).not.toMatch(/170|heightCm|@example/);
  });
});

describe('configuration safety', () => {
  const prod = {
    NODE_ENV: 'production',
    APP_ENV: 'production',
    JWT_SECRET: 'x'.repeat(40),
    DATABASE_URL: 'postgres://u:p@db:5432/fitvision',
    STORAGE_DRIVER: 's3',
    S3_BUCKET: 'b',
    S3_ACCESS_KEY_ID: 'k',
    S3_SECRET_ACCESS_KEY: 's',
    WEB_ORIGIN: 'https://app.example.com',
    TRYON_PROVIDER: 'replicate',
    REPLICATE_API_TOKEN: 't',
    REPLICATE_MODEL_VERSION: 'v',
  };
  it('accepts a complete production configuration (provider unverified by default)', () => {
    const c = loadConfig(prod);
    expect(c).toMatchObject({ deployed: true, appEnv: 'production', tryOn: { provider: 'replicate', verified: false }, storage: { driver: 's3' } });
    expect(loadConfig({ ...prod, TRYON_PROVIDER_VERIFIED: 'true' }).tryOn.verified).toBe(true);
  });
  it.each([
    ['missing JWT secret', { JWT_SECRET: undefined }, /JWT_SECRET/],
    ['PGlite in production', { DATABASE_URL: undefined }, /DATABASE_URL/],
    ['local disk media', { STORAGE_DRIVER: 'local' }, /STORAGE_DRIVER=s3/],
    ['weak bcrypt', { BCRYPT_ROUNDS: '8' }, /BCRYPT_ROUNDS/],
    ['implicit provider', { TRYON_PROVIDER: undefined }, /TRYON_PROVIDER must be set/],
    ['mock without opt-in', { TRYON_PROVIDER: 'mock' }, /TRYON_ALLOW_MOCK/],
    ['dev import exception', { IMPORT_ALLOW_HOSTS: '127.0.0.1:4555' }, /IMPORT_ALLOW_HOSTS/],
    ['http origin', { WEB_ORIGIN: 'http://app.example.com' }, /https/],
    ['APP_ENV missing', { APP_ENV: undefined }, /APP_ENV/],
  ])('refuses %s', (_label, overrides, message) => {
    expect(() => loadConfig({ ...prod, ...overrides })).toThrow(ConfigError);
    expect(() => loadConfig({ ...prod, ...overrides })).toThrow(message);
  });
  it('applies the same checks to staging', () => {
    expect(() => loadConfig({ ...prod, APP_ENV: 'staging', DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });
});

describe('storage', () => {
  it('local disk: deletes by prefix and rejects traversal', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'fv-storage-'));
    const s = new LocalDiskStorage(dir);
    await s.put('scans/u1/a/front.jpg', Buffer.from('1'));
    await s.put('scans/u2/b/front.jpg', Buffer.from('2'));
    await s.deletePrefix('scans/u1/');
    expect(await s.get('scans/u1/a/front.jpg')).toBeNull();
    expect((await s.get('scans/u2/b/front.jpg'))?.toString()).toBe('2');
    await expect(s.put('../escape.jpg', Buffer.from('x'))).rejects.toThrow(/Invalid storage key/);
    await expect(s.deletePrefix('')).rejects.toThrow(/Invalid storage prefix/);
    await expect(s.deletePrefix('scans/../')).rejects.toThrow(/Invalid storage prefix/);
    expect(await readdir(path.join(dir, 'scans'))).toEqual(['u2']);
  });

  it('S3: put/get/delete/deletePrefix against an S3-compatible server', async () => {
    const s3 = await startFakeS3();
    try {
      const s = new S3Storage({ bucket: 'media', region: 'auto', endpoint: s3.endpoint, accessKeyId: 'k', secretAccessKey: 's', keyPrefix: 'test/', forcePathStyle: true });
      await s.put('tryons/u1/r1.webp', Buffer.from('image-1'));
      await s.put('tryons/u1/r2.webp', Buffer.from('image-2'));
      await s.put('tryons/u2/r3.webp', Buffer.from('image-3'));
      expect((await s.get('tryons/u1/r1.webp'))?.toString()).toBe('image-1');
      expect(s3.objects.has('media/test/tryons/u1/r1.webp')).toBe(true);
      expect(await s.get('tryons/u1/missing.webp')).toBeNull();
      await s.delete('tryons/u1/r1.webp');
      await s.deletePrefix('tryons/u1/');
      expect([...s3.objects.keys()]).toEqual(['media/test/tryons/u2/r3.webp']);
    } finally {
      await s3.close();
    }
  });
});
