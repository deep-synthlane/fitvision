import type { BodyShape, ScanEstimates } from '@fitvision/shared';
import { LM, meanOf, meanVisibility } from './landmarks';
import type { Landmark, Mask, PoseFrame } from './types';

/**
 * Deterministic measurement estimation from a front + side silhouette.
 *
 * Scale comes from the user's entered height: the silhouette's head-to-heel pixel height
 * maps to `heightCm`. Torso widths (front) and depths (side) are read from the segmentation
 * mask at chest, waist and hip levels and combined as an ellipse circumference.
 *
 * The CALIBRATION factors are 1.0 (uncalibrated): they should be fitted against tape-measured
 * ground truth before results are relied on. This is why every estimate is user-reviewed.
 */
export const GEOMETRY_VERSION = 'geom-0.1-uncalibrated';

export const CALIBRATION = { chest: 1.0, waist: 1.0, hips: 1.0, shoulder: 1.1 };

/** Levels as a fraction of the shoulder→hip distance (T) measured from the shoulder line. */
const LEVELS = {
  chest: 0.28,
  waistFrom: 0.55,
  waistTo: 0.9,
  hipsFrom: 0.95,
  hipsTo: 1.25,
};

/** Plausible depth/width ratios for torso cross-sections; outside these, confidence drops. */
const DEPTH_RATIO = { chest: [0.5, 1.0], waist: [0.5, 1.05], hips: [0.55, 1.0] } as const;

const MASK_THRESHOLD = 0.5;

export const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Ramanujan's approximation of an ellipse perimeter from full width and depth. */
export function ellipseCircumference(width: number, depth: number): number {
  const a = width / 2;
  const b = depth / 2;
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
}

const isPerson = (mask: Mask, x: number, y: number) =>
  x >= 0 && x < mask.width && y >= 0 && y < mask.height && mask.data[y * mask.width + x]! > MASK_THRESHOLD;

/** Width (mask px) of the contiguous person run on row `y` that contains (or is nearest to) `cx`. */
export function runWidth(mask: Mask, y: number, cx: number): number | null {
  const row = Math.round(y);
  let x = Math.round(cx);
  if (!isPerson(mask, x, row)) {
    const reach = Math.round(mask.width * 0.03);
    const found = Array.from({ length: reach }, (_, d) => [x - d, x + d]).flat().find((xx) => isPerson(mask, xx, row));
    if (found === undefined) return null;
    x = found;
  }
  let left = x;
  let right = x;
  while (isPerson(mask, left - 1, row)) left--;
  while (isPerson(mask, right + 1, row)) right++;
  return right - left + 1;
}

/** Top and bottom person rows within a column band. */
export function verticalExtent(mask: Mask, x0: number, x1: number): { top: number; bottom: number } | null {
  let top = -1;
  let bottom = -1;
  const from = Math.max(0, Math.floor(x0));
  const to = Math.min(mask.width - 1, Math.ceil(x1));
  for (let y = 0; y < mask.height; y++) {
    for (let x = from; x <= to; x++) {
      if (mask.data[y * mask.width + x]! > MASK_THRESHOLD) {
        if (top < 0) top = y;
        bottom = y;
        break;
      }
    }
  }
  return top < 0 ? null : { top, bottom };
}

interface ViewGeometry {
  mask: Mask;
  pose: Landmark[];
  /** cm per mask pixel. */
  scale: number;
  heightPx: number;
  shoulderY: number;
  hipY: number;
  /** Torso midline x at mask row y. */
  midX: (y: number) => number;
}

/** Converts a frame into mask-pixel geometry, scaled by the user's height. */
function viewGeometry(frame: PoseFrame, heightCm: number): ViewGeometry | null {
  const mask = frame.mask;
  const pose = frame.poses[0];
  if (!mask || !pose) return null;
  const shoulders = meanOf(pose, [LM.leftShoulder, LM.rightShoulder]);
  const hips = meanOf(pose, [LM.leftHip, LM.rightHip]);
  if (!shoulders || !hips || hips.y <= shoulders.y) return null;

  const xs = pose.map((p) => p.x * mask.width);
  const pad = mask.width * 0.1;
  const extent = verticalExtent(mask, Math.min(...xs) - pad, Math.max(...xs) + pad);
  if (!extent) return null;
  const heightPx = extent.bottom - extent.top + 1;
  const sy = shoulders.y * mask.height;
  const hy = hips.y * mask.height;
  const sx = shoulders.x * mask.width;
  const hx = hips.x * mask.width;
  return {
    mask,
    pose,
    scale: heightCm / heightPx,
    heightPx,
    shoulderY: sy,
    hipY: hy,
    midX: (y) => sx + ((hx - sx) * (y - sy)) / (hy - sy),
  };
}

const levelY = (g: ViewGeometry, f: number) => g.shoulderY + f * (g.hipY - g.shoulderY);

/** Width at a fixed level, or the min/max over a band of levels (returns the chosen level too). */
function widthAt(g: ViewGeometry, f: number): number | null {
  const y = levelY(g, f);
  return runWidth(g.mask, y, g.midX(y));
}

function bandExtreme(g: ViewGeometry, from: number, to: number, mode: 'min' | 'max'): { width: number; f: number } | null {
  let best: { width: number; f: number } | null = null;
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const f = from + ((to - from) * i) / steps;
    const w = widthAt(g, f);
    if (w === null) continue;
    if (!best || (mode === 'min' ? w < best.width : w > best.width)) best = { width: w, f };
  }
  return best;
}

export function classifyBodyShape(chest: number, waist: number, hips: number): BodyShape {
  if (waist >= chest && waist >= hips) return 'oval';
  const balanced = Math.abs(chest - hips) / Math.max(chest, hips) <= 0.05;
  if (balanced && waist <= 0.75 * Math.min(chest, hips)) return 'hourglass';
  if (hips > chest * 1.05) return 'triangle';
  if (chest > hips * 1.05) return 'inverted_triangle';
  return 'rectangle';
}

export interface GeometryInput {
  front: PoseFrame;
  side: PoseFrame;
  back?: PoseFrame;
}

export function estimateMeasurements(input: GeometryInput, heightCm: number, processingVersion: string): ScanEstimates {
  const warnings: string[] = [];
  const empty: ScanEstimates = {
    processingVersion,
    estimates: {},
    proportions: { shoulderToHipRatio: null, waistToHipRatio: null, legToHeightRatio: null, bodyShape: null },
    warnings,
  };

  const front = viewGeometry(input.front, heightCm);
  const side = viewGeometry(input.side, heightCm);
  const back = input.back ? viewGeometry(input.back, heightCm) : null;
  if (!front || !side) {
    warnings.push('We couldn’t outline your body clearly enough to estimate measurements. Please enter them manually.');
    return empty;
  }

  const frontVis = meanVisibility(front.pose, [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip]);
  const sideVis = meanVisibility(side.pose, [LM.leftShoulder, LM.leftHip, LM.rightShoulder, LM.rightHip]);
  const baseConfidence = 0.8 * Math.min(1, (frontVis + Math.max(sideVis, 0.5)) / 2 + 0.1);

  // Shoulder width from the shoulder landmarks (joint centres sit inside the shoulder edge).
  const ls = front.pose[LM.leftShoulder]!;
  const rs = front.pose[LM.rightShoulder]!;
  const shoulderPx = Math.abs(ls.x - rs.x) * front.mask.width;
  const shoulderCm = shoulderPx * front.scale * CALIBRATION.shoulder;

  /** Front width, averaged with the back view when present (adjusts confidence by agreement). */
  function torsoWidth(f: number): { cm: number; factor: number } | null {
    const wf = widthAt(front!, f);
    if (wf === null) return null;
    const frontCm = wf * front!.scale;
    if (!back) return { cm: frontCm, factor: 1 };
    const wb = widthAt(back, f);
    if (wb === null) return { cm: frontCm, factor: 1 };
    const backCm = wb * back.scale;
    const diff = Math.abs(frontCm - backCm) / ((frontCm + backCm) / 2);
    return { cm: (frontCm + backCm) / 2, factor: diff < 0.05 ? 1.1 : diff > 0.12 ? 0.8 : 1 };
  }

  function circumference(key: 'chest' | 'waist' | 'hips', f: number) {
    const width = torsoWidth(f);
    const depthPx = widthAt(side!, f);
    if (!width || depthPx === null) return null;
    const depthCm = depthPx * side!.scale;
    let confidence = baseConfidence * width.factor;
    const [lo, hi] = DEPTH_RATIO[key];
    const ratio = depthCm / width.cm;
    if (ratio < lo || ratio > hi) confidence *= 0.6;
    if (key === 'chest' && width.cm > shoulderCm * 1.5) {
      confidence *= 0.4;
      warnings.push('Your arms may have been touching your body at chest level, which can inflate the chest estimate.');
    }
    return { valueCm: round1(ellipseCircumference(width.cm, depthCm) * CALIBRATION[key]), confidence: round2(clamp01(confidence)), widthCm: width.cm };
  }

  const waistBand = bandExtreme(front, LEVELS.waistFrom, LEVELS.waistTo, 'min');
  const hipBand = bandExtreme(front, LEVELS.hipsFrom, LEVELS.hipsTo, 'max');
  const chest = circumference('chest', LEVELS.chest);
  const waist = waistBand ? circumference('waist', waistBand.f) : null;
  const hips = hipBand ? circumference('hips', hipBand.f) : null;

  const estimates: ScanEstimates['estimates'] = {
    shoulderCm: { valueCm: round1(shoulderCm), confidence: round2(clamp01(0.75 * frontVis)) },
  };
  if (chest) estimates.chestCm = { valueCm: chest.valueCm, confidence: chest.confidence };
  if (waist) estimates.waistCm = { valueCm: waist.valueCm, confidence: waist.confidence };
  if (hips) estimates.hipsCm = { valueCm: hips.valueCm, confidence: hips.confidence };

  // Height can't be measured from an uncalibrated photo, but proportions can flag a wrong entry.
  const ankles = meanOf(front.pose, [LM.leftAnkle, LM.rightAnkle]);
  const legToHeightRatio = ankles ? round2((ankles.y * front.mask.height - front.hipY) / front.heightPx) : null;
  if (legToHeightRatio !== null && (legToHeightRatio < 0.38 || legToHeightRatio > 0.56)) {
    warnings.push(
      'Your body proportions in the scan look unusual. Check that your whole body was in frame and that the height in your profile is correct.',
    );
  }

  return {
    processingVersion,
    estimates,
    proportions: {
      shoulderToHipRatio: hips ? round2(shoulderCm / hips.widthCm) : null,
      waistToHipRatio: waist && hips ? round2(waist.valueCm / hips.valueCm) : null,
      legToHeightRatio,
      bodyShape: chest && waist && hips ? classifyBodyShape(chest.valueCm, waist.valueCm, hips.valueCm) : null,
    },
    warnings: [...new Set(warnings)],
  };
}
