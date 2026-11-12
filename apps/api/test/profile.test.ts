import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, registerUser, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.close();
});

const validProfile = {
  name: 'Ana Silva',
  birthYear: 1994,
  clothingPreference: 'womenswear',
  heightCm: 168,
  weightKg: 60,
  country: 'IN',
  measurementUnit: 'metric',
};

describe('profile', () => {
  it('requires auth', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/profile' });
    expect(res.statusCode).toBe(401);
  });

  it('starts empty, saves, updates the name, and flips onboarded on /me', async () => {
    const { cookie } = await registerUser(ctx.app, { name: 'Original Name' });
    const headers = { cookie };

    const empty = await ctx.app.inject({ method: 'GET', url: '/api/profile', headers });
    expect(empty.json()).toEqual({ profile: null });

    const saved = await ctx.app.inject({ method: 'PUT', url: '/api/profile', headers, payload: validProfile });
    expect(saved.statusCode).toBe(200);
    const { name: _name, ...profileFields } = validProfile;
    expect(saved.json().profile).toMatchObject(profileFields);
    expect(saved.json().user).toMatchObject({ name: 'Ana Silva', onboarded: true });

    const me = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers });
    expect(me.json().user).toMatchObject({ name: 'Ana Silva', onboarded: true });

    const updated = await ctx.app.inject({
      method: 'PUT',
      url: '/api/profile',
      headers,
      payload: { ...validProfile, birthYear: null, measurementUnit: 'imperial' },
    });
    expect(updated.json().profile).toMatchObject({ birthYear: null, measurementUnit: 'imperial' });
    expect(updated.json().profile.onboardedAt).toBe(saved.json().profile.onboardedAt);
  });

  it('validates input', async () => {
    const { cookie } = await registerUser(ctx.app);
    const res = await ctx.app.inject({
      method: 'PUT',
      url: '/api/profile',
      headers: { cookie },
      payload: { ...validProfile, heightCm: 20, country: 'ZZ', clothingPreference: 'sportswear' },
    });
    expect(res.statusCode).toBe(400);
    expect(Object.keys(res.json().error.fields).sort()).toEqual(['clothingPreference', 'country', 'heightCm']);
  });

  it('keeps profiles isolated per user', async () => {
    const a = await registerUser(ctx.app);
    const b = await registerUser(ctx.app);
    await ctx.app.inject({ method: 'PUT', url: '/api/profile', headers: { cookie: a.cookie }, payload: validProfile });
    const res = await ctx.app.inject({ method: 'GET', url: '/api/profile', headers: { cookie: b.cookie } });
    expect(res.json()).toEqual({ profile: null });
  });
});
