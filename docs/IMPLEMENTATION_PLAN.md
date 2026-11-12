# FitVision AI — Implementation Plan

FitVision AI is a fashion virtual try-on platform. Users build a personal body profile and
avatar, add clothing (upload or product URL), and see an AI-generated try-on with a size
recommendation before they buy.

**Core product:** User body + clothing product → AI virtual try-on result.

> Revised 2026-11-04: the product changed from a fitness app to fashion try-on. All fitness
> features (workouts, training plans, form checks, nutrition) were removed from scope.
> Track phase status in `PROGRESS.md`.

## 1. User journey

Sign up → Create profile → Body measurements → Body scan → Generate avatar → Dashboard →
Add clothing / paste product URL → Select clothing → Virtual try-on → View result →
Compare looks / sizes → Save outfit

## 2. MVP scope

| Area | What the user can do |
| --- | --- |
| Account | Register, sign in, sign out, manage profile |
| Onboarding | Enter clothing preference, basic body info and measurements |
| Body profile | Store height, weight and body measurements (versioned history) |
| Body scan | Capture guided front / side / optional back images with the device camera |
| Avatar | Generate a simplified personal body representation |
| Clothing upload | Upload a garment image with name, category, size, colour |
| Product URL | Paste a product URL; import name, images, brand, price, sizes, colours |
| Virtual try-on | Generate an image of the user/avatar wearing the garment |
| Size recommendation | Recommend a size from measurements vs the garment size chart |
| Saved looks | Save, compare and revisit try-on results |

**Product principle:** try-on images and size recommendations are AI-assisted estimates,
never presented as exact. The UI says so wherever results appear.

Out of scope for MVP: native apps, social features, payments/checkout, outfit
recommendations (future).

## 3. Architecture

```
FitVision/                     pnpm workspaces monorepo
├── apps/
│   ├── api/                   Fastify 5 + TypeScript REST API
│   │   ├── src/
│   │   │   ├── app.ts         buildApp(): registers plugins + routes (testable, no listen)
│   │   │   ├── server.ts      entry point: loads config, opens DB, listens
│   │   │   ├── config.ts      env parsing (zod)
│   │   │   ├── db/            Drizzle schema + client; migrations in apps/api/drizzle
│   │   │   ├── plugins/       auth (JWT cookie), error handling
│   │   │   ├── modules/<x>/   one folder per feature (routes, service)
│   │   │   ├── storage/       image storage interface (local disk → S3-compatible later)
│   │   │   └── ai/            try-on provider interface + real & mock implementations
│   │   └── test/
│   └── web/                   React 19 + Vite + React Router SPA
│       └── src/
│           ├── design/        tokens.css, base.css + primitives
│           ├── lib/           api client, auth context, locale helpers
│           ├── features/<x>/  screens + feature components
│           └── app/           router, guards, layout shell
├── packages/
│   └── shared/                zod schemas, types, unit conversion shared by api and web
└── docs/
```

### Key decisions

- **TypeScript everywhere**, strict. Request/response schemas live in `packages/shared` (zod).
- **Database:** PostgreSQL via Drizzle ORM. `DATABASE_URL` set → `node-postgres`; otherwise
  embedded **PGlite** at `apps/api/.data/pglite`. Tests use in-memory PGlite. Migrations
  are generated with `drizzle-kit` and applied on start-up.
- **Units:** everything is stored metric (cm, kg). `profiles.measurement_unit` only controls
  display and input; conversion helpers live in `packages/shared/src/units.ts`.
- **Measurements are append-only** (`body_measurements`): every save is a new row, the latest
  row is current. `source` records `manual`, `body_scan` (server-set) or `corrected`.
- **Auth:** email + password (bcrypt), HS256 JWT in an `httpOnly`, `SameSite=Lax` cookie;
  Vite proxies `/api` so the app is same-origin in dev.
- **Body scan:** capture, quality checks, pose/landmark detection and measurement geometry run
  in the browser behind a `BodyScanProcessor` interface (current implementation: MediaPipe
  Pose Landmarker + deterministic geometry). Height comes from the profile and scales the
  silhouette; inseam and arm length are always manual. Every estimate carries a confidence and
  is reviewed/corrected by the user before saving.
- **Image storage:** a `Storage` interface (put/get/delete by key). Local disk in dev;
  S3-compatible bucket in production. Images are served through authenticated routes, never
  public URLs, because body photos are sensitive.
- **Try-on provider abstraction** (`apps/api/src/ai`): one `TryOnProvider` interface;
  implementations for a hosted model API (e.g. IDM-VTON/CatVTON via a hosted inference
  service) and a `MockTryOnProvider`. Mock output carries `provider: "mock"` and the UI shows
  a "Mock data" badge. A provider is only described as working once tested with real keys.
- **Product URL import:** fetch server-side with strict limits (timeout, size cap, http/https
  only, block private/loopback IPs to prevent SSRF), then parse structured data in order:
  JSON-LD `Product` → Open Graph / meta tags → per-store adapters. Results are always
  editable by the user. Store terms of service must be respected; official APIs preferred.
- **Design system:** CSS custom-property tokens with light/dark themes plus primitives in
  `apps/web/src/design` (Button, TextField, SelectField, ChoiceGroup, Card, Alert, Badge,
  MockDataBadge). Feature code uses tokens, never raw colours.
- **Quality gates:** `pnpm typecheck`, `pnpm lint`, `pnpm test` must pass before a phase is
  marked done.

## 4. Data model

| Table | Phase | Key columns |
| --- | --- | --- |
| `users` | 1 | id, email (unique, lowercased), password_hash, name, created_at |
| `profiles` | 1 | user_id (pk/fk), birth_year?, clothing_preference, height_cm, weight_kg, country (ISO-2), measurement_unit, onboarded_at, updated_at |
| `body_measurements` | 1–2 | id, user_id, height_cm?, chest_cm?, waist_cm?, hips_cm?, shoulder_cm?, inseam_cm?, arm_length_cm?, source (manual / body_scan / corrected), scan_id?, scan_estimates (jsonb: estimates + confidence + proportions), created_at |
| `body_scans` | 2 | id, user_id, status, front_image_path, side_image_path, back_image_path?, processing_version, created_at, completed_at |
| `avatars` | 3 | id, user_id, body_scan_id? (set null when the scan is deleted), measurement_id, model_version, avatar_type, body_parameters_json, asset_path, preview_image_path, status (pending / processing / ready / failed), error, created_at, updated_at; at most one pending/processing per user |
| `products` | 4 | id, user_id, source (manual_upload / product_url / supported_store / future_catalog), source_url?, name, brand?, category, subcategory?, color?, price?, currency?, selected_image_id? (try-on image), metadata_json (description, colours, own size, size-chart unit/kind, import provenance, preparation), created_at, updated_at |
| `product_images` | 4 | id, product_id, image_path (prepared ≤1600 px), original_path (full-res, metadata stripped), source_url?, image_type, position, width, height, perceptual_hash, created_at |
| `product_variants` | 4 | id, product_id, size_label?, color?, sku?, availability? |
| `product_size_measurements` | 4 | id, product_id, variant_id?, size_label, chest/waist/hips/shoulder/inseam/sleeve_cm? (normalised, range midpoint), raw_measurements_json (original text + min/max cm), source, position, created_at |
| `try_on_photos` | 5 | id, user_id, image_path, thumbnail_path, suitability_json (client pose checks + server checks), created_at, deleted_at (soft delete: files removed) |
| `try_on_results` | 5 | id, user_id, product_id, product_image_id, person_photo_id, avatar_id?, provider, model_version, status, source (mock/real), provider_job_id?, result_image_path?, error_code?, error_message? (user-safe), diagnostic (server only), idempotency_key, attempts, created_at, started_at?, completed_at? |
| `size_recommendations` | 6 | id, user_id, product_id, measurement_id, measurement_source, scan_version?, recommended_variant_id?, recommended/alternative size label?, fit_type?, confidence, algorithm_version, comparison_json (full engine output incl. inputs), warnings_json, chart_source, product_updated_at, created_at |
| `saved_looks` | 5 | id, user_id, try_on_result_id (unique), product_id, created_at |

## 5. Phases

Each phase ships frontend screens, API endpoints, DB migrations and tests together.

### Phase 1 — Authentication, fashion onboarding, dashboard, profile
- Auth: register, login (rate limited), logout, `GET /api/auth/me`, protected routes.
- Onboarding (3 steps):
  1. Basic profile — name, clothing preference, measurement unit, height, weight, country,
     optional birth year.
  2. Body measurements — chest/bust, waist, hips, shoulder width, inseam, arm length (all
     optional).
  3. Body scan setup — guidance (fitted clothing, lighting, full body in frame, camera
     position; front, side, optional back captures), then "Finish & start body scan" or skip.
- API: `GET/PUT /api/profile`; `GET /api/measurements/current`, `GET /api/measurements`,
  `POST /api/measurements`.
- Dashboard: My avatar, body profile, Try on something new (paste link / upload), Recent
  try-ons, Saved looks — with empty states for features not yet built.
- Profile page: edit profile and measurements; unit switching converts entered values.

### Phase 2 — Body scan & measurement system ✅
- Flow: camera permission → instructions → front → side → optional back → image quality
  validation → body/pose detection → measurement estimation → review → corrections → save →
  complete. Upload fallback when no camera.
- Per-photo validation: full body, one person, centred, required pose, lighting, blur,
  distance.
- Estimated: shoulder width, chest/bust, waist, hips, proportions (with confidence). Manual:
  inseam, arm length. Height: profile value (proportion check only).
- Save as `body_scan` (estimates accepted) or `corrected` (any estimate edited).
- `POST /api/scans` (multipart), `GET /api/scans`, `GET /api/scans/:id`,
  `GET /api/scans/:id/images/:view` (owner only), `DELETE /api/scans/:id`.
- Follow-up: calibrate geometry against tape-measured ground truth.

### Phase 3 — Avatar generation ✅
- Pipeline (server, behind `AvatarGenerator`): confirmed measurement snapshot → body parameter
  mapping (missing values = typical proportions, flagged) → base mannequin template →
  proportion morph → GLB model + SVG front preview → self-check (model re-measured vs inputs).
- Async job states pending → processing → ready / failed; outdated detection when measurements,
  height or clothing preference change; regenerate replaces the old avatar only once the new
  one is ready; delete.
- Browser viewer (three.js, lazy-loaded): front / side / back, drag-to-rotate, 360° auto-rotate,
  SVG fallback without WebGL.
- Photorealistic / 3D-reconstructed avatars and external providers can replace the generator
  later; face, hair and skin are out of scope.

### Phase 4 — Clothing catalogue & product input ✅
- Upload (1–8 images) or paste a product URL → SSRF-safe fetch (robots.txt respected) →
  importers in priority order: JSON-LD → OpenGraph → store adapters → generic HTML →
  mandatory review/correction → save. Clear fallback when import isn't possible.
- `ProductImporter` interface (`canHandle`, `importProduct`); store adapters slot in later.
- `GarmentProcessor` (validation, orientation, resize, metadata strip, near-duplicate hash);
  background removal / segmentation reserved for Phase 5.
- Size charts normalised to cm with raw values kept (both table orientations, inches, ranges).
- `POST /api/products/import`, `POST/GET/PATCH/DELETE /api/products`, owner-only images.

### Phase 5 — AI virtual try-on ✅ (mock + unverified external adapter)
- User try-on photo (upload / camera / reuse), validated: on-device pose rules decide
  upper / lower / full-body suitability; server checks type, size, dimensions, orientation, blur.
- `VirtualTryOnProvider` (`createTryOn`, `getStatus`, `cancel`, normalised errors, metadata);
  `MockVirtualTryOnProvider` (watermarked, labelled mock), `ReplicateVirtualTryOnProvider`
  (example external adapter, contract-tested only).
- Background jobs (pending / processing / ready / failed / cancelled), server-side polling,
  timeout, retries for transient errors, restart recovery; results copied to private storage.
- Cost protection: per-user rate limit, max active jobs, idempotency keys, one active job per
  photo+garment, daily limit. Third-party disclosure + consent for external providers.
- Saved looks; evaluation harness and model register in `tools/vton-eval`.
- **Not done until a real provider is evaluated and manually tested.**

### Phase 6 — Size & fit recommendation ✅
- Deterministic, versioned `recommendSize()` (`packages/shared/src/sizing.ts`, `size-engine-1.1`):
  latest confirmed measurements + product size chart → category-aware comparison (tops: chest,
  shoulder | dresses: chest, waist, hips | bottoms: waist, hips; secondary measurements inform
  only) → recommended / alternative size, between-sizes, fit (fitted / regular / relaxed),
  confidence (high / medium / low / none) with reasons, per-measurement explanation, warnings.
- Chart quality (complete / partial / insufficient / missing); body vs garment vs unknown charts
  handled differently (garment: conservative minimum ease, confidence capped; flat-measurement
  detection; unknown: confidence reduced). No recommendation rather than a guess.
- No LLM and no try-on image in the calculation. Stored with full inputs (reproducible), stale
  when measurements, the product's size data or the engine version change.
- `tools/sizing-eval`: known-answer cases + determinism check.

### Phase 7 — Wardrobe, feedback & production hardening ✅ (staging verification pending)
- Wardrobe (clothing, favourites, recently viewed, saved looks, recently tried, collections) with
  search, filters and sort; manual collections; manual size-chart entry through the same engine;
  fit feedback stored for offline analysis only.
- Account data controls (per-category deletion, sign out everywhere, account deletion),
  privacy page, security review and fixes, observability (request ids, redacted logs, metrics,
  readiness, pseudonymous analytics), S3/R2 storage, background worker, `APP_ENV` with production
  refusals, Docker/Caddy/compose deployment, CI, Playwright E2E with axe, responsive and CSP
  checks.
- Deferred: comparing two saved looks side by side; self-hosted MediaPipe assets; password
  reset and email verification (needed before public launch).
- Release gates: `docs/RELEASE_CHECKLIST.md`.

## 6. Environment variables (API)

Full annotated list: `apps/api/.env.example` (development) and `deploy/env.production.example`
(staging/production). Production refusals: `docs/DEPLOYMENT.md` §1.

| Var | Default | Notes |
| --- | --- | --- |
| `APP_ENV` | from `NODE_ENV` | `staging`/`production` enable the safety checks |
| `PORT` / `HOST` | `4000` / `127.0.0.1` | |
| `DATABASE_URL` | unset | unset → PGlite at `PGLITE_DIR`; required when deployed |
| `JWT_SECRET` | dev-only fallback | ≥ 32 chars; required when deployed |
| `WEB_ORIGIN` | `http://localhost:5173` | CORS + Origin check; `https://` when deployed |
| `STORAGE_DRIVER` | `local` | `s3` required when deployed (`S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_KEY_PREFIX`, `S3_FORCE_PATH_STYLE`) |
| `STORAGE_DIR` | `.data/uploads` | local driver only |
| `IMPORT_ALLOW_HOSTS` | unset | dev/test only; refused when deployed |
| `TRYON_PROVIDER` | `mock` | must be explicit when deployed; `replicate` needs `REPLICATE_API_TOKEN` + `REPLICATE_MODEL_VERSION` |
| `TRYON_ALLOW_MOCK` / `TRYON_PROVIDER_VERIFIED` | false / false | mock in production / real provider signed off |
| `TRYON_AVATAR_VERIFIED` | false | avatar try-on signed off for the real provider (never for the mock) |
| `TRYON_TIMEOUT_MS` / `TRYON_POLL_MS` | 180000 / 2000 | |
| `TRYON_DAILY_LIMIT` / `TRYON_MAX_ACTIVE` | 20 / 2 | per-user cost protection |
| `TRYON_FAILED_RETENTION_DAYS` | 7 | |
| `JOB_MODE` / `WORKER_POLL_MS` | `inline` / 2000 | `api` + a worker process when deployed |
| `METRICS_TOKEN` | unset | enables `/api/metrics` |
| `LOG_LEVEL` | `debug` (dev) / `info` | |
| `BCRYPT_ROUNDS` | 12 | ≥ 12 when deployed (tests use 4) |
| `AUTH_RATE_LIMIT_MAX` | 10 | login/register attempts per IP per 15 min |

## 7. Calibration (ongoing)

Size-engine behaviour is pinned by known-answer cases in `tools/sizing-eval` (`pnpm --filter @fitvision/sizing-eval eval`).


Scan accuracy is validated separately from the app in `tools/calibration` (protocol, worksheet,
report). Results never go into the app database. See `tools/calibration/README.md`.
