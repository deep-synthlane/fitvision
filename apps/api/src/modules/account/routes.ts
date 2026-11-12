import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { analyticsEvents, avatars, bodyMeasurements, bodyScans, products, savedLooks, tryOnPhotos, tryOnResults, users } from '../../db/schema.js';
import { AppError, parseInput } from '../../lib/errors.js';
import type { SessionTools } from '../../plugins/auth.js';
import type { Storage } from '../../storage/index.js';
import type { VirtualTryOnProvider } from '../../tryon/provider.js';
import { createAuthService } from '../auth/service.js';
import { deleteAvatarRenders } from '../tryon/routes.js';

export const DATA_KINDS = ['scans', 'measurements', 'avatar', 'try-on-photos', 'try-ons', 'products', 'saved-looks'] as const;
export type DataKind = (typeof DATA_KINDS)[number];

/** Storage prefixes owned by a user. Account deletion removes all of them. */
export const userPrefixes = (userId: string) => ['scans', 'avatars', 'products', 'tryon-photos', 'tryons'].map((p) => `${p}/${userId}/`);

export interface AccountDeps {
  db: Db;
  storage: Storage;
  session: SessionTools;
  provider: VirtualTryOnProvider;
  bcryptRounds: number;
}

/**
 * User data controls. Each deletion keeps related records consistent:
 * - measurements → avatars built from them (and their files) and size recommendations go too;
 *   feedback keeps the product but loses the recommendation link;
 * - scans → photos removed; measurements and avatars stay (links set to null);
 * - products → images, variants, size charts, collections, try-ons (and result files), saved looks;
 * - try-on photos → files removed, rows soft-deleted so past results still list.
 * Full account deletion removes every row (cascade from users) and every stored file.
 */
export function accountRoutes(deps: AccountDeps) {
  const { db, storage, session, provider } = deps;
  const auth = createAuthService(db, deps.bcryptRounds);

  async function cancelActiveTryOns(userId: string, productIds?: string[]) {
    const active = await db
      .select({ id: tryOnResults.id, jobId: tryOnResults.providerJobId })
      .from(tryOnResults)
      .where(
        and(
          eq(tryOnResults.userId, userId),
          inArray(tryOnResults.status, ['pending', 'processing']),
          productIds ? inArray(tryOnResults.productId, productIds.length ? productIds : ['00000000-0000-0000-0000-000000000000']) : undefined,
        ),
      );
    if (active.length) await db.update(tryOnResults).set({ status: 'cancelled', completedAt: new Date() }).where(inArray(tryOnResults.id, active.map((a) => a.id)));
    // Stop paying for work nobody will see.
    await Promise.all(active.filter((a) => a.jobId && provider.cancel).map((a) => provider.cancel!(a.jobId!).catch(() => {})));
  }

  const deleters: Record<DataKind, (userId: string) => Promise<void>> = {
    async scans(userId) {
      await db.delete(bodyScans).where(eq(bodyScans.userId, userId));
      await storage.deletePrefix(`scans/${userId}/`);
    },
    async measurements(userId) {
      await deleteAvatarRenders(db, storage, eq(tryOnPhotos.userId, userId));
      await db.delete(avatars).where(eq(avatars.userId, userId)); // every avatar is built from a measurement set
      await storage.deletePrefix(`avatars/${userId}/`);
      await db.delete(bodyMeasurements).where(eq(bodyMeasurements.userId, userId));
    },
    async avatar(userId) {
      await deleteAvatarRenders(db, storage, eq(tryOnPhotos.userId, userId));
      await db.delete(avatars).where(eq(avatars.userId, userId));
      await storage.deletePrefix(`avatars/${userId}/`);
    },
    async 'try-on-photos'(userId) {
      await db.update(tryOnPhotos).set({ deletedAt: new Date() }).where(and(eq(tryOnPhotos.userId, userId), isNull(tryOnPhotos.deletedAt)));
      await storage.deletePrefix(`tryon-photos/${userId}/`);
    },
    async 'try-ons'(userId) {
      await cancelActiveTryOns(userId);
      await db.delete(tryOnResults).where(eq(tryOnResults.userId, userId));
      await storage.deletePrefix(`tryons/${userId}/`);
    },
    async products(userId) {
      await cancelActiveTryOns(userId);
      await db.delete(tryOnResults).where(eq(tryOnResults.userId, userId));
      await db.delete(products).where(eq(products.userId, userId));
      await storage.deletePrefix(`products/${userId}/`);
      await storage.deletePrefix(`tryons/${userId}/`);
    },
    async 'saved-looks'(userId) {
      await db.delete(savedLooks).where(eq(savedLooks.userId, userId));
    },
  };

  return async (app: FastifyInstance) => {
    app.addHook('preHandler', session.requireAuth);

    app.delete('/data/:kind', async (req, reply) => {
      const kind = z.enum(DATA_KINDS).safeParse((req.params as { kind: string }).kind);
      if (!kind.success) throw new AppError(404, 'NOT_FOUND', 'Unknown data type');
      await deleters[kind.data](req.userId!);
      req.log.info({ userId: req.userId, kind: kind.data }, 'User data deleted');
      return reply.status(204).send();
    });

    /** Deletes the account and everything in it. Requires the password again. */
    // Limited per user: the password check must not become a way around the login rate limit.
    app.delete('/', { config: { rateLimit: { max: 5, timeWindow: '15 minutes', keyGenerator: (req: FastifyRequest) => req.userId ?? req.ip } } }, async (req, reply) => {
      const { password } = parseInput(z.object({ password: z.string().min(1, 'Enter your password').max(200) }), req.body);
      const userId = req.userId!;
      if (!(await auth.verifyPassword(userId, password))) {
        throw new AppError(403, 'INVALID_PASSWORD', 'Incorrect password', { password: 'Incorrect password' });
      }
      await cancelActiveTryOns(userId);
      await db.delete(users).where(eq(users.id, userId)); // cascades to every user-owned table
      // Analytics rows aren't linked by foreign key; their pseudonym is derived from the user id.
      await db.delete(analyticsEvents).where(eq(analyticsEvents.subject, app.analytics.subject(userId)));
      await Promise.all(userPrefixes(userId).map((p) => storage.deletePrefix(p)));
      session.clearSession(reply);
      req.log.info({ userId }, 'Account deleted');
      return reply.status(204).send();
    });
  };
}
