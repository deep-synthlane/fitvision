# FitVision AI

Fashion virtual try-on: build a body profile and avatar, add clothing by upload or product URL, and preview an AI try-on with a size recommendation.

- Plan: [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md)
- Status: [docs/PROGRESS.md](docs/PROGRESS.md)

## Requirements

- Node.js 22+
- pnpm 11 (`corepack enable` or `npm i -g pnpm`)
- PostgreSQL is **optional** in development — without `DATABASE_URL` the API uses embedded PGlite.

## Getting started

```bash
pnpm install
pnpm dev          # API on :4000, web on http://localhost:5173 (proxies /api)
```

Optional: copy `apps/api/.env.example` to `apps/api/.env`.

## Scripts (run from the repo root)

| Command | What it does |
| --- | --- |
| `pnpm dev` | API + web in watch mode |
| `pnpm typecheck` | `tsc` in every package |
| `pnpm lint` | ESLint across the repo |
| `pnpm test` | Vitest in every package (API tests use in-memory PGlite) |
| `pnpm build` | Production build of the web app and the API bundle |
| `pnpm e2e` | Playwright smoke, accessibility, responsive and CSP tests (starts its own servers; uses installed Chrome locally) |
| `pnpm check:bundle` | Fail if the web build contains secret-shaped strings |
| `pnpm seed` | Development-only demo account with labelled demo data (prints a random password) |
| `pnpm db:generate` | Generate a Drizzle migration after editing `apps/api/src/db/schema.ts` |
| `pnpm calibration:report <csv>` | Body-scan accuracy report from a volunteer worksheet (see `tools/calibration`) |
| `pnpm calibration:fetch` | Print the calibration account's latest raw scan estimates as worksheet columns |

Migrations in `apps/api/drizzle/` are applied automatically when the API starts (or with
`pnpm --filter @fitvision/api migrate`).

## Production

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) (Docker, HTTPS, PostgreSQL, S3/R2, worker, backups) and
[docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md). Other references:
[security review](docs/SECURITY_REVIEW.md), [data policy](docs/DATA_POLICY.md),
[validation tracking](docs/VALIDATION_TRACKING.md), [accessibility](docs/ACCESSIBILITY.md).

## Layout

```
apps/api           Fastify API (auth, profile, measurements, scans, avatars, products, try-ons, wardrobe, account)
apps/e2e           Playwright end-to-end, accessibility and CSP tests
apps/web           React + Vite SPA, design system in src/design
packages/shared    zod schemas and types shared by both
tools/calibration  body-scan accuracy validation (kept out of the app database)
tools/vton-eval    virtual try-on provider evaluation harness + model licence register
tools/sizing-eval  known-answer cases for the size engine + fit-feedback report
deploy/            Caddyfile, security headers, production env example
```
