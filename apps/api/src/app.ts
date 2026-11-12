import { randomUUID, timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { and, inArray, lt, sql } from 'drizzle-orm';
import type { AppConfig } from './config.js';
import type { Db } from './db/client.js';
import { avatars, tryOnResults } from './db/schema.js';
import { registerAuth } from './plugins/auth.js';
import { registerErrorHandling } from './plugins/errors.js';
import { accountRoutes } from './modules/account/routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { measurementRoutes } from './modules/measurements/routes.js';
import { profileRoutes } from './modules/profile/routes.js';
import { SCAN_UPLOAD_LIMITS, scanRoutes } from './modules/scans/routes.js';
import type { Storage } from './storage/index.js';
import { ParametricAvatarGenerator, type AvatarGenerator } from './avatar/generator.js';
import { AvatarJobs } from './modules/avatars/jobs.js';
import { avatarRoutes } from './modules/avatars/routes.js';
import { SharpGarmentProcessor, type GarmentProcessor } from './garment/processor.js';
import { productRoutes } from './modules/products/routes.js';
import { wardrobeRoutes } from './modules/wardrobe/routes.js';
import { sizingRoutes } from './modules/sizing/routes.js';
import { TryOnJobs } from './modules/tryon/jobs.js';
import { tryOnRoutes } from './modules/tryon/routes.js';
import { createTryOnProvider } from './tryon/index.js';
import type { VirtualTryOnProvider } from './tryon/provider.js';
import { DEFAULT_FETCH_POLICY, policyWithExtraHosts, type FetchPolicy } from './net/policy.js';
import type { DnsLookup } from './net/safeFetch.js';
import { defaultImporters } from './products/import/index.js';
import type { ProductImporter } from './products/import/types.js';
import { Analytics, type AnalyticsEvent } from './observability/analytics.js';
import { logErrorReporter, type ErrorReporter } from './observability/errors.js';
import { Metrics } from './observability/metrics.js';

export interface AppDeps {
  db: Db;
  storage: Storage;
  /** Defaults to the parametric mannequin. */
  avatarGenerator?: AvatarGenerator;
  garmentProcessor?: GarmentProcessor;
  productImporters?: ProductImporter[];
  /** Outbound fetch policy (SSRF). Defaults to public addresses on ports 80/443. */
  fetchPolicy?: FetchPolicy;
  dnsLookup?: DnsLookup;
  /** Defaults to the provider selected by TRYON_PROVIDER (mock unless configured). */
  tryOnProvider?: VirtualTryOnProvider;
  tryOnJobOptions?: { retryBaseMs?: number; maxAttempts?: number };
  errorReporter?: ErrorReporter;
}

declare module 'fastify' {
  interface FastifyInstance {
    avatarJobs: AvatarJobs;
    tryOnJobs: TryOnJobs;
    metrics: Metrics;
    analytics: Analytics;
  }
}

const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Events the browser may report (everything else is recorded server-side). */
const CLIENT_EVENTS: AnalyticsEvent[] = ['scan_started'];

export async function buildApp(config: AppConfig, deps: AppDeps, opts: FastifyServerOptions = {}) {
  const { db, storage, avatarGenerator } = deps;
  const app = Fastify({
    bodyLimit: 1024 * 1024,
    // Accept a well-formed request id from the proxy, otherwise generate one; it's echoed back.
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
    },
    ...opts,
  });

  const metrics = new Metrics();
  const analytics = new Analytics(db, config.jwtSecret, app.log);
  const reporter = deps.errorReporter ?? logErrorReporter(app.log);
  app.decorate('metrics', metrics);
  app.decorate('analytics', analytics);

  // Background jobs. In "api" mode they're only queued; a separate worker process runs them.
  const runsJobs = config.jobMode !== 'api';
  const generator = avatarGenerator ?? new ParametricAvatarGenerator();
  const avatarJobs = new AvatarJobs(db, storage, generator, app.log, { metrics, analytics, runsJobs });
  app.decorate('avatarJobs', avatarJobs);
  const tryOnProvider = deps.tryOnProvider ?? createTryOnProvider(config);
  const tryOnJobs = new TryOnJobs(
    db,
    storage,
    tryOnProvider,
    {
      timeoutMs: config.tryOn.timeoutMs,
      pollMs: config.tryOn.pollMs,
      fetchPolicy: deps.fetchPolicy ?? DEFAULT_FETCH_POLICY,
      metrics,
      analytics,
      runsJobs,
      ...deps.tryOnJobOptions,
    },
    app.log,
  );
  app.decorate('tryOnJobs', tryOnJobs);
  // Let in-flight work finish (avatars) or pause (try-on polling resumes on restart) before the database closes.
  app.addHook('onClose', async () => {
    await avatarJobs.drain();
    await tryOnJobs.stop();
  });

  registerErrorHandling(app, reporter);

  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', req.id);
    // Defence in depth against CSRF (on top of SameSite=Lax cookies): browsers send Origin on
    // cross-site requests, so a state-changing request from another origin is refused.
    const origin = req.headers.origin;
    if (!SAFE_METHODS.has(req.method) && origin && origin !== config.webOrigin) {
      return reply.status(403).send({ error: { code: 'BAD_ORIGIN', message: 'Request origin not allowed' } });
    }
  });
  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-frame-options', 'DENY');
    reply.header('cross-origin-resource-policy', 'same-origin');
    if (config.deployed) reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
  });
  app.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions.url ?? 'unmatched';
    const labels = { method: req.method, route, status: `${Math.floor(reply.statusCode / 100)}xx` };
    metrics.httpRequests.inc(labels);
    metrics.httpDuration.observe({ route }, reply.elapsedTime / 1000);
  });

  await app.register(cookie);
  await app.register(cors, { origin: config.webOrigin, credentials: true });
  // Opt-in per route via `config.rateLimit` (auth, import, try-on endpoints).
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: SCAN_UPLOAD_LIMITS });

  const session = registerAuth(app, { db, secret: config.jwtSecret, secureCookies: config.deployed });

  /** Liveness: the process is up. Never touches dependencies or AI providers. */
  app.get('/api/health', async () => ({ status: 'ok' }));

  /** Readiness: database, writable storage and background-job health. No provider calls. */
  app.get('/api/ready', async (req, reply) => {
    const checks: Record<string, string> = {};
    try {
      await db.execute(sql`select 1`);
      checks.database = 'ok';
    } catch (err) {
      req.log.error({ err }, 'Readiness: database');
      checks.database = 'failed';
    }
    try {
      const key = `health/${randomUUID()}.txt`;
      await storage.put(key, Buffer.from('ok'));
      const back = await storage.get(key);
      await storage.delete(key);
      checks.storage = back?.toString() === 'ok' ? 'ok' : 'failed';
    } catch (err) {
      req.log.error({ err }, 'Readiness: storage');
      checks.storage = 'failed';
    }
    try {
      // Jobs waiting > 5 min mean no worker is picking them up.
      const cutoff = new Date(Date.now() - 5 * 60 * 1000);
      const [stuckTryOns, stuckAvatars] = await Promise.all([
        db.select({ id: tryOnResults.id }).from(tryOnResults).where(and(inArray(tryOnResults.status, ['pending']), lt(tryOnResults.createdAt, cutoff))).limit(1),
        db.select({ id: avatars.id }).from(avatars).where(and(inArray(avatars.status, ['pending']), lt(avatars.createdAt, cutoff))).limit(1),
      ]);
      checks.jobs = stuckTryOns.length || stuckAvatars.length ? 'backlog' : 'ok';
    } catch {
      checks.jobs = 'unknown';
    }
    const ready = checks.database === 'ok' && checks.storage === 'ok';
    return reply.status(ready ? 200 : 503).send({ status: ready ? 'ready' : 'not_ready', checks, jobMode: config.jobMode });
  });

  /** Prometheus metrics, only with the configured bearer token. */
  app.get('/api/metrics', async (req, reply) => {
    const token = config.metricsToken;
    const given = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!token) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
    const a = Buffer.from(given);
    const b = Buffer.from(token);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return reply.status(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Bad metrics token' } });
    return reply.header('content-type', 'text/plain; version=0.0.4').send(metrics.render());
  });

  /** The few funnel events only the browser can see (e.g. a scan being started). */
  app.post('/api/analytics/events', { preHandler: session.requireAuth }, async (req, reply) => {
    const name = (req.body as { name?: unknown } | undefined)?.name;
    if (typeof name !== 'string' || !CLIENT_EVENTS.includes(name as AnalyticsEvent)) {
      return reply.status(400).send({ error: { code: 'BAD_EVENT', message: 'Unknown event' } });
    }
    analytics.track(name as AnalyticsEvent, req.userId!);
    return reply.status(204).send();
  });

  await app.register(authRoutes(db, session, config.authRateLimitMax, config.bcryptRounds), { prefix: '/api/auth' });
  await app.register(accountRoutes({ db, storage, session, provider: tryOnProvider, bcryptRounds: config.bcryptRounds }), { prefix: '/api/account' });
  await app.register(profileRoutes(db, session), { prefix: '/api/profile' });
  await app.register(measurementRoutes(db, session), { prefix: '/api/measurements' });
  await app.register(scanRoutes(db, storage, session), { prefix: '/api/scans' });
  await app.register(avatarRoutes(db, storage, generator, avatarJobs, session), { prefix: '/api/avatars' });
  const basePolicy = deps.fetchPolicy ?? DEFAULT_FETCH_POLICY;
  await app.register(
    productRoutes({
      db,
      storage,
      session,
      processor: deps.garmentProcessor ?? new SharpGarmentProcessor(),
      importers: deps.productImporters ?? defaultImporters(),
      policy: config.importAllowHosts.length ? policyWithExtraHosts(basePolicy, config.importAllowHosts) : basePolicy,
      lookup: deps.dnsLookup,
      provider: tryOnProvider,
    }),
    { prefix: '/api/products' },
  );
  await app.register(wardrobeRoutes(db, session), { prefix: '/api' });
  const tryOn = tryOnRoutes({
    db,
    storage,
    provider: tryOnProvider,
    verified: config.tryOn.verified,
    avatarVerified: config.tryOn.avatarVerified,
    jobs: tryOnJobs,
    session,
    limits: { dailyLimit: config.tryOn.dailyLimit, maxActive: config.tryOn.maxActive },
  });
  await app.register(sizingRoutes(db, session), { prefix: '/api/products' });
  await app.register(tryOn.photoRoutes, { prefix: '/api/try-on-photos' });
  await app.register(tryOn.resultRoutes, { prefix: '/api/try-ons' });
  await app.register(tryOn.lookRoutes, { prefix: '/api/saved-looks' });

  return app;
}
