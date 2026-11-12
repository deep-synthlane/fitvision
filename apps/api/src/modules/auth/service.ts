import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import type { LoginInput, PublicUser, RegisterInput } from '@fitvision/shared';
import type { Db } from '../../db/client.js';
import { profiles, users, type UserRow } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';

export function createAuthService(db: Db, bcryptRounds = 12) {
  // Compared against when the email is unknown, so login timing doesn't reveal which emails exist.
  // Same cost as real hashes, so both paths take the same time.
  const dummyHash = bcrypt.hashSync('fitvision-dummy-password', bcryptRounds);

  async function toPublicUser(user: UserRow): Promise<PublicUser> {
    const [profile] = await db
      .select({ userId: profiles.userId })
      .from(profiles)
      .where(eq(profiles.userId, user.id))
      .limit(1);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      onboarded: Boolean(profile),
      createdAt: user.createdAt.toISOString(),
    };
  }

  return {
    async register(input: RegisterInput): Promise<{ user: PublicUser; tokenVersion: number }> {
      const passwordHash = await bcrypt.hash(input.password, bcryptRounds);
      const [user] = await db
        .insert(users)
        .values({ email: input.email, name: input.name, passwordHash })
        .onConflictDoNothing({ target: users.email })
        .returning();
      if (!user) {
        throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists', {
          email: 'An account with this email already exists',
        });
      }
      return { user: await toPublicUser(user), tokenVersion: user.tokenVersion };
    },

    async login(input: LoginInput): Promise<{ user: PublicUser; tokenVersion: number }> {
      const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
      const ok = await bcrypt.compare(input.password, user?.passwordHash ?? dummyHash);
      if (!user || !ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password');
      return { user: await toPublicUser(user), tokenVersion: user.tokenVersion };
    },

    /** Re-authentication for destructive actions (e.g. account deletion). */
    async verifyPassword(userId: string, password: string): Promise<boolean> {
      const [user] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, userId)).limit(1);
      return bcrypt.compare(password, user?.hash ?? dummyHash).then((ok) => Boolean(user) && ok);
    },

    async getUser(id: string): Promise<PublicUser | null> {
      const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      return user ? toPublicUser(user) : null;
    },
  };
}
