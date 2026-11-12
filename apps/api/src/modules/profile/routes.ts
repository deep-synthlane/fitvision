import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { profileInputSchema, type Profile, type ProfileResponse, type PublicUser } from '@fitvision/shared';
import type { Db } from '../../db/client.js';
import { profiles, users, type ProfileRow } from '../../db/schema.js';
import { parseInput } from '../../lib/errors.js';
import type { SessionTools } from '../../plugins/auth.js';

function toProfile(row: ProfileRow): Profile {
  return {
    birthYear: row.birthYear,
    clothingPreference: row.clothingPreference as Profile['clothingPreference'],
    heightCm: row.heightCm,
    weightKg: row.weightKg,
    country: row.country,
    measurementUnit: row.measurementUnit as Profile['measurementUnit'],
    onboardedAt: row.onboardedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function profileRoutes(db: Db, session: SessionTools) {
  return async (app: FastifyInstance) => {
    app.addHook('preHandler', session.requireAuth);

    app.get('/', async (req): Promise<ProfileResponse> => {
      const [row] = await db.select().from(profiles).where(eq(profiles.userId, req.userId!)).limit(1);
      return { profile: row ? toProfile(row) : null };
    });

    /** Upserts the profile (first save completes onboarding) and updates the account name. */
    app.put('/', async (req): Promise<ProfileResponse & { user: PublicUser }> => {
      const { name, ...fields } = parseInput(profileInputSchema, req.body);
      const userId = req.userId!;
      const [before] = await db.select({ id: profiles.userId }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
      const { user, row } = await db.transaction(async (tx) => {
        const [user] = await tx.update(users).set({ name }).where(eq(users.id, userId)).returning();
        const [row] = await tx
          .insert(profiles)
          .values({ userId, ...fields })
          .onConflictDoUpdate({ target: profiles.userId, set: { ...fields, updatedAt: new Date() } })
          .returning();
        return { user: user!, row: row! };
      });
      if (!before) req.server.analytics.track('onboarding_completed', userId, {});
      return {
        profile: toProfile(row),
        user: { id: user.id, email: user.email, name: user.name, onboarded: true, createdAt: user.createdAt.toISOString() },
      };
    });
  };
}
