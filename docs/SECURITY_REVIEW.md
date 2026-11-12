# Security review (Phase 7)

An internal review of the code as of 2026-11-06. **It is not an external penetration test**, which
is still recommended before a public launch. Each control below names the test that covers it.

## 1. Authentication & sessions

- bcrypt password hashes (cost ≥ 12 enforced in staging/production); passwords 8–72 bytes (longer
  input is rejected rather than silently truncated by bcrypt).
- Sessions: HS256 JWT in an `httpOnly`, `SameSite=Lax` cookie, `Secure` when deployed, 7-day
  expiry. Each token carries `users.token_version`, checked on **every** request.
  "Sign out everywhere", account deletion and logout-all take effect immediately
  (`hardening.test.ts`).
- Rate limits: login/register per IP (default 10 per 15 min); account-deletion password checks per
  user (5 per 15 min); product import (20 per 10 min) and try-on creation (10 per 10 min) per user.
- Login failures return a generic "Incorrect email or password". Registration does reveal that an
  email is already registered (accepted; mitigated by the rate limit).

## 2. CSRF, headers, CSP

- `SameSite=Lax` cookies, plus an Origin check: any non-GET request with an `Origin` other than
  `WEB_ORIGIN` gets 403 (`hardening.test.ts`).
- API responses: `nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`,
  `Cross-Origin-Resource-Policy: same-origin`, HSTS when deployed, `Cache-Control: no-store` by
  default.
- Web (Caddy, `deploy/security-headers.caddy`): a CSP without `unsafe-eval` (only
  `wasm-unsafe-eval` for MediaPipe), `frame-ancestors 'none'`, `object-src 'none'`, a
  Permissions-Policy allowing only the camera on our own origin. **Verified in Chrome** against the
  production build, including real MediaPipe analysis (`apps/e2e/tests/csp.spec.ts`).

## 3. Uploads & media

- Types are detected from bytes, never from the client's declared content type. Every image is
  decoded and re-encoded with sharp, with pixel limits (`limitInputPixels`), `failOn: 'error'` and
  no animation. This removes EXIF/GPS/XMP metadata and rejects files that only look like images
  (`scans.test.ts`, `products.test.ts`).
- Size limits: multipart part counts and sizes per route (for example 8 MB per scan photo); 1 MB
  JSON bodies; 60 MB at the edge.
- Every media route checks ownership; other users get 404 and signed-out users 401. Media is served
  with `private, no-store` and `nosniff`.

## 4. Product import (SSRF)

- Only `http`/`https` on ports 80/443. Every DNS answer is checked **at connection time** (guarded
  `lookup`), so DNS rebinding can't swap in a private address. Private, loopback, link-local,
  CGNAT, multicast, documentation and IPv4-mapped IPv6 ranges are refused.
- Redirects are re-validated hop by hop (at most 3), with a 10 s timeout and size caps (3 MB pages;
  images capped separately). The server's own cookies are never sent.
- `IMPORT_ALLOW_HOSTS` (a test-only allow-list) is refused in staging and production
  (`net.test.ts`, `products.test.ts`, `hardening.test.ts`).

## 5. AI / try-on provider handling

- The mock is the default and always labelled "Mock result — not AI". In production it only runs
  with `TRYON_ALLOW_MOCK=true`.
- Real providers: explicit per-try-on consent before any image leaves the server; daily and
  concurrency limits per user; server-side timeouts; provider result URLs fetched through the same
  SSRF-safe fetcher with a size cap and re-encoded; raw provider errors are kept as an internal
  diagnostic, while users see a fixed message for each error code. Provider tokens are never sent to the browser.
- A real provider shows "hasn't been fully tested" until `TRYON_PROVIDER_VERIFIED=true`.

## 6. Data access & privacy

- Every query is scoped by `userId`. Cross-user access tests cover products, images, scans,
  try-ons, looks, collections and feedback.
- Account and per-category deletion: see `DATA_POLICY.md`; covered by API and E2E tests.
- Analytics: pseudonymous and allow-listed. Only `scan_started` can be sent by the browser.

## 7. Secrets, configuration, supply chain

- Production refuses unsafe configuration (`config.ts`, `hardening.test.ts`).
- `pnpm check:bundle` scans the built web bundle for secret-shaped strings (canary tested).
- Logs redact cookies, authorization, `set-cookie`, passwords, hashes and tokens.
- Dependencies: lockfile, pnpm `minimumReleaseAge`; new packages are pinned to versions published at
  least 14 days earlier (for example `@aws-sdk/client-s3` 3.1156.0, `@playwright/test` 1.64.1,
  `axe-core` 4.14.0); sharp's install script is disabled (prebuilt binaries).

## 8. Findings fixed during this review

| # | Finding | Fix |
| --- | --- | --- |
| F1 | Body-scan photos were stored as uploaded, keeping EXIF metadata (possibly GPS location). | Re-encoded on upload; test checks the metadata is gone and fake JPEGs are rejected. |
| F2 | Account deletion re-checked the password with no rate limit, a way around the login limit for a session holder. | 5 attempts per user per 15 min; test. |
| F3 | Analytics events survived account deletion. | Deleted with the account; test. |
| F4 | zod's JIT probe (`new Function`) violated the production CSP on every page. | `jitless` mode in the web app; CSP E2E test. |
| F5 | Concurrent migrations from API + worker could race. | PostgreSQL advisory lock; 4 concurrent runs verified. |
| F6 | Mock try-on results also showed "AI-generated preview" text. | Mock results show only the mock notice; test. |

## 9. Open risks (accepted for now, tracked)

| # | Risk | Recommendation |
| --- | --- | --- |
| R1 | No password reset or email verification. | Add before public launch (needs an email provider). |
| R2 | Rate limits are in-memory per instance. | Shared store (Redis) before running multiple API instances. |
| R3 | No MFA. | Optional TOTP for accounts. |
| R4 | MediaPipe WASM and model load from public CDNs (third-party script; the user's IP address is visible to those hosts). | Self-host them under `/vendor` and tighten `script-src`/`connect-src` to `'self'`. |
| R5 | CSP allows `style-src 'unsafe-inline'` (React style attributes). | Acceptable; revisit if inline styles are removed. |
| R6 | No malware scanning of uploads (images are re-encoded, which neutralises most payloads). | Optional. |
| R7 | Real S3/R2 and the Docker images haven't been exercised. | Staging verification (`RELEASE_CHECKLIST.md`). |
| R8 | No external penetration test. | Before public launch. |
