# Deployment

How to run FitVision in staging and production. Development needs none of this (`pnpm dev`).

> **Verification status (2026-11-06).** The API bundle (`pnpm --filter @fitvision/api build`), the
> `pnpm deploy` production package, migrations (including 4 concurrent runs), `pg_dump`/`pg_restore`
> and the full API test suite were run against **PostgreSQL 16.10 and 18.4** locally. The web build
> was run under the production Content-Security-Policy in Chrome. The compose file passes
> `docker compose config`. **Not yet run:** `docker build` / `docker compose up` (no Docker daemon was
> available), and S3 storage against a real S3 or R2 bucket (tested against a local fake S3 server
> only). Do both on staging before the first production release (see `RELEASE_CHECKLIST.md`).

## 1. Environments

| | development | test | staging | production |
| --- | --- | --- | --- | --- |
| `APP_ENV` | development (default) | test (vitest) | `staging` | `production` |
| Database | PGlite file (`.data/pglite`) | in-memory PGlite, or `TEST_DATABASE_URL` | PostgreSQL | PostgreSQL |
| Storage | local disk | in-memory | S3 / R2 (own bucket) | S3 / R2 (own bucket) |
| Try-on | mock | fake/mock | mock or real (unverified until signed off) | explicit choice |
| Jobs | inline | inline | `api` + worker | `api` + worker |
| Secrets | dev fallback | fixed test values | own secrets | own secrets |

Staging and production must not share a database, bucket, `JWT_SECRET`, provider token or
metrics token. Demo data (`pnpm seed`) only exists in development; the seed refuses to run when
`APP_ENV` is staging or production.

### Refused configurations

With `APP_ENV=staging|production` (and `NODE_ENV=production`), the API, worker and migrate
commands exit with a list of every problem when:

- `JWT_SECRET` is missing (or under 32 characters), or `BCRYPT_ROUNDS` < 12;
- `DATABASE_URL` is missing (PGlite is development-only);
- `STORAGE_DRIVER` isn't `s3`, or S3 credentials/bucket are missing;
- `IMPORT_ALLOW_HOSTS` is set (it would open the importer to internal hosts);
- `WEB_ORIGIN` isn't `https://`;
- `TRYON_PROVIDER` isn't set explicitly, or is `mock` without `TRYON_ALLOW_MOCK=true`;
- `NODE_ENV=production` without `APP_ENV`.

A real provider shows an "hasn't been fully tested" warning in the app until
`TRYON_PROVIDER_VERIFIED=true`, which may only be set after the evaluation in
`VALIDATION_TRACKING.md` §3.

## 2. Architecture

```
Internet ──HTTPS──▶ Caddy (web image: static app + /api reverse proxy, Let's Encrypt)
                        │
                        ├──▶ api     (node dist/server.js, JOB_MODE=api)  ──┐
                        │                                                 ├──▶ PostgreSQL
                        └─  worker   (node dist/worker.js)                ──┤
                                                                          └──▶ S3 / R2 (private bucket)
     migrate (node dist/migrate.js) runs once before api/worker start.
```

- The API is stateless (sessions are signed cookies checked against `users.token_version`), so
  several API instances can run behind the proxy.
- Workers claim jobs atomically; more than one worker is safe.
- **Rate limits are per API instance** (in-memory). With N instances, the effective limit is N×.
  Use a shared store (e.g. Redis with `@fastify/rate-limit`) before scaling out horizontally.
- Images are never served from the bucket. The API streams them to their owner after an
  ownership check, so the bucket needs no public access, signed URLs or CORS.

## 3. First deployment (single host, Docker Compose)

```bash
cp deploy/env.production.example .env.production     # fill in; keep it out of git
docker compose -f docker-compose.prod.yml --env-file .env.production build
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
docker compose -f docker-compose.prod.yml logs -f migrate api worker
curl https://$SITE_ADDRESS/api/health      # {"status":"ok"}
```

- DNS for `SITE_ADDRESS` must point at the host and ports 80/443 must be open (Caddy obtains the
  certificate automatically).
- `/api/ready` checks the database, a storage write/read/delete and the job backlog. It returns
  503 when the database or storage fails. Point your load balancer or uptime check at it.
- `/api/metrics` (Prometheus text) requires `Authorization: Bearer $METRICS_TOKEN` and is
  blocked at the edge by Caddy; scrape it from inside the network (`api:4000`).

### Images

`Dockerfile` targets: `api` (also used by `worker` and `migrate`) and `web` (Caddy + the
built SPA). Base images are `node:22-bookworm-slim` and `caddy:2-alpine`; pin them by digest in
your registry for reproducible builds. The API runs as the unprivileged `node` user.

### Other platforms

Any container platform works: run the `api` image three ways (`node dist/migrate.js` as a
release/one-off job, `node dist/server.js` with `JOB_MODE=api`, `node dist/worker.js`). Terminate
TLS at the platform and send `/api/*` to the API; serve `apps/web/dist` with the headers in
`deploy/security-headers.caddy` and an SPA fallback to `index.html`. Keep `WEB_ORIGIN` equal to the
public origin. The API trusts `X-Forwarded-*` from the proxy when deployed.

## 4. Migrations

- SQL migrations live in `apps/api/drizzle/` and are generated with `pnpm db:generate`.
  **Never edit or regenerate a migration that has been applied anywhere.**
- `node dist/migrate.js` applies pending migrations and exits. The API and worker also apply them
  at startup. A PostgreSQL advisory lock serialises concurrent runs, so starting several processes
  at once is safe (verified with 4 concurrent runs).
- Migrations are additive in this codebase. For a destructive change, ship it in two releases
  (stop using the column, then drop it) so a rollback to the previous image still works.

## 5. Secrets

| Secret | Generate | Rotation |
| --- | --- | --- |
| `JWT_SECRET` | `openssl rand -base64 48` | Rotating signs every user out. |
| `POSTGRES_PASSWORD` | `openssl rand -base64 32` | `ALTER ROLE`, then restart api/worker. |
| `S3_ACCESS_KEY_ID/SECRET` | bucket-scoped key | Create new key → deploy → delete old. |
| `METRICS_TOKEN` | `openssl rand -hex 24` | Update the scraper and the API together. |
| `REPLICATE_API_TOKEN` | provider dashboard | Provider-side rotation. |

Keep them in your platform's secret store or a root-only `.env.production`. Never put them in
the web build: `pnpm check:bundle` fails the build if anything secret-shaped appears there.

## 6. Object storage (S3 / R2)

1. Create one bucket per environment with **all public access blocked**.
2. Create credentials limited to that bucket: `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`,
   `s3:ListBucket` (deletions list by user prefix).
3. Objects are written with server-side encryption (`AES256`). R2 encrypts at rest by default.
4. Cloudflare R2: `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`, `S3_REGION=auto`.
   MinIO: set the endpoint and `S3_FORCE_PATH_STYLE=true`.
5. If you enable bucket **versioning** (recommended against accidental deletes), add a lifecycle
   rule that expires **non-current versions after 30 days**. Otherwise deleted user images stay
   in old versions, which breaks the deletion policy in `DATA_POLICY.md`.

## 7. Backups and restore

- **Database:** at least daily `pg_dump -Fc` (or managed PostgreSQL with point-in-time recovery),
  kept for **30 days** and encrypted. Restore tested locally: `pg_restore` into an empty database,
  then `node dist/migrate.js` is a no-op.
  ```bash
  docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U fitvision -Fc fitvision > fitvision-$(date +%F).dump
  pg_restore --no-owner -d <empty-db-url> fitvision-YYYY-MM-DD.dump
  ```
- **Images:** bucket versioning (with the 30-day non-current expiry above) or provider replication.
- Accounts deleted after a backup was taken can come back in a restore. After restoring, re-run the
  deletions recorded since that backup. The API logs `Account deleted` with the user id.
- Rehearse a restore into staging at least once per quarter.

## 8. Observability

- **Logs:** JSON to stdout (pino) with `reqId` (echoed as `x-request-id`; Caddy generates one per
  request). Cookies, authorization headers, `set-cookie`, passwords, password hashes and tokens are
  redacted. Request bodies (and so images and measurements) are not logged.
- **Errors:** 5xx errors go through an `ErrorReporter` (`apps/api/src/observability/errors.ts`).
  The default writes `error_report: true` log lines; plug in Sentry or another service there.
- **Metrics** (`/api/metrics`): HTTP requests and latency by route, product imports by outcome and
  failure reason, try-on jobs by outcome, provider latency and errors, size recommendations by
  confidence, avatar jobs.
- **Product analytics:** the `analytics_events` table holds funnel events under an HMAC pseudonym,
  with an allow-list of non-personal properties (see `DATA_POLICY.md`).

## 9. Updating and rolling back

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production build
docker compose -f docker-compose.prod.yml --env-file .env.production up -d   # migrate runs first
```

To roll back, redeploy the previous image tag. Because migrations are additive, the old code runs
against the newer schema. Restore from backup only for data loss, never for a code rollback.
