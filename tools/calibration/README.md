# Body-scan calibration

Validates the Phase 2 body-scan estimates (shoulder width, chest/bust, waist, hips) against
tape measurements from real volunteers, and produces candidate calibration factors.

**The scan maths is uncalibrated until this process says otherwise.** Results here are kept
out of the app's database: volunteers are scanned under a dedicated calibration account and
results live only in worksheet files under `data/` (git-ignored).

## 1. Before the session

- Written consent from each volunteer covering: photos taken by the app, how long they are
  kept (deleted after values are recorded), and that only pseudonymous codes are stored.
- Give each volunteer a code (`P01`, `P02`, …). Never record names, emails or photos in the
  worksheet. Keep the code ↔ person list (if any) separately and offline.
- Create one app account for calibration (e.g. `calibration@<your-domain>`), with
  measurement unit **metric**. Do not use volunteers' personal accounts.
- Aim for **at least 20 volunteers per algorithm version**, across a range of heights and body
  shapes and both clothing preferences.

## 2. Tape measurements (do these first)

Volunteer in the same fitted clothing they will wear for the scan, standing relaxed, breathing
out normally. Use a soft tape, snug but not compressing. Take **two readings** of each and
record both; if they differ by more than 1 cm, take a third and replace the outlier.

| Measure | Where |
| --- | --- |
| Shoulder width | Across the back, from shoulder point (acromion) to shoulder point, following the curve |
| Chest / bust | Horizontally around the fullest part of the chest/bust, under the arms |
| Waist | Horizontally around the natural waist (narrowest point between ribs and hips) |
| Hips | Horizontally around the widest part of the buttocks |

Measure height (no shoes) and enter it in the calibration account's profile before scanning —
the scan uses it as its scale.

## 3. Scan

1. Sign in to the calibration account, set height, then run **Body scan** following the
   on-screen instructions. Record lighting, camera (phone/laptop) and whether a back photo was
   taken.
2. On the review screen, **save without editing** the estimates (so the stored values are the
   raw scan output).
3. Pull the raw values and confidences into worksheet columns, and delete the photos:

   ```bash
   CAL_EMAIL=calibration@… CAL_PASSWORD=… pnpm calibration:fetch -- --delete-scan
   ```

   Paste the printed values into the volunteer's row in `data/<session>.csv` (copy
   `worksheet-template.csv` to start; delete the `EXAMPLE` row).

## 4. Report

```bash
pnpm calibration:report tools/calibration/data/<session>.csv
```

Per `processing_version` and measure, the report gives n, bias (scan − tape), MAE, RMSE, MAPE,
share within ±2 cm / ±4 cm, a least-squares scale factor with its **leave-one-out** MAE, MAE
split by confidence (≥ 0.6 vs < 0.6) and a verdict against proposed targets
(MAE ≤ 3 cm and |bias| ≤ 1.5 cm for chest/waist/hips; ≤ 2 cm / 1 cm for shoulder;
n ≥ 20). The targets are proposals — agree them with the product team.

## 5. Applying results

- Only adopt a factor when its leave-one-out MAE is clearly better than the raw MAE.
- Put it in `CALIBRATION` in `apps/web/src/features/scan/engine/geometry.ts`, bump
  `GEOMETRY_VERSION`, and validate on a **new** group of volunteers — never on the data used to
  fit the factor.
- If low-confidence estimates are not actually worse than high-confidence ones, the confidence
  heuristics need revisiting before users rely on the highlighting.
