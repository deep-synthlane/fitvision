import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync } from 'node:fs';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema.js';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: Db;
  close: () => Promise<void>;
}

// `apps/api/drizzle`, seen from src/db/ (tsx) or from the bundled dist/ (production build).
const migrationsFolder =
  process.env.MIGRATIONS_DIR ??
  [new URL('../../drizzle', import.meta.url), new URL('../drizzle', import.meta.url)].map((u) => fileURLToPath(u)).find((dir) => existsSync(`${dir}/meta/_journal.json`)) ??
  fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Arbitrary constant identifying FitVision's migration lock. */
const MIGRATION_LOCK_ID = 7_294_101;

/**
 * Opens the database and applies pending migrations.
 * - `databaseUrl` set → node-postgres against a real PostgreSQL server.
 * - otherwise → embedded PGlite; `pgliteDir` of `memory://` gives a throwaway DB (tests).
 */
export async function openDb(opts: { databaseUrl?: string; pgliteDir: string }): Promise<DbHandle> {
  if (opts.databaseUrl) {
    const { Pool } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const pool = new Pool({ connectionString: opts.databaseUrl });
    const db = drizzle(pool, { schema });
    // API, worker and migrate jobs may start together: one migrates at a time, the rest then find nothing pending.
    const lock = await pool.connect();
    try {
      await lock.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
      await migrate(db, { migrationsFolder });
    } finally {
      await lock.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
      lock.release();
    }
    return { db: db as unknown as Db, close: () => pool.end() };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  if (!opts.pgliteDir.startsWith('memory://')) mkdirSync(opts.pgliteDir, { recursive: true });
  const client = new PGlite(opts.pgliteDir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return { db: db as unknown as Db, close: () => client.close() };
}
