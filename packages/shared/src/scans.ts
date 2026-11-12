import { z } from 'zod';
import { hasAnyMeasurementValue, measurementValuesSchema, type BodyMeasurements, type MeasurementSource, type MeasurementValues } from './measurements.js';

export const SCAN_VIEWS = ['front', 'side', 'back'] as const;
export type ScanView = (typeof SCAN_VIEWS)[number];
export const REQUIRED_SCAN_VIEWS: readonly ScanView[] = ['front', 'side'];

export const SCAN_STATUSES = ['processing', 'completed', 'failed'] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

/** Measurements a body scan estimates. Height comes from the profile; inseam and arm length are always manual. */
export const ESTIMATED_MEASUREMENTS = ['shoulderCm', 'chestCm', 'waistCm', 'hipsCm'] as const;
export type EstimatedMeasurementKey = (typeof ESTIMATED_MEASUREMENTS)[number];
export const MANUAL_ONLY_MEASUREMENTS = ['inseamCm', 'armLengthCm'] as const;

/** Estimates below this confidence are highlighted for manual review. */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

export const BODY_SCAN_DISCLAIMER =
  'Body-scan measurements are estimates. For the best result, review and correct the measurements before using virtual try-on or size recommendations.';

export const BODY_SHAPES = ['hourglass', 'triangle', 'inverted_triangle', 'rectangle', 'oval'] as const;
export type BodyShape = (typeof BODY_SHAPES)[number];
export const BODY_SHAPE_LABELS: Record<BodyShape, string> = {
  hourglass: 'Hourglass',
  triangle: 'Triangle (hips wider than chest)',
  inverted_triangle: 'Inverted triangle (chest wider than hips)',
  rectangle: 'Rectangle',
  oval: 'Oval',
};

const estimateSchema = z.object({
  valueCm: z.number().positive().max(300),
  confidence: z.number().min(0).max(1),
});
export type MeasurementEstimate = z.infer<typeof estimateSchema>;

const ratio = z.number().positive().max(5).nullable();

export const scanEstimatesSchema = z.object({
  processingVersion: z.string().trim().min(1).max(64),
  estimates: z.object({
    shoulderCm: estimateSchema.optional(),
    chestCm: estimateSchema.optional(),
    waistCm: estimateSchema.optional(),
    hipsCm: estimateSchema.optional(),
  }),
  proportions: z.object({
    shoulderToHipRatio: ratio,
    waistToHipRatio: ratio,
    legToHeightRatio: ratio,
    bodyShape: z.enum(BODY_SHAPES).nullable(),
  }),
  warnings: z.array(z.string().max(300)).max(10).default([]),
});
export type ScanEstimates = z.infer<typeof scanEstimatesSchema>;

/** JSON part of the scan upload: raw scan output plus the values the user confirmed. */
export const scanSubmissionSchema = z.object({
  scan: scanEstimatesSchema,
  measurements: measurementValuesSchema.refine(hasAnyMeasurementValue, {
    message: 'Enter at least one measurement',
    path: ['_'],
  }),
});
export type ScanSubmission = z.input<typeof scanSubmissionSchema>;

/** Values within this distance of the estimate count as unchanged (display rounding). */
const UNCHANGED_TOLERANCE_CM = 0.05;

/**
 * `body_scan` when the user accepted every generated estimate as-is,
 * `corrected` when any estimated value was changed or cleared.
 */
export function deriveScanSource(estimates: ScanEstimates['estimates'], confirmed: MeasurementValues): MeasurementSource {
  for (const key of ESTIMATED_MEASUREMENTS) {
    const estimate = estimates[key];
    if (!estimate) continue;
    const value = confirmed[key];
    if (value === null || Math.abs(value - estimate.valueCm) > UNCHANGED_TOLERANCE_CM) return 'corrected';
  }
  return 'body_scan';
}

export interface BodyScan {
  id: string;
  status: ScanStatus;
  /** Views captured for this scan. */
  views: ScanView[];
  /** Authenticated, owner-only image URLs keyed by view. */
  imageUrls: Partial<Record<ScanView, string>>;
  processingVersion: string;
  createdAt: string;
  completedAt: string | null;
}

export interface ScanResponse {
  scan: BodyScan;
  measurements: BodyMeasurements | null;
}

export interface ScanListResponse {
  scans: BodyScan[];
}
