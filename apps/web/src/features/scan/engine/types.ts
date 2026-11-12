import type { ScanEstimates, ScanView } from '@fitvision/shared';

/**
 * The body-scan abstraction the UI depends on. Implementations (MediaPipe + geometry today)
 * can be swapped without touching the scan screens.
 */
export interface BodyScanProcessor {
  /** Recorded with each scan so results can be traced to the algorithm that produced them. */
  readonly processingVersion: string;
  /** Loads models; safe to call more than once. */
  load(): Promise<void>;
  /** Validates one captured photo for the given view. */
  assess(view: ScanView, image: HTMLCanvasElement): Promise<CaptureAssessment>;
  /** Estimates measurements from accepted captures, using the user's height as the scale. */
  estimate(captures: AcceptedCaptures, heightCm: number): ScanEstimates;
  close(): void;
}

export type CheckId = 'lighting' | 'sharpness' | 'onePerson' | 'fullBody' | 'centered' | 'distance' | 'pose';

export interface CaptureCheck {
  id: CheckId;
  label: string;
  status: 'pass' | 'fail' | 'skipped';
  /** What to fix, when the check failed. */
  message?: string;
}

/** Implementation-specific analysis of a photo, passed back into `estimate`. Opaque to the UI. */
export interface CaptureAnalysis {
  readonly view: ScanView;
}

export interface CaptureAssessment {
  ok: boolean;
  checks: CaptureCheck[];
  analysis: CaptureAnalysis | null;
}

export type AcceptedCaptures = { front: CaptureAnalysis; side: CaptureAnalysis; back?: CaptureAnalysis };

/* ---- Data shapes used by the geometry implementation (pose-model agnostic) ---- */

/** Normalised landmark (x, y in 0–1 of image size). Indices follow the 33-point BlazePose topology. */
export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

/** Person-segmentation probabilities (0–1), row-major. */
export interface Mask {
  width: number;
  height: number;
  data: Float32Array;
}

export interface PoseFrame {
  width: number;
  height: number;
  /** One landmark list per detected person. */
  poses: Landmark[][];
  /** Segmentation for the first detected person, when available. */
  mask: Mask | null;
}

/** RGBA pixels, as from `CanvasRenderingContext2D.getImageData`. */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
