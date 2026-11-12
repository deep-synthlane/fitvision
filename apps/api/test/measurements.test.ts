import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, registerUser, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.close();
});

const empty = { heightCm: null, chestCm: null, waistCm: null, hipsCm: null, shoulderCm: null, inseamCm: null, armLengthCm: null };

describe('body measurements', () => {
  it('requires auth', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/measurements/current' });
    expect(res.statusCode).toBe(401);
  });

  it('saves versions and returns the latest as current', async () => {
    const { cookie } = await registerUser(ctx.app);
    const headers = { cookie };

    const none = await ctx.app.inject({ method: 'GET', url: '/api/measurements/current', headers });
    expect(none.json()).toEqual({ measurements: null });

    const first = await ctx.app.inject({
      method: 'POST',
      url: '/api/measurements',
      headers,
      payload: { ...empty, heightCm: 176, chestCm: 96, waistCm: 82 },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().measurements).toMatchObject({ chestCm: 96, waistCm: 82, hipsCm: null, source: 'manual' });

    await ctx.app.inject({
      method: 'POST',
      url: '/api/measurements',
      headers,
      payload: { ...empty, heightCm: 176, chestCm: 97, waistCm: 82, hipsCm: 98, source: 'corrected' },
    });

    const current = await ctx.app.inject({ method: 'GET', url: '/api/measurements/current', headers });
    expect(current.json().measurements).toMatchObject({ chestCm: 97, hipsCm: 98, source: 'corrected' });

    const history = await ctx.app.inject({ method: 'GET', url: '/api/measurements', headers });
    expect(history.json().history.map((m: { chestCm: number }) => m.chestCm)).toEqual([97, 96]);
  });

  it('rejects empty submissions, out-of-range values and client-claimed scan data', async () => {
    const { cookie } = await registerUser(ctx.app);
    const post = (payload: object) => ctx.app.inject({ method: 'POST', url: '/api/measurements', headers: { cookie }, payload });

    const blank = await post(empty);
    expect(blank.statusCode).toBe(400);
    expect(blank.json().error.fields._).toBe('Enter at least one measurement');

    const range = await post({ ...empty, waistCm: 5, shoulderCm: 500 });
    expect(Object.keys(range.json().error.fields).sort()).toEqual(['shoulderCm', 'waistCm']);

    const scan = await post({ ...empty, chestCm: 96, source: 'body_scan' });
    expect(scan.statusCode).toBe(400);
  });

  it('keeps measurements isolated per user', async () => {
    const a = await registerUser(ctx.app);
    const b = await registerUser(ctx.app);
    await ctx.app.inject({ method: 'POST', url: '/api/measurements', headers: { cookie: a.cookie }, payload: { ...empty, chestCm: 90 } });
    const res = await ctx.app.inject({ method: 'GET', url: '/api/measurements', headers: { cookie: b.cookie } });
    expect(res.json()).toEqual({ history: [] });
  });
});
