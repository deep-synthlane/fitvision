# Validation tracking

Status of everything that needs real people, real photos or a real provider to validate. Nothing
here can be validated by automated tests alone. **Current status: none of it has been done
yet.** The app is honest about this in the UI ("uncalibrated", "mock", "hasn't been fully tested").

| Track | Status (2026-11-06) | Blocks |
| --- | --- | --- |
| 1. Body-scan calibration | ❌ 0 volunteer sessions | Removing "uncalibrated" wording; raising scan-based size confidence above "medium" |
| 2. Try-on photo checker on real photos | ❌ 0 photos reviewed | Claiming the photo check works across people, devices and lighting |
| 3. Try-on provider verification | ❌ no real provider run | `TRYON_PROVIDER_VERIFIED=true`; any real provider in production |
| 3b. Avatar try-on with a real provider | ❌ no real provider run | `TRYON_AVATAR_VERIFIED=true`; removing the "not verified" warning for avatar try-on |
| 4. Size-engine feedback | ⏳ collecting (tooling ready, no real purchases yet) | Any change to size-engine rules |

## 1. Body-scan calibration

- Protocol, worksheet and report: `tools/calibration/README.md`
  (`pnpm calibration:report <csv>`). Results stay outside the app database.
- Reports are grouped by `processingVersion`. The current processor is
  `mediapipe-pose-full-1.1.1+geom-0.1-uncalibrated` (calibration factors 1.0).
- Proposed targets (agree them with the product team): MAE ≤ 3 cm and |bias| ≤ 1.5 cm for
  chest/waist/hips, ≤ 2 cm / 1 cm for shoulder, n ≥ 20 per measure, spread across clothing
  preference, height and body shape.
- Until the targets are met: scan estimates stay labelled uncalibrated, users review every value,
  and the size engine caps confidence at **medium** for scan-sourced measurements.
- Adopting factors creates a **new** processing version (for example `geom-0.2-cal1`). Never
  recalibrate in place.

## 2. Try-on photo suitability checker

The browser checks each try-on photo (one person, facing the camera, framing, light and blur), and
the server re-checks sharpness. Track real-world performance with
`docs/templates/photo-validation.csv`:

- At least **50 consented photos** from varied skin tones, body types, ages, clothing, devices,
  lighting and backgrounds, including deliberate failures (two people, cropped, dark, blurred,
  side-on).
- A reviewer records the expected verdict *before* running the checker, then records the
  checker's verdict and issues.
- Report the **false accept rate** (unsuitable photos accepted ÷ unsuitable photos) and the **false
  reject rate** (suitable photos rejected ÷ suitable photos), overall and per group.
- Proposed targets: false accept ≤ 5 %, false reject ≤ 15 %, and no group with a false reject
  rate more than 10 points above the overall rate.
- Photos are test data. Store them as the vton-eval data folder requires (git-ignored, consent
  recorded) and delete them when the review is finished.

## 3. Try-on provider verification

- Harness and licence register: `tools/vton-eval/README.md`, `tools/vton-eval/models.md`.
- Steps: confirm the licence permits commercial use → run the harness on the consented test set
  in **staging** → two reviewers score every output against `criteria.ts` → record cost and
  latency (p50/p95) and failure rate → record the provider's data-retention terms in
  `DATA_POLICY.md`.
- Only then set `TRYON_PROVIDER_VERIFIED=true` for that provider **and model version**. Changing
  the model version means verifying again.
- Production UI until then: a real provider shows "This try-on service hasn't been fully tested by
  FitVision yet". The mock is always labelled "Mock result — not AI".

## 3b. Avatar try-on

Avatar try-on sends a server render of the parametric mannequin (`avatar-front-render-1`) as the
person image. VTON models are trained on photos of people, so a provider verified for photos may
still fail on a smooth mannequin: ignoring it, distorting it, or returning it with little clothing
change.

- Pipeline checks already automated: the render is the person input, the garment is sent
  separately with the right region, the stored result is the provider's output (a different file),
  and a "result" that is visually the unchanged input is rejected as `generation_failed`.
- Tooling (ready, 2026-11-06): `tools/vton-eval` §5. It covers 5 avatar body shapes and 9 synthetic
  garments (4 upper, 3 lower, 2 full-body; plain, striped and logo), 24 cases per render style,
  automatic checks for unchanged output and for where the avatar changed, the review fields, and
  the pass criteria below. A mock dry run completed (24/24) and was correctly reported as NOT ELIGIBLE.
- Pass criteria: 20+ real runs; garment visibly correct in ≥ 90 % (failures count as misses);
  each region placed correctly ≥ 90 %; severe distortion < 10 % and never twice on one body shape;
  no unchanged outputs; every output reviewed.
- **Status: not run.** No real provider credentials are configured. Results go here: provider,
  model version, render style, date, verdict, failure modes.
- If `avatar-render-1.0-flat` fails, evaluate a second style (`avatar-render-1.1-humanlike`) on the
  same cases and provider before changing anything in the try-on pipeline.
- Synthetic garments keep the test set free of licensing questions. Before a final sign-off, also
  run real product photos that you have the rights to use.
- Until then, a real provider shows "Avatar try-on hasn't been verified with this try-on service
  yet". The mock is never treated as verified.

## 4. Size-engine feedback

- Users can report how a purchase fitted (too small … too large, returned, reason). Feedback
  **never changes recommendations automatically**.
- Export: `pnpm --filter @fitvision/api export-feedback > feedback.jsonl` (pseudonymous; return
  reasons only with `--with-reasons`).
- Report: `pnpm --filter @fitvision/sizing-eval feedback feedback.jsonl`. It gives the just-right
  rate and size bias for buyers who took the recommended size, per engine version × category and
  × brand. Groups under 30 rows are marked as too small to act on.
- Any rule change gets a new `SIZE_ENGINE_VERSION`, new known-answer cases
  (`pnpm --filter @fitvision/sizing-eval eval`), and makes earlier recommendations stale.
