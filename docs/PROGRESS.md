# FitVision AI — Progress

Last updated: 2026-11-06

| Phase | Name | Status |
| --- | --- | --- |
| 1 | Auth, fashion onboarding, dashboard, profile | ✅ Done (browser-verified) |
| 2 | Body scan & measurement system | ✅ Built — accuracy on real bodies **not yet validated** (calibration ongoing) |
| 3 | Avatar generation | ✅ Done (parametric mannequin) |
| 4 | Clothing catalogue & product URL import | ✅ Done (live retailer sites not yet tested) |
| 5 | AI virtual try-on | ✅ Built with mock provider — **not production-ready** until a real provider is evaluated and manually tested |
| 6 | Size & fit recommendation | ✅ Done (engine rules uncalibrated against real purchases) |
| 7 | Wardrobe, feedback & production hardening | ✅ Built — **staging verification pending** (Docker images and real S3/R2 not yet run; see `RELEASE_CHECKLIST.md`) |

## Change log

- **2026-11-11 — Avatar validation run prepared (not yet run).**
  - Target: Replicate IDM-VTON `0513734a…` (latest version; A100 80GB; Replicate quotes about
    $0.024 and 18 s per run; CC BY-NC-SA 4.0, so technical evaluation only).
  - The harness now records prediction ids, fetches the billed `predict_time` and version to
    compute actual cost, adds the `acceptable` review field, and writes `avatar-contact-sheet.html`.
  - It reads credentials from `tools/vton-eval/.env` (git-ignored), never from the app.
  - 10 tool tests pass.
  - **Blocked:** `REPLICATE_API_TOKEN` is still not configured, so no real run has happened.
    `TRYON_AVATAR_VERIFIED` stays false; the app pipeline and default renderer are unchanged.
- **2026-11-06 — Avatar try-on validation tooling (real provider not yet run).** Added
  `tools/vton-eval` §5:
  - 5 avatar body shapes rendered with the app's renderer (`avatar-render-1.0-flat` = app
    `avatar-front-render-1`) and 9 synthetic flat-lay garments, giving 24 balanced cases;
  - `avatar-sheet`, with automatic unchanged and changed-region checks plus the review fields;
  - `avatar-summary`, which applies the pass criteria per provider × render style and never
    counts the mock.

  8 tool tests pass. A mock-only dry run completed 24/24 and was reported as NOT ELIGIBLE.
  **Blocked:** no Replicate (or other provider) credentials are configured, so no real provider
  has been run. `TRYON_AVATAR_VERIFIED` stays false. The app pipeline is unchanged.
- **2026-11-06 — Avatar try-on: inputs vs. generated result.** The avatar render is only the
  person input; the result page shows only the provider's output under "Visual try-on result".
  "Compare with my avatar" and "View garment" show the inputs beside it, followed by Regenerate and
  Save look. The confirmation step shows "Avatar input" + "Selected garment input" → Generate. The
  mock provider now knocks out the garment's background, lays it over the body region, and burns in
  "MOCK TRY-ON RESULT — NOT AI GENERATED" (top and bottom) plus a diagonal "MOCK — NOT AI". The job
  rejects any provider result that is visually the unchanged person input (`generation_failed`).
  New `TRYON_AVATAR_VERIFIED` (default false, never true for the mock): a real provider shows an
  "avatar try-on hasn't been verified" warning. Tests: an API integration test using the real mock
  provider checks that the person image equals the stored render, the garment image equals the
  stored garment, the region is right, the result path differs from the render path, and the
  result URL serves the generated output (garment pixels and watermark present). Also a guard test,
  web tests for the result card and the inputs summary, and an E2E check that the result image bytes
  differ from the avatar's. API 143, web 73, E2E 13/13. **Still not verified:** any real VTON model
  dressing the avatar.
- **2026-11-06 — Avatar try-on** (try a garment on the saved avatar instead of a photo). The server
  renders the avatar's stored GLB from the front (`avatar-front-render-1`: deterministic software
  rasteriser, neutral background, 768×1024, upper-body framing for tops/shirts/T-shirts/jackets,
  full body for dresses and bottoms). The render is stored as a try-on photo (`source =
  avatar_render`, avatar id and model version) and goes through the unchanged
  `VirtualTryOnProvider` pipeline. Results record `person_source` (uploaded_photo /
  camera_photo / saved_photo / avatar_render) plus the avatar id and model version (migration
  `0010_avatar_try_on`, with a backfill of `saved_photo` for reused photos). UI: "Use my avatar"
  next to Upload and Take photo, "Using your avatar" with the approximate-preview notice, "Use a
  photo instead", and "Create my avatar" when there is none. Renders are deleted with the avatar.
  Verified: API 141 tests (also on PostgreSQL 18.4), web 72, E2E 13/13, including the full
  avatar flow in Chrome with an axe check. **Not verified:** how a real try-on provider handles a
  mannequin render (only the mock provider was run; a real model trained on photos of people may
  give poor results on a smooth mannequin). The backfill SQL ran on databases with no earlier
  try-ons only.
- **2026-11-06 — Phase 7 built** (wardrobe, collections, manual size charts, fit feedback, account
  data controls, security hardening, observability, S3 storage, worker, Docker/Caddy deployment,
  Playwright E2E with accessibility/responsive/CSP checks, release docs). **Dependency changes:**
  `@aws-sdk/client-s3` 3.1156.0 (api), `esbuild` 0.28.2 (api build, already in the lockfile),
  new `apps/e2e` package with `@playwright/test` 1.64.1 and `axe-core` 4.14.0. All pinned to
  versions published at least 14 days earlier.
- **2026-11-05 — Phase 6 built** (deterministic size engine `size-engine-1.1`, "Find my size",
  stale detection, separate size card on try-on results, `tools/sizing-eval`).

- **2026-11-05 — Phase 5 built** (try-on photos, provider abstraction, mock + unverified
  Replicate adapter, background jobs, results, saved looks, evaluation harness). Test-speed
  change: bcrypt cost and auth rate limit are configurable (production defaults unchanged and
  enforced); root `pnpm test` runs packages one at a time.
- **2026-11-04 — Phase 4 built** (clothing upload, product-link import, review, library, size
  charts). **Dependency change:** `@mediapipe/tasks-vision` pinned from 1.2.2 (published
  2026-11-03, rejected by pnpm's minimum-release-age policy) to **1.1.1**; lockfile rebuilt —
  the only resolved-version change was MediaPipe. Scan re-verified in Chrome.
- **2026-11-04 — Phase 3 built** (parametric avatar, viewer, job states, outdated/regenerate,
  delete) and **calibration tooling** for Phase 2 added (`tools/calibration`).
- **2026-11-04 — Phase 2 built** (camera body scan, measurement estimation, review & save).
- **2026-11-04 — Phase 1 final adjustments:** imperial height as feet + inches, field errors
  clear on edit, mobile header and dashboard layout fixes, onboarding can go straight into the
  scan.
- **2026-11-04 — Product pivot** from fitness to fashion virtual try-on. All fitness features
  removed.

## Phase 1 — Auth, fashion onboarding, dashboard, profile ✅

### Delivered
- Auth: register, login (rate limited 10 / 15 min / IP), logout, `GET /api/auth/me`; HS256 JWT
  in an `httpOnly`, `SameSite=Lax` cookie.
- Onboarding (3 steps): basic profile → optional body measurements → body-scan guidance. The
  last step offers **Finish & start body scan** or **Skip scan for now**.
- Units: metric (cm, kg) or imperial (**feet + inches**, lb). Values are always stored in cm/kg.
  Switching units converts entered values; range errors are shown in the chosen unit.
- Dashboard (avatar placeholder + scan entry, body profile with measurement source, try-on
  placeholders, empty states, accuracy note) and Profile page (profile, measurements, body
  scan card).
- API: `GET/PUT /api/profile`, `GET /api/measurements/current`, `GET /api/measurements`,
  `POST /api/measurements` (manual / corrected).

### Browser verification (Chrome via Playwright, 2026-11-04)
Checked registration, login (incl. wrong-password error), all 3 onboarding steps, unit
switching (5′5″ / 128 lb ↔ 165.1 cm / 58.1 kg, round trip exact), validation states, dashboard,
profile, light and dark mode, desktop (1280 px) and mobile (390 px). No console/page errors and
no horizontal overflow.

Issues found and fixed during the review:
- Validation messages stayed visible after the field was corrected (now cleared on edit).
- Mobile header: "Sign out" sat next to the logo instead of the right edge.
- Dashboard: body-profile card stretched to the avatar card's height.
- "Finish & start body scan" was redirected to the dashboard by the onboarding guard
  (race between the user update and navigation) — the guard now checks once on entry.

## Phase 2 — Body scan & measurement system ✅

### Flow
Camera permission → instructions (self-timer 0/5/10 s) → front → side → optional back →
per-photo validation → estimation → review & correct → save → scan complete.
"Upload photo" is available at every capture step (and "Upload photos instead" when the camera
is blocked or unavailable).

### Capture validation (each photo, before it can be used)
Lighting (too dark / overexposed), sharpness (Laplacian variance), one person only, full body
visible (key landmarks in frame; segmentation must not touch the top/bottom edge), body
centred, camera distance (too close / too far), required pose (front: facing camera with arms
slightly out; side: turned 90°; back: facing away). Failed checks show what to fix; the photo
can't be accepted until all pass.

### Measurement strategy
- **Estimated:** shoulder width (shoulder landmarks), chest/bust, waist, hips (front silhouette
  width + side depth → ellipse circumference), plus proportions (shoulder-to-hip,
  waist-to-hip, leg-to-height, body shape).
- **Scale:** the user's entered height is the primary height value and scales the silhouette.
  Absolute height can't be measured from an uncalibrated photo; instead the leg-to-height
  proportion is checked and a warning asks the user to check their height if it looks
  inconsistent.
- **Not estimated:** inseam and arm length — always entered manually on the review screen
  (pre-filled from previous measurements if any).
- **Confidence** per estimate (landmark visibility, depth/width plausibility, arm-contact
  detection, front/back agreement). Values below 0.6 are highlighted for review.
- Every value can be edited before saving. The required disclaimer is shown on the review and
  completion screens, onboarding step 3 and the profile measurements card.

### Saving
- One multipart request: `POST /api/scans` (front + side required, back optional; JPEG/PNG/WebP
  detected from file bytes, 8 MB per photo) with the scan output and the confirmed values.
- `body_scans` stores scan metadata only (status, image paths, processing version, timestamps).
  Results go to `body_measurements` with `scan_id` and `scan_estimates` (raw estimates +
  confidence + proportions).
- Source: **`body_scan`** when every estimate is accepted unchanged; **`corrected`** when any
  estimate is edited or cleared (decided server-side; untouched values are sent exactly, so
  imperial display rounding is never mistaken for a correction).
- Images: stored privately (`apps/api/.data/uploads`, files mode 600) and served only via
  `GET /api/scans/:id/images/:view` to the owner (`private, no-store`, `nosniff`); other users
  get 404, signed-out requests 401. `DELETE /api/scans/:id` removes photos and the scan record
  and keeps the measurements (unlinked).

### Architecture
- `apps/web/src/features/scan/engine/types.ts` defines `BodyScanProcessor`; screens depend only
  on it. `createBodyScanProcessor()` is the single place that picks an implementation.
- Current implementation: `MediaPipeBodyScanProcessor` (Pose Landmarker full, float16, with
  segmentation, `numPoses: 2`) + pure modules `quality.ts`, `poseChecks.ts`, `geometry.ts`.
- `processing_version` recorded per scan: `mediapipe-pose-full-1.2.2+geom-0.1-uncalibrated`.

### Verification (2026-11-04)
- `pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm test` ✅ **73 tests** (shared 13, api 24, web 36),
  including engine tests on a synthetic silhouette with known dimensions. `pnpm build` ✅
  (MediaPipe is a separate lazily-loaded chunk).
- Real Chrome with a fake camera: permission → instructions → live capture → MediaPipe loaded
  (~10–14 s first time, mostly the model download) and correctly rejected the frame
  ("No person detected"); upload path rejected a non-person image; layouts checked on desktop,
  mobile and dark mode.
- Real API from the browser: scan saved (`corrected` when a value was edited), shown on
  dashboard and profile; scan photo → 401 signed out, 200 for owner with `private, no-store`.

### Not yet verified / known limitations
- **No real person has been scanned.** The end-to-end success path (accepted photos →
  estimates → review → save) is covered by unit/component tests with synthetic data and a fake
  processor, not by a real body in front of a camera. Pose thresholds and the geometry are
  **uncalibrated heuristics**; estimates must be compared with tape measurements on a set of
  volunteers before they are relied on (calibration factors are in `geometry.ts`).
- Ellipse circumferences typically under/over-estimate specific body regions; loose clothing,
  hair and background clutter affect the silhouette.
- MediaPipe WASM and model are loaded from jsDelivr and Google Cloud Storage at runtime (no
  photos are sent there). Self-host them before production (Phase 7).
- Scan photos are stored on local disk; production needs encrypted object storage, a retention
  policy and account-deletion cleanup (Phase 7).
- Browser-run test accounts (`browser-*`, `scan-*`, `avatar-*`, `calibration-check-*`
  `@example.com`) and synthetic scan images exist in the local dev database; delete
  `apps/api/.data` to reset.

### Carried over
- Logout doesn't revoke JWTs before expiry; rate-limit store is in-memory; no password reset or
  email verification.
- Dependencies are installed with pnpm (`npm install` exits silently in the dev sandbox).

## Phase 3 — Avatar generation ✅

### What it is (and isn't)
A **parametric 3D mannequin** shaped from the user's confirmed measurements. It is not a
photo-based reconstruction and not AI-generated; no face, hair or skin. The UI labels it
"Approximate · parametric model" and shows the required disclaimer on the avatar page and
dashboard.

### Pipeline (server, `apps/api/src/avatar`)
1. **Confirmed measurement snapshot** — latest saved measurement set + profile height (primary
   height) + clothing preference (`modules/avatars/snapshot.ts`).
2. **Body parameter mapping** (`parameters.ts`) — every value marked `measured` or `default`
   (typical proportion of height, by clothing preference); girths → torso width/depth using
   typical depth ratios (ellipse solve).
3. **Base model + morph** (`mesh.ts`) — elliptical cross-section template: inseam fixes the
   crotch; hip/waist/chest/shoulder sections match the parameters; legs, arms (A-pose), head,
   hands and feet follow template tapers.
4. **Generation** (`generator.ts`, `ParametricAvatarGenerator` behind the `AvatarGenerator`
   interface) — GLB model (glTF 2.0, metres, y-up) + SVG front preview.
5. **Self-check** — the generated mesh is re-measured (height, shoulder width, crotch height,
   girths sliced at chest/waist/hip) and compared with the parameters; stored as `fidelity`.
   Typical result: height/shoulder/inseam within 0.1 cm, girths within 0.5 %. This shows the
   model reflects its inputs — **not** that it matches the person.

### API
`GET /api/avatars/current` (avatar + `outdated` + `canGenerate`), `POST /api/avatars`
(202; returns the in-flight job if one exists — a partial unique index guarantees one active
job per user), `GET /api/avatars/:id/asset` (GLB) and `/preview` (SVG, sandboxed CSP) — owner
only, `private, no-store` — and `DELETE /api/avatars/:id`.
Jobs run in-process (pending → processing → ready / failed). Jobs interrupted by a restart are
marked failed on start-up. A new avatar replaces older ones only once it is ready, so a failed
regeneration never removes a working avatar. Deleting a body scan keeps the avatar
(`body_scan_id` set to null).

### Web
`/avatar` page (nav: Avatar): create, pending/processing status with polling, failed + retry,
ready → three.js viewer (lazy-loaded chunk) with Front / Side / Back, drag-to-rotate and 360°
auto-rotate, SVG fallback without WebGL; "Built from" list showing measured vs typical values;
outdated banner → Regenerate; Delete. Dashboard shows the preview and status; the scan
completion screen links to "Create my avatar".

### Verification (2026-11-04)
- `pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm test` ✅ **97 tests** (shared 13, api 39, web 40,
  calibration 5) · `pnpm build` ✅.
- API tests cover generation states, versions stored, outdated detection, regeneration
  replacing the old avatar, concurrent requests (one job), failure handling, owner-only files,
  delete, and avatar surviving scan deletion.
- Real Chrome (WebGL via SwiftShader): avatar generated and rendered; front/side/back, drag
  rotation and auto-rotate checked; changing waist 70 → 82 cm made the avatar outdated and
  regeneration showed 82 cm; signed-out model request → 401; delete works; dark mode and
  mobile layouts checked. Fixed during review: a dark flat crotch cap, a React effect warning,
  and badge wrapping on mobile.

### Known limitations
- Shape is a simple lofted mannequin: proportions follow the measurements, but body contours
  (e.g. bust shape, shoulder slope, posture) use one neutral template.
- Torso depth comes from typical depth/width ratios, not from the scan's side view.
- Missing measurements fall back to population-typical ratios (shown as "Typical, not
  measured"); those ratios are approximate.
- three.js chunk is ~710 kB (184 kB gzip), loaded only on the avatar page.
- Database migration `0004` was regenerated during development and then restored to its
  originally applied form; the unique "one active job" index is `0005`.

## Calibration of Phase 2 scan measurements (ongoing)

`tools/calibration` (kept out of the app database):
- `README.md` — consent, pseudonymous codes, tape-measurement protocol (two readings, re-measure
  if > 1 cm apart), scan protocol using a dedicated calibration account.
- `worksheet-template.csv` — one row per volunteer; real data goes in `tools/calibration/data/`
  (git-ignored).
- `pnpm calibration:fetch -- --delete-scan` — prints the calibration account's latest raw scan
  estimates as worksheet columns and deletes the photos (verified against the dev API).
- `pnpm calibration:report <csv>` — per algorithm version: bias, MAE, RMSE, MAPE, ±2/±4 cm
  rates, least-squares factor with leave-one-out MAE, error by confidence band, verdict against
  **proposed** targets (MAE ≤ 3 cm / |bias| ≤ 1.5 cm for chest, waist, hips; ≤ 2 / 1 cm for
  shoulder; n ≥ 20).
- **No volunteer data has been collected yet.** Until a report passes, scan estimates must be
  treated as unvalidated.

## Phase 4 — Clothing catalogue & product URL import ✅

### Delivered
- **Upload clothing:** 1–8 images (JPEG/PNG/WebP/AVIF/GIF, ≤ 10 MB each, checked in the browser
  and again on the server), name, brand, category (Tops, Shirts, T-shirts, Jackets, Dresses,
  Trousers/Pants, Jeans, Skirts, Shorts), subcategory, colour, own size, available sizes, price,
  currency, product link, description; choose the try-on image and label each image's type.
- **Paste product link:** validate → SSRF-safe fetch → extract → **review screen** (every field
  editable, origin shown per field: "From the product data" / "From the page metadata" / "From
  the page text — please check" / "Not found on the page", warnings, possible duplicates,
  image include/exclude + type + try-on choice, size chart with original values) → save. Images
  chosen during review are downloaded server-side (same protections) into private storage, so
  saved products don't depend on hotlinks.
- **Fallback** whenever import can't complete: "Import could not be completed automatically.
  Upload the garment image or enter the product details manually." plus the specific reason,
  and a one-click switch to upload with the link kept.
- **Import strategy** (`apps/api/src/products/import`): `ProductImporter` interface
  (`canHandle`, `importProduct`); `StructuredDataImporter` (JSON-LD Product/ProductGroup, variants,
  offers, breadcrumbs, `@graph`) → `OpenGraphImporter` → *(store adapters — none yet)* →
  `GenericHtmlImporter` (h1/title, gallery images, size/colour selects, size-chart tables). First
  non-empty value wins; category mapped by keyword with footwear/accessories flagged as
  unsupported; descriptions reduced to plain text.
- **Security:** http/https only; ports 80/443; no credentials in URLs; localhost / `.local` /
  `.internal` names rejected; every resolved address must be public unicast (private,
  loopback, link-local incl. 169.254.169.254, CGNAT, unique-local, IPv4-mapped all rejected),
  checked at connection time (DNS-rebinding safe); redirects followed manually (max 3) and
  re-checked; 10 s timeout; 3 MB page / 10 MB image limits enforced while streaming and after
  decompression; content-type allow-list; robots.txt respected (RFC 9309); no cookies or
  credentials sent; page JavaScript never executed (parsed with cheerio). Import endpoint rate
  limited (20 / 10 min per user). Dev-only `IMPORT_ALLOW_HOSTS` exception refuses to start in
  production.
- **GarmentProcessor** (`SharpGarmentProcessor`, `sharp-basic-0.1`): format detected from bytes,
  ≥ 200 px, ≤ 40 MP, EXIF orientation applied, all metadata (incl. GPS) stripped, original
  (≤ 4096 px) and try-on copy (≤ 1600 px) stored as WebP, perceptual fingerprint (dHash + mean
  colour) to skip duplicate images and flag similar products. Background removal reported as
  `not_available` — **no segmentation is implemented**.
- **Data model:** `products`, `product_images`, `product_variants`,
  `product_size_measurements` (migration `0006`). Size charts normalised to cm (range midpoints)
  with raw text and min/max retained; body vs garment measurements recorded when stated.
- **Library:** `/clothing` (cards: image, name, brand, category, source, sizes; View / Edit /
  Delete / "Try on · Phase 5" disabled), `/clothing/:id` (gallery, details, size chart, edit
  incl. try-on image, image types, removing images), dashboard "Try on something new" enabled
  and "My clothing" section.

### Verification (2026-11-04)
- `pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm test` ✅ **146 tests** (shared 13, api 82, web 46,
  calibration 5) · `pnpm build` ✅. API tests run against a local fixture "retailer" (no live
  sites): invalid URL, non-http schemes, localhost/private/metadata IPs, DNS → private,
  redirect into a private IP, redirect loop, oversized streamed page, non-HTML content, 403,
  robots.txt disallow, no product data, JSON-LD / OpenGraph / HTML extraction, missing fields,
  user edits, multiple images, duplicate skipping, non-image and oversized uploads, size-chart
  normalisation, ownership (401/404), editing, deletion.
- Real Chrome against a throwaway stack (separate DB, fixture site): import → review → edit →
  save; size chart in inches shown in cm; fallback for blocked site, cloud-metadata IP, the
  API's own localhost and a robots-disallowed page; upload with file rejection; edit; delete;
  signed-out image → 401; dark mode and mobile. Fixed during review: raw HTML in imported
  descriptions, a misleading "not found" hint for colour, confusing try-on wording, mobile nav
  clipping, and perceptual hashing that treated colour variants as duplicates and was unstable
  on flat backgrounds.

### Not yet verified / limitations
- **No live retailer site has been tested.** Many stores block automated access or render
  product data with JavaScript (which we deliberately don't execute); those will fall back to
  manual entry. Testing against the stores you care about — and adding store adapters or
  official APIs for them — is the next step.
- Page encoding is assumed UTF-8.
- Image types (front / back / on model) are chosen by the user; nothing is auto-classified.
- Size charts embedded as images or loaded by JavaScript can't be read.
- Adding new images to an existing product isn't supported yet (remove/relabel is).

## Phase 5 — AI virtual try-on ✅ (mock) / ⚠️ real provider pending

### Delivered
- **Try-on photos** (`try_on_photos`): upload, take with the camera (5 s timer) or reuse a saved
  photo; capture guidance shown. In the browser, the on-device pose model (same as the body scan)
  checks one person, facing camera, size in frame, lighting, blur and which regions are visible
  → suitability for upper-body / lower-body / full-body garments, with reasons. The server
  re-checks file type (from bytes), ≤ 12 MB, ≥ 384 × 512 px, ≤ 40 MP, orientation (applied),
  blur (Laplacian variance), strips metadata, stores a ≤ 2048 px copy + thumbnail privately.
  Body-scan photos are never reused automatically. Deleting a photo removes its files
  immediately (row kept, `deleted_at`, so past results stay listed).
- **Garment input:** the product's try-on image (or another of its images); categories map to
  provider regions (tops/shirts/t-shirts/jackets → upper; trousers/jeans/skirts/shorts → lower;
  dresses → full). Unsupported categories, small images and detail/lifestyle shots are refused
  with an explanation; on-model images get a hint.
- **Provider abstraction** (`apps/api/src/tryon`): `VirtualTryOnProvider` with `createTryOn`,
  `getStatus`, `cancel`, normalised `TryOnProviderError` (timeout / moderation / rate_limited /
  unavailable / invalid_input / failed, retryable flag) and metadata (provider, model, source,
  external, verified, cost). Implementations:
  - `MockVirtualTryOnProvider` (default): pastes the garment over the photo and burns
    **"MOCK RESULT — NOT AI-GENERATED"** into the image; `source = mock`; UI shows a mock badge
    and notice everywhere.
  - `ReplicateVirtualTryOnProvider`: example external adapter (IDM-VTON-style inputs on
    Replicate's predictions API). **Unverified** — contract-tested against a local fake only;
    never called the real service; marked `verified: false` and the UI says so.
- **Jobs** (`modules/tryon/jobs.ts`): pending → processing → ready / failed / cancelled;
  provider polled server-side (browser polls our API; users can leave and return); server-side
  timeout (cancels at the provider); transient submission errors retried with backoff (3
  attempts), permanent ones fail immediately; restart recovery (processing jobs with a provider
  id resume, never-submitted ones restart); results always copied into private storage
  (provider URLs fetched with the SSRF-safe fetcher). Raw provider messages only in server logs
  and the internal `diagnostic` column; users see fixed messages per error code.
- **Data:** `try_on_results` records provider, model version, source, provider job id,
  created/started/completed timestamps, attempts, error code + user message; `saved_looks`
  references results (no image duplication). Migration `0007`.
- **Cost / concurrency protection (server-side):** create rate limit (10 / 10 min / user), max
  active jobs per user (default 2), idempotency key per submit (unique per user), one active job
  per photo + garment (partial unique index), daily limit (default 20 / UTC day), provider
  timeout.
- **Privacy:** person photos, results and saved looks are owner-only (`private, no-store`);
  ids are random UUIDs; images aren't logged; the Replicate adapter sends images inline (no
  temporary uploads to clean up); failed/cancelled attempts are purged after 7 days
  (configurable); users can delete photos, results and looks. External providers require an
  explicit consent checkbox (server enforces `acknowledgeThirdParty`) with a disclosure that the
  photo goes to a third-party AI service.
- **UI:** product page / cards → **Try on** → photo → garment image → generate (mock notice or
  third-party disclosure, daily usage) → result page (processing with cancel, failure with
  retry, result with compare [your photo | result | garment], save look, regenerate, delete,
  back to product, disclaimer). `/try-ons` lists try-ons and saved looks; dashboard "Recent
  try-ons" and "Saved looks" are live; product page lists its try-ons.
- **Evaluation** (`tools/vton-eval`, outside the app): runs the same manifest through every
  configured provider via the same interface, records latency / failures / cost, writes outputs,
  an HTML contact sheet and a scoring sheet for the 10 review criteria; `summarize` produces the
  comparison. `models.md` is the open-source licence/ops register — the licences listed there are
  **reported, unverified leads** (several popular VTON models appear to be non-commercial).

### Verification (2026-11-05)
- `pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm test` ✅ **178 tests** (shared 13, api 102,
  web 55, calibration 5, vton-eval 3) · `pnpm build` ✅.
- API tests (fake provider, no paid services): photo validation & privacy, product / photo /
  result ownership, unsupported garment, unsuitable photo & garment image, idempotent and
  duplicate submits, concurrency limit, daily limit, state transitions, server timeout with
  provider cancel, provider failure mapping (raw details hidden), retry/give-up, restart
  recovery, consent for external providers, saved looks, result deletion, mock labelling;
  Replicate adapter contract tests.
- Real Chrome on the dev server (mock provider): real MediaPipe analysis rejected a synthetic
  non-person photo ("No person was detected", save disabled); with a photo registered through
  the API: generate → processing → leave and return → result → compare → save look → regenerate
  → delete; result image 401 when signed out; dashboard and mobile layouts checked.
- Evaluation harness smoke-run with the mock provider (outputs, contact sheet, scoring sheet,
  summary).

### Not verified / blockers
- **No real try-on provider has been run.** Phase 5 must not be described as production-ready
  until providers are compared with `tools/vton-eval` on consented test photos, a provider is
  chosen (quality, licence/terms, cost, data handling) and the full flow is manually tested.
  This needs API credentials and a budget decision from you.
- **The positive photo-suitability path wasn't exercised with a real person in the browser** (no
  consented photos available); the rules are unit-tested on synthetic pose data.
- Pose suitability is computed in the browser; the server stores it but can't re-run pose
  detection, so a modified client could submit an unsuitable photo (the provider then just
  produces a poor result — no security impact).
- Webhooks aren't implemented (polling only); the job model is ready for them.

## Phase 6 — Size & fit recommendation ✅

### Delivered
- **Engine** (`packages/shared/src/sizing.ts`, `recommendSize`, version `size-engine-1.1`): a pure
  function — same inputs, same output; no clock, randomness, LLM or try-on image. Shared by the
  API and the evaluation tool.
  - Category requirements: tops / shirts / t-shirts / jackets → chest + shoulder (waist, sleeve
    secondary); dresses → chest, waist, hips (height noted as not compared); trousers / jeans /
    shorts → waist + hips (inseam secondary); skirts → waist + hips. Unrelated measurements are
    never required.
  - Chart quality: complete / partial / insufficient / missing. Labels-only or irrelevant
    charts → **no recommendation** with the required message.
  - Per measurement and size: inside / near boundary (0.5 cm) / between / below smallest /
    above largest / unavailable. Single-value charts get ranges from midpoints between sizes;
    charts listed largest-first are reordered.
  - Body charts: recommends the size that fits every primary measurement comfortably (largest
    needed), explains conflicts ("Your chest / bust and waist measurements align with M, while
    your hips measurement aligns more closely with L. We recommend L…"), offers the smaller size
    as the alternative, shows "Between M and L" with closer/relaxed guidance, and refuses when a
    measurement is > 2 cm beyond the largest size.
  - Garment charts: compared with conservative minimum ease (e.g. chest +4 cm), confidence capped
    at medium, flat (half) measurements detected and refused. Unknown chart type → treated as
    body chart with reduced confidence and a warning.
  - Confidence by explicit rules (High only for a complete body chart, all key measurements,
    comfortably inside one size, user-entered or corrected measurements; uncalibrated body-scan
    values cap at Medium; big conflicts or edge-of-chart → Low), with the reasons listed.
  - Output: recommended / alternative size, between-sizes, fit (fitted / regular / relaxed),
    confidence + reasons, summary, per-measurement breakdown, warnings, notes, chart source and
    the full inputs.
- **API:** `POST /api/products/:id/size-recommendation` (compute from the latest confirmed
  measurements, store) and `GET` (latest + stale reasons: measurements changed, product size data
  changed, engine updated). `size_recommendations` stores measurement id, source and scan version,
  matched variant, result columns and the full comparison JSON (migration `0008`). Owner-only.
- **UI:** product page "Size recommendation" card → **Find my size** → recommended size or
  "Between M and L", confidence, fit, explanation, alternative, measurement table, warnings,
  "Why this confidence?", what it was based on, disclaimer, stale banner with **Recalculate**,
  and a "no recommendation" state. Try-on results label the image "Visual preview" and show a
  separate compact size card stating that the size isn't derived from the image.
- **Evaluation** (`tools/sizing-eval`, synthetic data only): 23 known-answer cases — inside range,
  between sizes, one- and two-size conflicts, near boundary, missing user measurements, inches,
  single values, partial / insufficient / labels-only / missing charts, garment and flat garment
  charts, unknown chart type, XS–2XL (descending), 32/34/36, 8/10/12, beyond the largest size,
  uncalibrated scan, size not offered — each also checked for identical output on a second run.

### Verification (2026-11-05)
- `pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm test` ✅ **212 tests** (shared 13, api 106, web 62,
  calibration 5, sizing-eval 23, vton-eval 3) · `pnpm build` ✅.
- API tests: no measurements, stored snapshot + variant, replaying stored inputs reproduces the
  stored result exactly, stale after measurement change and after a size-chart edit, recompute,
  no-chart product, ownership.
- Real Chrome (dev server): Find my size on a conflicting body (L, medium, explanation), measurement
  change → stale banner → Recalculate → M; no-chart product → no recommendation; try-on result
  with separate visual preview and size cards; between-sizes on mobile and dark mode. Fixed during
  review: duplicated wording in the fit label, a height note shown as a warning, header badge
  overflow on mobile.

### Not yet verified / limitations
- The rules (0.5 cm boundary, 2 cm edge tolerance, garment ease minimums, confidence levels) are
  reasoned defaults, **not calibrated against real purchases or returns**. The known-answer cases
  pin today's behaviour; real-world validation (e.g. returns data or user feedback) is needed.
- Size charts only exist for imported products (plus the API); there's no manual size-chart entry
  in the UI yet, and no brand-level charts.
- Recommendation accuracy also depends on the uncalibrated Phase 2 scan when measurements come
  from a scan (confidence is capped at Medium in that case).

## Phase 7 — Wardrobe, feedback & production hardening ✅ (staging pending)

### Delivered
- **Wardrobe** (`/wardrobe`, replaces `/clothing`): tabs for My clothing, Favourites, Recently
  viewed, Saved looks, Recently tried and Collections. Search, filters (category, brand, colour,
  collection) and sort (newest, oldest, recently viewed, name) are kept in the URL; actions are
  open, try on, find my size, edit, delete and remove look.
- **Collections** (`wardrobe_collections`, `wardrobe_collection_items`): created manually, with
  suggested names; rename, delete, add and remove items. Nothing is auto-generated.
- **Manual size-chart entry** on the product page: label + chest/waist/hips/shoulder/inseam/sleeve,
  cm or inches, ranges and fractions, body/garment/unknown. A review screen comes before saving.
  The saved chart has the same shape as an imported one and goes through the same size engine
  (no separate path).
- **Fit feedback** (`size_feedback`): too small … too large, size bought, returned and reason.
  Snapshots the recommended size, engine version, brand and category. **Never changes the engine**;
  offline export (`export-feedback`, pseudonymous) and report (`sizing-eval feedback`).
- **Account data controls** (`/privacy`): explains each sensitive feature, deletes each data
  category, signs out everywhere (session revocation by token version) and deletes the account with
  its password (rows, files, analytics events, running provider jobs). Policy: `DATA_POLICY.md`.
- **Security:** Origin check, security headers, production CSP (Caddy), scan photos re-encoded to
  strip EXIF/GPS, rate limit on account-deletion password checks, unsafe production configuration
  refused. Review: `SECURITY_REVIEW.md` (6 findings fixed, 8 open risks listed).
- **Observability:** request ids, structured redacted logs, error reporter hook, Prometheus
  metrics (bearer token), `/api/health` and `/api/ready`, pseudonymous analytics for the 11 funnel
  events.
- **Infrastructure:** S3/R2 storage driver (SSE, prefix deletion); `JOB_MODE` inline/api/worker with
  `worker.ts` and atomic job claims; `migrate.ts` with a PostgreSQL advisory lock; `APP_ENV`
  development/test/staging/production; esbuild production bundle; `Dockerfile` (api/web targets),
  `docker-compose.prod.yml` (Postgres, migrate, api, worker, Caddy HTTPS); CI workflow;
  `pnpm seed` (development-only demo data, random password, labelled "Demo").
- **Claims review:** removed "AI-assisted" wording for the rule-based size engine; mock try-on
  results no longer also show the "AI-generated preview" disclaimer; internal phase names removed
  from the UI.
- **Docs:** `DEPLOYMENT.md`, `SECURITY_REVIEW.md`, `DATA_POLICY.md`, `VALIDATION_TRACKING.md`
  (+ photo-validation template), `ACCESSIBILITY.md`, `RELEASE_CHECKLIST.md` (with the Definition
  of Done).

### Verification (2026-11-06)
- `pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm test` ✅ **252 tests** (shared 14, api 136, web 69,
  calibration 5, sizing-eval 25, vton-eval 3) · `pnpm build` ✅ · `pnpm check:bundle` ✅ ·
  sizing-eval 23/23.
- **API suite on real PostgreSQL 16.10 and 18.4** ✅; migrate twice is idempotent; 4 concurrent
  migrate processes are safe; `pg_dump`/`pg_restore` round-trip and migrate on the restore is a
  no-op.
- **Playwright E2E 13/13** ✅ (Chrome, real API + PGlite + Vite + local fixture store + mock
  try-on): account → onboarding → dashboard → sign out; upload; fixture import + review; refused
  private redirect; avatar; mock try-on (labelled) → save look; size from chart; manual chart
  → same engine; account deletion (wrong password refused, sessions and files gone, login fails);
  axe WCAG 2.1 AA on 13 pages (light at 390/1280, dark at 1280) with a canary; no horizontal scroll
  at 320/390/768/1280/1920; production build under the production CSP, including real MediaPipe
  analysis loaded from the CDN.
- Built bundles run from the `pnpm deploy` output against PostgreSQL; production config refusal
  prints the problem list and exits 1; `docker compose config` validates.
- Found and fixed through this testing: zod CSP violation, a race in the account-deletion
  redirect, dark-mode contrast on the delete button, the size-chart editor widening phone layouts,
  the migrations path in the bundle, scan EXIF retention, analytics left after deletion.

### Not verified / blockers
- **Docker images were not built or run**: no Docker daemon was available on this machine
  (Docker Desktop and colima are installed but stopped). Only the compose file's syntax is checked.
- **S3/R2 storage was tested against a local fake S3 server only**, not a real bucket.
- **No real try-on provider has been run**; production UI shows "hasn't been fully tested" for any
  real provider until `TRYON_PROVIDER_VERIFIED=true`.
- **No real-person scan calibration or real-world photo validation** has been done
  (`VALIDATION_TRACKING.md`).
- Missing for public launch: password reset and email verification, legal privacy and terms
  review, external penetration test, manual screen-reader and keyboard pass, shared rate-limit
  store for more than one API instance (`RELEASE_CHECKLIST.md`).
- Not built: side-by-side comparison of two saved looks (only result vs. original photo exists);
  self-hosting the MediaPipe assets (still loaded from public CDNs, see `SECURITY_REVIEW.md` R4).

## AI integrations
No external AI, avatar or try-on API has been called (still true after Phase 7). The default
try-on provider is a labelled mock; the Replicate adapter is unverified (contract tests only). Body scanning uses MediaPipe in
the browser (verified to load and run in Chrome). The avatar is a deterministic parametric
model, not AI-generated.
