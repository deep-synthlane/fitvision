# Release checklist

Status as of 2026-11-06. ✅ done and verified · ⚠️ done but only partly verified · ❌ not done.
A public production launch needs every **Blocker** row ✅.

## Engineering (automated, every release)

| Item | Status | How |
| --- | --- | --- |
| Typecheck, lint, unit and integration tests | ✅ | `pnpm typecheck && pnpm lint && pnpm test` |
| API tests on real PostgreSQL | ✅ (16.10, 18.4 locally) | `TEST_DATABASE_URL=… pnpm --filter @fitvision/api test` |
| E2E smoke (account, upload, fixture import, avatar, mock try-on, sizing, deletion) | ✅ | `pnpm e2e` |
| Accessibility (axe WCAG 2.1 AA) and 5 viewport sizes | ✅ automated | `pnpm e2e` (see `ACCESSIBILITY.md`) |
| Production build under production CSP | ✅ | `apps/e2e/tests/csp.spec.ts` (`E2E_EXTERNAL_CDN=1` adds MediaPipe) |
| No secrets in the web bundle | ✅ | `pnpm build && pnpm check:bundle` |
| Size engine known-answer cases | ✅ 23/23 | `pnpm --filter @fitvision/sizing-eval eval` |
| Migrations safe to run concurrently; pg_dump/pg_restore round-trip | ✅ locally | `DEPLOYMENT.md` §4, §7 |
| No paid providers called in CI | ✅ | Mock try-on, local fixture store |

## Staging (before first production deploy)

| Item | Status | Blocker |
| --- | --- | --- |
| `docker compose -f docker-compose.prod.yml up` builds and runs | ❌ not run (no Docker daemon available) | **Blocker** |
| S3/R2 storage: upload, read, delete, account deletion removes prefix | ⚠️ fake S3 server only | **Blocker** |
| HTTPS certificate issued by Caddy; HSTS and CSP headers present | ❌ | **Blocker** |
| `/api/ready` wired to an uptime check; logs shipped; metrics scraped | ❌ | **Blocker** |
| Backup job running; a restore rehearsed into staging | ❌ | **Blocker** |
| Production refuses unsafe configuration | ✅ tested | |
| E2E suite run against staging URL | ❌ | |

## Product & compliance

| Item | Status | Blocker |
| --- | --- | --- |
| Claims review: no "exact", "guaranteed", "perfect fit"; mock never presented as AI | ✅ (2026-11-06) | |
| Privacy page explains every sensitive feature; per-category and account deletion | ✅ | |
| Privacy policy and terms (legal review: GDPR / DPDP / CCPA as applicable) | ❌ | **Blocker** |
| Password reset and email verification | ❌ (`SECURITY_REVIEW.md` R1) | **Blocker** |
| External penetration test | ❌ | **Blocker** |
| Manual accessibility pass (keyboard, screen readers, zoom) | ❌ | **Blocker** |
| Body-scan calibration (`VALIDATION_TRACKING.md` §1) | ❌ | Scan stays labelled uncalibrated |
| Photo checker real-world validation (§2) | ❌ | Not a blocker if labelled |
| Real try-on provider verified (§3) | ❌ | **Blocker for real try-on**; mock-only launch possible with `TRYON_ALLOW_MOCK=true` |
| Provider data-retention terms recorded | ❌ | Blocker for real try-on |

## Definition of Done (per feature or phase)

1. Frontend, backend, database migration and tests are included; no fake success paths.
2. `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm e2e` pass; new flows get an E2E step when
   user-facing.
3. Every user-owned row and file is scoped by user, covered by a cross-user test, and removed by
   the relevant deletion (`DATA_POLICY.md` updated).
4. Uploaded or fetched images are re-encoded; outbound fetches go through `safeFetch`.
5. AI or simulated output is labelled; estimates say they are estimates; no external API is
   described as working unless it has been run and verified.
6. Logs carry no passwords, tokens, images or unnecessary measurements; new analytics properties
   are added to the allow-list deliberately.
7. axe passes at 390/1280 px (light + dark); no horizontal page scrolling from 320 to 1920 px.
8. New configuration has a safe production default or is refused when missing.
9. `docs/PROGRESS.md` and `docs/IMPLEMENTATION_PLAN.md` updated, including what is **not**
   verified.
