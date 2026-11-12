import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp, type AppDeps } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDb, type Db } from '../src/db/client.js';
import { MemoryStorage } from '../src/storage/index.js';

export interface TestContext {
  app: FastifyInstance;
  storage: MemoryStorage;
  db: Db;
  close: () => Promise<void>;
}

/** Fresh app backed by a throwaway in-memory PGlite database. */
export async function createTestApp(deps: Omit<AppDeps, 'db' | 'storage'> = {}, env: Record<string, string> = {}): Promise<TestContext> {
  // TEST_DATABASE_URL runs the suite against real PostgreSQL (a fresh database per test app).
  const pgAdmin = process.env.TEST_DATABASE_URL;
  let dropDatabase = async () => {};
  let databaseUrl: string | undefined;
  if (pgAdmin) {
    const { Client } = await import('pg');
    const name = `fv_test_${Math.random().toString(36).slice(2, 10)}`;
    const admin = new Client({ connectionString: pgAdmin });
    await admin.connect();
    await admin.query(`create database ${name}`);
    await admin.end();
    const url = new URL(pgAdmin);
    url.pathname = `/${name}`;
    databaseUrl = url.toString();
    dropDatabase = async () => {
      const c = new Client({ connectionString: pgAdmin });
      await c.connect();
      await c.query(`drop database if exists ${name} with (force)`);
      await c.end();
    };
  }
  const config = loadConfig({ NODE_ENV: 'test', PGLITE_DIR: 'memory://', BCRYPT_ROUNDS: '4', ...(databaseUrl && { DATABASE_URL: databaseUrl }), ...env });
  const db = await openDb(config);
  const storage = new MemoryStorage();
  const app = await buildApp(config, { db: db.db, storage, ...deps });
  await app.ready();
  return {
    app,
    storage,
    db: db.db,
    close: async () => {
      await app.close();
      await db.close();
      await dropDatabase();
    },
  };
}

export function sessionCookie(res: LightMyRequestResponse): string {
  const cookie = res.cookies.find((c) => c.name === 'fv_session');
  if (!cookie) throw new Error('No session cookie in response');
  return `fv_session=${cookie.value}`;
}

let counter = 0;
export async function registerUser(app: FastifyInstance, overrides: Partial<{ email: string; password: string; name: string }> = {}) {
  counter += 1;
  const payload = {
    name: 'Test User',
    email: `user${counter}@example.com`,
    password: 'correct-horse-battery',
    ...overrides,
  };
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload });
  return { res, payload, cookie: res.statusCode === 201 ? sessionCookie(res) : '' };
}
