import { z } from 'zod';

const DEV_JWT_SECRET = 'dev-only-insecure-secret-change-me-0000000000';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Deployment environment. staging and production get the same safety checks. */
  APP_ENV: z.enum(['development', 'test', 'staging', 'production']).optional(),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.string().optional(),
  PGLITE_DIR: z.string().default('.data/pglite'),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_DIR: z.string().default('.data/uploads'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_KEY_PREFIX: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool,
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters').optional(),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  /** Dev/testing only: comma-separated host:port pairs product import may reach (e.g. a local fixture server). */
  IMPORT_ALLOW_HOSTS: z.string().optional(),
  /** Login/register attempts per IP per 15 minutes. */
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  /** Password hashing cost. Production must stay at 12+; tests use 4 for speed. */
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  TRYON_PROVIDER: z.enum(['mock', 'replicate']).optional(),
  /** Production only runs the mock provider when this is explicitly set. */
  TRYON_ALLOW_MOCK: bool,
  /** Set only after the provider has been evaluated and manually verified end to end. */
  TRYON_PROVIDER_VERIFIED: bool,
  /** Set only after a real model has been seen to put clothing on avatar renders (separate from photo try-on). */
  TRYON_AVATAR_VERIFIED: bool,
  REPLICATE_API_TOKEN: z.string().optional(),
  REPLICATE_MODEL_VERSION: z.string().optional(),
  REPLICATE_COST_USD: z.coerce.number().nonnegative().optional(),
  TRYON_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
  TRYON_POLL_MS: z.coerce.number().int().positive().default(2_000),
  TRYON_DAILY_LIMIT: z.coerce.number().int().nonnegative().default(20),
  TRYON_MAX_ACTIVE: z.coerce.number().int().positive().default(2),
  TRYON_FAILED_RETENTION_DAYS: z.coerce.number().int().positive().default(7),
  /** inline: the API runs background jobs itself; api: only queues them; worker: only runs them. */
  JOB_MODE: z.enum(['inline', 'api', 'worker']).default('inline'),
  WORKER_POLL_MS: z.coerce.number().int().positive().default(2_000),
  /** Bearer token for GET /api/metrics. Unset → the endpoint is disabled. */
  METRICS_TOKEN: z.string().min(16).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).optional(),
});

export type AppEnv = 'development' | 'test' | 'staging' | 'production';

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  appEnv: AppEnv;
  /** staging or production: unsafe defaults are refused. */
  deployed: boolean;
  port: number;
  host: string;
  databaseUrl: string | undefined;
  pgliteDir: string;
  storage:
    | { driver: 'local'; dir: string }
    | { driver: 's3'; bucket: string; region: string; endpoint?: string; accessKeyId: string; secretAccessKey: string; keyPrefix?: string; forcePathStyle: boolean };
  /** Kept for existing callers: the local storage directory. */
  storageDir: string;
  jwtSecret: string;
  webOrigin: string;
  importAllowHosts: string[];
  authRateLimitMax: number;
  bcryptRounds: number;
  jobMode: 'inline' | 'api' | 'worker';
  workerPollMs: number;
  metricsToken: string | null;
  logLevel: string;
  tryOn: {
    provider: 'mock' | 'replicate';
    verified: boolean;
    /** Avatar renders as person input verified with this (real) provider. Never true for the mock. */
    avatarVerified: boolean;
    replicate: { apiToken: string; modelVersion: string; costUsd: number | null } | null;
    timeoutMs: number;
    pollMs: number;
    dailyLimit: number;
    maxActive: number;
    failedRetentionDays: number;
  };
}

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const p = envSchema.parse(env);
  const appEnv: AppEnv = p.APP_ENV ?? (p.NODE_ENV === 'production' ? 'production' : p.NODE_ENV);
  const deployed = appEnv === 'staging' || appEnv === 'production';
  const problems: string[] = [];

  if (p.NODE_ENV === 'production' && !p.APP_ENV) problems.push('APP_ENV must be set to staging or production when NODE_ENV=production');
  if (deployed) {
    if (p.NODE_ENV !== 'production') problems.push('NODE_ENV must be production for staging/production');
    if (!p.JWT_SECRET) problems.push('JWT_SECRET is required');
    if (p.BCRYPT_ROUNDS < 12) problems.push('BCRYPT_ROUNDS must be at least 12');
    if (!p.DATABASE_URL) problems.push('DATABASE_URL (PostgreSQL) is required — PGlite is for development and tests only');
    if (p.STORAGE_DRIVER !== 's3') problems.push('STORAGE_DRIVER=s3 is required — local disk is for development only');
    if (p.IMPORT_ALLOW_HOSTS) problems.push('IMPORT_ALLOW_HOSTS must not be set');
    if (!p.WEB_ORIGIN.startsWith('https://')) problems.push('WEB_ORIGIN must be an https:// origin');
    if (!p.TRYON_PROVIDER) problems.push('TRYON_PROVIDER must be set explicitly');
    if (p.TRYON_PROVIDER === 'mock' && !p.TRYON_ALLOW_MOCK) problems.push('TRYON_PROVIDER=mock requires TRYON_ALLOW_MOCK=true (mock results would be shown to users)');
  }
  if (p.TRYON_PROVIDER === 'replicate' && (!p.REPLICATE_API_TOKEN || !p.REPLICATE_MODEL_VERSION)) {
    problems.push('TRYON_PROVIDER=replicate requires REPLICATE_API_TOKEN and REPLICATE_MODEL_VERSION');
  }
  if (p.STORAGE_DRIVER === 's3' && (!p.S3_BUCKET || !p.S3_ACCESS_KEY_ID || !p.S3_SECRET_ACCESS_KEY)) {
    problems.push('STORAGE_DRIVER=s3 requires S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY');
  }
  if (problems.length) throw new ConfigError(`Refusing to start with unsafe configuration:\n- ${problems.join('\n- ')}`);

  const provider = p.TRYON_PROVIDER ?? 'mock';
  return {
    env: p.NODE_ENV,
    appEnv,
    deployed,
    port: p.PORT,
    host: p.HOST,
    databaseUrl: p.DATABASE_URL || undefined,
    pgliteDir: p.PGLITE_DIR,
    storage:
      p.STORAGE_DRIVER === 's3'
        ? {
            driver: 's3',
            bucket: p.S3_BUCKET!,
            region: p.S3_REGION,
            endpoint: p.S3_ENDPOINT,
            accessKeyId: p.S3_ACCESS_KEY_ID!,
            secretAccessKey: p.S3_SECRET_ACCESS_KEY!,
            keyPrefix: p.S3_KEY_PREFIX,
            forcePathStyle: p.S3_FORCE_PATH_STYLE,
          }
        : { driver: 'local', dir: p.STORAGE_DIR },
    storageDir: p.STORAGE_DIR,
    jwtSecret: p.JWT_SECRET ?? DEV_JWT_SECRET,
    webOrigin: p.WEB_ORIGIN,
    importAllowHosts: p.IMPORT_ALLOW_HOSTS?.split(',').map((h) => h.trim()).filter(Boolean) ?? [],
    authRateLimitMax: p.AUTH_RATE_LIMIT_MAX,
    bcryptRounds: p.BCRYPT_ROUNDS,
    jobMode: p.JOB_MODE,
    workerPollMs: p.WORKER_POLL_MS,
    metricsToken: p.METRICS_TOKEN ?? null,
    logLevel: p.LOG_LEVEL ?? (deployed ? 'info' : 'debug'),
    tryOn: {
      provider,
      // The mock is "verified" as what it is (a labelled placeholder); real providers only when declared.
      verified: provider === 'mock' ? true : p.TRYON_PROVIDER_VERIFIED,
      avatarVerified: provider !== 'mock' && p.TRYON_PROVIDER_VERIFIED && p.TRYON_AVATAR_VERIFIED,
      replicate:
        provider === 'replicate' ? { apiToken: p.REPLICATE_API_TOKEN!, modelVersion: p.REPLICATE_MODEL_VERSION!, costUsd: p.REPLICATE_COST_USD ?? null } : null,
      timeoutMs: p.TRYON_TIMEOUT_MS,
      pollMs: p.TRYON_POLL_MS,
      dailyLimit: p.TRYON_DAILY_LIMIT,
      maxActive: p.TRYON_MAX_ACTIVE,
      failedRetentionDays: p.TRYON_FAILED_RETENTION_DAYS,
    },
  };
}
