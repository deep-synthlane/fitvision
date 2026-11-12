import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, registerUser, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.close();
});

describe('health', () => {
  it('responds ok', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('returns JSON 404 for unknown routes', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});

describe('auth', () => {
  it('registers a user, sets an httpOnly session cookie, and never returns the hash', async () => {
    const { res } = await registerUser(ctx.app, { email: 'New.Person@Example.com', name: 'New Person' });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user).toMatchObject({ email: 'new.person@example.com', name: 'New Person', onboarded: false });
    expect(JSON.stringify(body)).not.toContain('passwordHash');
    const cookie = res.cookies.find((c) => c.name === 'fv_session');
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Lax');
  });

  it('rejects duplicate emails case-insensitively', async () => {
    await registerUser(ctx.app, { email: 'dupe@example.com' });
    const { res } = await registerUser(ctx.app, { email: 'DUPE@example.com' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('EMAIL_TAKEN');
  });

  it('returns field errors for invalid input', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: '', email: 'not-an-email', password: 'short' },
    });
    expect(res.statusCode).toBe(400);
    const { error } = res.json();
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(error.fields).sort()).toEqual(['email', 'name', 'password']);
  });

  it('rejects malformed JSON with a 400', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{bad json',
    });
    expect(res.statusCode).toBe(400);
  });

  it('logs in with correct credentials and rejects wrong ones with the same message', async () => {
    const { payload } = await registerUser(ctx.app);
    const ok = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: payload.email.toUpperCase(), password: payload.password },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.email).toBe(payload.email);

    const wrongPw = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: payload.email, password: 'wrong-password' },
    });
    const noUser = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ghost@example.com', password: 'whatever123' },
    });
    expect(wrongPw.statusCode).toBe(401);
    expect(noUser.statusCode).toBe(401);
    expect(wrongPw.json()).toEqual(noUser.json());
  });

  it('GET /me requires a valid session', async () => {
    const anon = await ctx.app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(anon.statusCode).toBe(401);

    const forged = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: 'fv_session=abc.def.ghi' } });
    expect(forged.statusCode).toBe(401);

    const { cookie, payload } = await registerUser(ctx.app);
    const me = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe(payload.email);
  });

  it('logout clears the cookie', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/logout' });
    expect(res.statusCode).toBe(204);
    const cookie = res.cookies.find((c) => c.name === 'fv_session');
    expect(cookie?.value).toBe('');
  });
});

describe('auth rate limiting', () => {
  it('throttles repeated login attempts', async () => {
    const fresh = await createTestApp();
    try {
      const attempt = () =>
        fresh.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'x@example.com', password: 'nope-nope' } });
      for (let i = 0; i < 10; i++) expect((await attempt()).statusCode).toBe(401);
      const blocked = await attempt();
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json().error.code).toBe('RATE_LIMITED');
    } finally {
      await fresh.close();
    }
  });
});

