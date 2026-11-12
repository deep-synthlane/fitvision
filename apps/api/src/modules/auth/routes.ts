import type { FastifyInstance } from 'fastify';
import { loginSchema, registerSchema, type AuthResponse } from '@fitvision/shared';
import type { Db } from '../../db/client.js';
import { AppError, parseInput } from '../../lib/errors.js';
import type { SessionTools } from '../../plugins/auth.js';
import { createAuthService } from './service.js';

export function authRoutes(db: Db, session: SessionTools, rateLimitMax = 10, bcryptRounds = 12) {
  const service = createAuthService(db, bcryptRounds);

  return async (app: FastifyInstance) => {
    const strictLimit = { rateLimit: { max: rateLimitMax, timeWindow: '15 minutes' } };

    app.post('/register', { config: strictLimit }, async (req, reply): Promise<AuthResponse> => {
      const { user, tokenVersion } = await service.register(parseInput(registerSchema, req.body));
      await session.setSession(reply, user.id, tokenVersion);
      reply.status(201);
      return { user };
    });

    app.post('/login', { config: strictLimit }, async (req, reply): Promise<AuthResponse> => {
      const { user, tokenVersion } = await service.login(parseInput(loginSchema, req.body));
      await session.setSession(reply, user.id, tokenVersion);
      return { user };
    });

    app.post('/logout', async (_req, reply) => {
      session.clearSession(reply);
      return reply.status(204).send();
    });

    /** Signs out every device by invalidating all existing session tokens. */
    app.post('/logout-all', { preHandler: session.requireAuth }, async (req, reply) => {
      await session.revokeAll(req.userId!);
      session.clearSession(reply);
      return reply.status(204).send();
    });

    app.get('/me', { preHandler: session.requireAuth }, async (req, reply): Promise<AuthResponse> => {
      const user = await service.getUser(req.userId!);
      if (!user) {
        // Account was deleted while the session cookie was still valid.
        session.clearSession(reply);
        throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in');
      }
      return { user };
    });
  };
}
