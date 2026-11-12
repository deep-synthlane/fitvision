# Virtual try-on provider evaluation

Compare try-on providers on the **same inputs** before choosing one for production. Every
provider is called through the app's `VirtualTryOnProvider` interface, so what is evaluated is
exactly what the app would run. Outputs live in `runs/` and inputs in `data/` (both
git-ignored) — never in the app database or user storage.

## 1. Test set

- 15–30 cases covering upper-body, lower-body and full-body garments; plain, patterned and
  logo garments; varied body shapes, skin tones, poses, lighting and hair/hands occlusion.
- Use only photos of people who have **given consent for processing by third-party AI
  services** (or licensed stock with that right). Don't use customer photos.
- Copy `manifest.example.json` to `data/manifest.json` and put images under `data/`.

## 2. Run

```bash
# Mock only (checks the harness)
pnpm --filter @fitvision/vton-eval run-eval data/manifest.json

# With a real provider (costs money)
REPLICATE_API_TOKEN=… REPLICATE_MODEL_VERSION=<version id> REPLICATE_COST_USD=<per run> \
  pnpm --filter @fitvision/vton-eval run-eval data/manifest.json
```

Each run writes `runs/<timestamp>/`: output images, `results.json` (status, error code,
latency, attempts, estimated cost), `contact-sheet.html` (person | garment | outputs) and
`scoring.csv`.

## 3. Review

Two reviewers independently score every output 1 (poor) – 5 (excellent) in `scoring.csv`:

| Criterion | What to look for |
| --- | --- |
| identity_preservation | Face, hair, skin tone, body unchanged apart from the garment |
| garment_color | Colour matches the product image |
| pattern_logo | Prints, stripes, logos and text preserved and not warped |
| sleeve_length | Sleeve length matches the product |
| neckline | Neckline/collar shape matches |
| silhouette | Overall cut/length/fit style matches (e.g. cropped vs long, A-line vs straight) |
| lower_body_placement | Waistband/hem placement for trousers, skirts, shorts |
| occlusion_hands | Hands, arms, hair over the garment handled cleanly |
| body_shape_distortion | No slimming/widening or changed proportions (5 = none) |
| artifacts | Seams, smearing, extra limbs, background damage (5 = none) |

Then: `pnpm --filter @fitvision/vton-eval summarize runs/<timestamp>` → failure rate, p50/p95
latency, cost per run and mean scores per provider.

## 4. Decide

Choose a production provider only after reviewing the images themselves, plus: licence and terms
(commercial use, data retention, training on inputs), moderation behaviour, rate limits, cost at
expected volume, and regional data-processing requirements. Record the decision and evidence in
`docs/PROGRESS.md`. Self-hosted models must also be entered in `models.md`.

## 5. Avatar try-on validation (TRYON_AVATAR_VERIFIED)

Checks whether a real provider can put garments on **avatar renders** (not photos). Everything goes
through the app's `VirtualTryOnProvider`, and inputs are rendered by the app's own renderer.

```bash
# 1. Build the test set: 5 avatar body shapes × 9 synthetic garments → 24 cases per render style
#    (4 upper × 3, 3 lower × 2, 2 full-body × 3; `--all` for every combination, 45 per style)
pnpm --filter @fitvision/vton-eval avatar-build

# 2. Run it (costs money with a real provider; the mock always runs alongside as a harness check).
#    Credentials: cp tools/vton-eval/.env.example tools/vton-eval/.env and add REPLICATE_API_TOKEN.
pnpm --filter @fitvision/vton-eval run-eval tools/vton-eval/data/avatar/avatar-render-1.0-flat/manifest.json

# 3. Scoring sheet + avatar-contact-sheet.html: run data, the provider's model version and actual
#    billed cost (Replicate predict_time × A100 price), automatic checks (unchanged output, % of the
#    avatar changed in its upper/lower half) and review columns
pnpm --filter @fitvision/vton-eval avatar-sheet tools/vton-eval/runs/<RUN> tools/vton-eval/data/avatar/avatar-render-1.0-flat/manifest.json

# 4. Two reviewers fill in avatar-scoring.csv (open contact-sheet.html), then:
pnpm --filter @fitvision/vton-eval avatar-summary tools/vton-eval/runs/<RUN> [tools/vton-eval/runs/<RUN_STYLE_2>]
```

Review fields (one row per output): garment_visible, category_position, neckline, shoulder, sleeve,
waist, lower_body, colour, pattern_logo, body_distortion, artifacts, acceptable (overall). Generation
failure, latency and cost come from the run, and failed generations stay in the denominator.

IDM-VTON is licensed CC BY-NC-SA 4.0 (non-commercial). Use it for technical evaluation only. A
production provider needs a commercial licence, and passing here doesn't change that.

The summary gives **PASS** only for a real provider with 20+ runs where:
- the garment is visibly correct (visible and in the right region) in ≥ 90 % of runs, with
  failures counting as misses;
- each region is placed correctly ≥ 90 % of the time;
- severe body distortion is under 10 % and never appears twice on the same body shape;
- no output is the avatar returned unchanged;
- every completed output has been reviewed.

Mock runs are always **NOT ELIGIBLE**.

Render styles live in `src/avatar/styles.ts`. `avatar-render-1.0-flat` is the app's current
renderer. If it performs poorly, add a second style there (for example
`avatar-render-1.1-humanlike`: same geometry, camera and pose; skin-tone material and smoother
anatomy; no face or hair), build, run the **same** cases with the **same** provider, and compare
both with `avatar-summary`. Only then change the app's default renderer.
