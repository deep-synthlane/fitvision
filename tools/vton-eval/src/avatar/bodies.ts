import type { AvatarInputs } from '@fitvision/shared';

/** Five avatar body shapes spanning height, build and clothing preference (synthetic, not real people). */
export const BODIES: { id: string; label: string; inputs: AvatarInputs }[] = [
  body('b1-petite', 'Petite, womenswear', 'womenswear', { heightCm: 155, shoulderCm: 36, chestCm: 84, waistCm: 66, hipsCm: 90, inseamCm: 70, armLengthCm: 52 }),
  body('b2-average-w', 'Average, womenswear', 'womenswear', { heightCm: 165, shoulderCm: 38, chestCm: 92, waistCm: 76, hipsCm: 100, inseamCm: 76, armLengthCm: 56 }),
  body('b3-plus-w', 'Plus size, womenswear', 'womenswear', { heightCm: 168, shoulderCm: 41, chestCm: 112, waistCm: 100, hipsCm: 120, inseamCm: 75, armLengthCm: 57 }),
  body('b4-slim-m', 'Tall and slim, menswear', 'menswear', { heightCm: 182, shoulderCm: 44, chestCm: 92, waistCm: 76, hipsCm: 92, inseamCm: 84, armLengthCm: 62 }),
  body('b5-broad-m', 'Broad and heavy, menswear', 'menswear', { heightCm: 185, shoulderCm: 49, chestCm: 116, waistCm: 106, hipsCm: 112, inseamCm: 84, armLengthCm: 64 }),
];

function body(id: string, label: string, clothingPreference: AvatarInputs['clothingPreference'], values: AvatarInputs['values']) {
  return { id, label, inputs: { measurementId: id, clothingPreference, values } };
}
