import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';
import type { Db } from '../db/client.js';
import { users } from '../db/schema.js';
import { AppError } from '../lib/errors.js';

export const SESSION_COOKIE = 'fv_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

declare module 'fastify' {
  interface FastifyRequest {
    userId: string | null;
  }
}

export interface SessionTools {
  setSession: (reply: FastifyReply, userId: string, tokenVersion: number) => Promise<void>;
  clearSession: (reply: FastifyReply) => void;
  /** Invalidates every existing session for the user (all devices). */
  revokeAll: (userId: string) => Promise<void>;
  /** preHandler hook: rejects with 401 unless the request carries a valid session. */
  requireAuth: (req: FastifyRequest) => Promise<void>;
}

/**
 * Sessions are HS256 JWTs in an httpOnly, SameSite=Lax cookie (Secure when deployed). Each token
 * carries the user's `token_version`; every request checks it against the database, so revoking
 * sessions (or deleting the account) takes effect immediately rather than at expiry.
 */
export function registerAuth(app: FastifyInstance, opts: { db: Db; secret: string; secureCookies: boolean }): SessionTools {
  const key = new TextEncoder().encode(opts.secret);
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: opts.secureCookies,
    path: '/',
  };

  app.decorateRequest('userId', null);

  app.addHook('onRequest', async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    try {
      const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
      if (typeof payload.sub !== 'string' || typeof payload.tv !== 'number') return;
      const [user] = await opts.db.select({ tokenVersion: users.tokenVersion }).from(users).where(eq(users.id, payload.sub)).limit(1);
      if (user && user.tokenVersion === payload.tv) req.userId = payload.sub;
    } catch {
      // Invalid, expired or revoked token: treat as signed out.
    }
  });

  return {
    async setSession(reply, userId, tokenVersion) {
      const token = await new SignJWT({ tv: tokenVersion })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(userId)
        .setIssuedAt()
        .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
        .sign(key);
      reply.setCookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge: SESSION_TTL_SECONDS });
    },
    clearSession(reply) {
      reply.clearCookie(SESSION_COOKIE, cookieOptions);
    },
    async revokeAll(userId) {
      const [row] = await opts.db.select({ v: users.tokenVersion }).from(users).where(eq(users.id, userId)).limit(1);
      if (row) await opts.db.update(users).set({ tokenVersion: row.v + 1 }).where(eq(users.id, userId));
    },
    async requireAuth(req) {
      if (!req.userId) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in');
    },
  };
}
