import { MediaPipeBodyScanProcessor } from './mediapipeProcessor';
import type { BodyScanProcessor } from './types';

export type { AcceptedCaptures, BodyScanProcessor, CaptureAnalysis, CaptureAssessment, CaptureCheck } from './types';

/** The only place that picks a computer-vision implementation. */
export const createBodyScanProcessor = (): BodyScanProcessor => new MediaPipeBodyScanProcessor();
