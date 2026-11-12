import type { AvatarInputs, AvatarMeasurementKey, BodyParameters, ClothingPreference } from '@fitvision/shared';

/**
 * Body parameter mapping: confirmed measurements → a complete, internally consistent set of
 * body dimensions. Missing measurements fall back to typical proportions of height
 * (approximate population ratios, marked `default` so the UI can say so).
 */

type Ratios = Record<Exclude<AvatarMeasurementKey, 'heightCm'>, number>;

/** Typical dimension / height ratios (approximate adult anthropometry, rounded). */
const DEFAULT_RATIOS: Record<ClothingPreference, Ratios> = {
  menswear: { shoulderCm: 0.245, chestCm: 0.55, waistCm: 0.47, hipsCm: 0.55, inseamCm: 0.45, armLengthCm: 0.335 },
  womenswear: { shoulderCm: 0.23, chestCm: 0.53, waistCm: 0.42, hipsCm: 0.58, inseamCm: 0.45, armLengthCm: 0.325 },
  unisex: { shoulderCm: 0.237, chestCm: 0.54, waistCm: 0.445, hipsCm: 0.565, inseamCm: 0.45, armLengthCm: 0.33 },
};

/** Typical torso depth/width ratios used to turn a girth into a cross-section. */
export const DEPTH_RATIOS = { chest: 0.72, waist: 0.76, hips: 0.78 };

/** Keeps defaults and measurements inside a plausible range for the model. */
const LIMITS: Record<AvatarMeasurementKey, [number, number]> = {
  heightCm: [100, 250],
  shoulderCm: [25, 80],
  chestCm: [50, 200],
  waistCm: [40, 200],
  hipsCm: [50, 200],
  inseamCm: [0.3, 0.55], // as a fraction of height, so the torso always has room
  armLengthCm: [0.25, 0.42], // fraction of height
};

/** Ramanujan's ellipse perimeter for full width w and depth d. */
export function ellipsePerimeter(w: number, d: number): number {
  const a = w / 2;
  const b = d / 2;
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
}

/** Width and depth of an ellipse with the given perimeter and depth/width ratio. */
export function solveSection(girthCm: number, depthRatio: number): { widthCm: number; depthCm: number } {
  const widthCm = girthCm / ellipsePerimeter(1, depthRatio);
  return { widthCm, depthCm: widthCm * depthRatio };
}

const clamp = (v: number, [lo, hi]: [number, number]) => Math.min(hi, Math.max(lo, v));
const round1 = (n: number) => Math.round(n * 10) / 10;

export function mapMeasurementsToParameters(inputs: AvatarInputs): Omit<BodyParameters, 'fidelity'> {
  const v = inputs.values;
  if (v.heightCm == null) throw new Error('Height is required to generate an avatar');
  const height = clamp(v.heightCm, LIMITS.heightCm);
  const ratios = DEFAULT_RATIOS[inputs.clothingPreference];

  const resolve = (key: Exclude<AvatarMeasurementKey, 'heightCm'>) => {
    const measured = v[key];
    const relative = key === 'inseamCm' || key === 'armLengthCm';
    const limits: [number, number] = relative ? [LIMITS[key][0] * height, LIMITS[key][1] * height] : LIMITS[key];
    return measured != null
      ? { valueCm: round1(clamp(measured, limits)), source: 'measured' as const }
      : { valueCm: round1(clamp(ratios[key] * height, limits)), source: 'default' as const };
  };

  const resolved: BodyParameters['resolved'] = {
    heightCm: { valueCm: round1(height), source: 'measured' },
    shoulderCm: resolve('shoulderCm'),
    chestCm: resolve('chestCm'),
    waistCm: resolve('waistCm'),
    hipsCm: resolve('hipsCm'),
    inseamCm: resolve('inseamCm'),
    armLengthCm: resolve('armLengthCm'),
  };

  return {
    inputs,
    resolved,
    sections: {
      chest: solveSection(resolved.chestCm.valueCm, DEPTH_RATIOS.chest),
      waist: solveSection(resolved.waistCm.valueCm, DEPTH_RATIOS.waist),
      hips: solveSection(resolved.hipsCm.valueCm, DEPTH_RATIOS.hips),
    },
  };
}
