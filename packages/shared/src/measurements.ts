import { z } from 'zod';
import type { ScanEstimates } from './scans.js';

export const MEASUREMENT_SOURCES = ['manual', 'body_scan', 'corrected'] as const;
export type MeasurementSource = (typeof MEASUREMENT_SOURCES)[number];

/** Body measurement fields (all cm) with labels and valid ranges. */
export const BODY_MEASUREMENTS = [
  { key: 'heightCm', label: 'Height', min: 100, max: 250 },
  { key: 'chestCm', label: 'Chest / bust', min: 50, max: 200 },
  { key: 'waistCm', label: 'Waist', min: 40, max: 200 },
  { key: 'hipsCm', label: 'Hips', min: 50, max: 200 },
  { key: 'shoulderCm', label: 'Shoulder width', min: 25, max: 80 },
  { key: 'inseamCm', label: 'Inseam', min: 40, max: 120 },
  { key: 'armLengthCm', label: 'Arm length', min: 40, max: 100 },
] as const;

export type MeasurementKey = (typeof BODY_MEASUREMENTS)[number]['key'];

const measurement = (label: string, min: number, max: number) =>
  z
    .number({ message: `Enter a number for ${label.toLowerCase()}` })
    .min(min, `${label} must be ${min}–${max} cm`)
    .max(max, `${label} must be ${min}–${max} cm`)
    .nullable();

/** Every measurement value (cm); each is optional (null). */
export const measurementValuesSchema = z.object({
  heightCm: measurement('Height', 100, 250),
  chestCm: measurement('Chest / bust', 50, 200),
  waistCm: measurement('Waist', 40, 200),
  hipsCm: measurement('Hips', 50, 200),
  shoulderCm: measurement('Shoulder width', 25, 80),
  inseamCm: measurement('Inseam', 40, 120),
  armLengthCm: measurement('Arm length', 40, 100),
});
export type MeasurementValues = z.infer<typeof measurementValuesSchema>;

export const hasAnyMeasurementValue = (m: MeasurementValues) => BODY_MEASUREMENTS.some((f) => m[f.key] !== null);
const atLeastOne = { message: 'Enter at least one measurement', path: ['_'] };

/** A manual save: at least one value. `body_scan` is set by the server only (see scans). */
export const bodyMeasurementsInputSchema = measurementValuesSchema
  .extend({ source: z.enum(['manual', 'corrected']).default('manual') })
  .refine(hasAnyMeasurementValue, atLeastOne);
export type BodyMeasurementsInput = z.input<typeof bodyMeasurementsInputSchema>;

export type BodyMeasurements = Record<MeasurementKey, number | null> & {
  id: string;
  source: MeasurementSource;
  /** Set when these measurements came from a body scan. */
  scanId: string | null;
  /** Raw scan output (estimates with confidence, proportions) kept for review and audit. */
  scanEstimates: ScanEstimates | null;
  createdAt: string;
};

export interface CurrentMeasurementsResponse {
  measurements: BodyMeasurements | null;
}

export interface MeasurementHistoryResponse {
  history: BodyMeasurements[];
}
