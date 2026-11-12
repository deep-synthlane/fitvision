import { desc, eq } from 'drizzle-orm';
import { AVATAR_MEASUREMENTS, type AvatarInputs, type ClothingPreference } from '@fitvision/shared';
import type { Db } from '../../db/client.js';
import { bodyMeasurements, profiles, type BodyMeasurementsRow } from '../../db/schema.js';

/**
 * The confirmed measurement snapshot an avatar is built from: a saved measurement set plus the
 * profile's height (the primary height value) and clothing preference.
 */
export async function loadSnapshot(
  db: Db,
  userId: string,
  measurementId?: string,
): Promise<{ inputs: AvatarInputs; measurement: BodyMeasurementsRow } | null> {
  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  const [measurement] = measurementId
    ? await db.select().from(bodyMeasurements).where(eq(bodyMeasurements.id, measurementId)).limit(1)
    : await db
        .select()
        .from(bodyMeasurements)
        .where(eq(bodyMeasurements.userId, userId))
        .orderBy(desc(bodyMeasurements.createdAt), desc(bodyMeasurements.id))
        .limit(1);
  if (!profile || !measurement || measurement.userId !== userId) return null;
  return {
    measurement,
    inputs: {
      measurementId: measurement.id,
      clothingPreference: profile.clothingPreference as ClothingPreference,
      values: {
        heightCm: profile.heightCm,
        shoulderCm: measurement.shoulderCm,
        chestCm: measurement.chestCm,
        waistCm: measurement.waistCm,
        hipsCm: measurement.hipsCm,
        inseamCm: measurement.inseamCm,
        armLengthCm: measurement.armLengthCm,
      },
    },
  };
}

/** Field-by-field comparison (jsonb does not preserve key order, so serialised JSON can't be compared). */
export function sameInputs(a: AvatarInputs, b: AvatarInputs): boolean {
  return (
    a.measurementId === b.measurementId &&
    a.clothingPreference === b.clothingPreference &&
    AVATAR_MEASUREMENTS.every((k) => (a.values[k] ?? null) === (b.values[k] ?? null))
  );
}
