import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import type { ScanView } from '@fitvision/shared';
import { GEOMETRY_VERSION, estimateMeasurements } from './geometry';
import { assessPose } from './poseChecks';
import { assessImageQuality } from './quality';
import type { AcceptedCaptures, BodyScanProcessor, CaptureAnalysis, CaptureAssessment, CaptureCheck, PoseFrame } from './types';

// Keep in sync with the installed @mediapipe/tasks-vision version.
const TASKS_VISION_VERSION = '1.1.1';
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';

interface MediaPipeAnalysis extends CaptureAnalysis {
  frame: PoseFrame;
}

/**
 * Body scan using MediaPipe Pose Landmarker (landmarks + person segmentation) in the browser,
 * followed by deterministic geometry. Photos are analysed locally; only the model and WASM
 * runtime are downloaded.
 */
export class MediaPipeBodyScanProcessor implements BodyScanProcessor {
  readonly processingVersion = `mediapipe-pose-full-${TASKS_VISION_VERSION}+${GEOMETRY_VERSION}`;
  private landmarker: PoseLandmarker | null = null;
  private loading: Promise<void> | null = null;

  load(): Promise<void> {
    this.loading ??= (async () => {
      const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
      const options = (delegate: 'GPU' | 'CPU') => ({
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: 'IMAGE' as const,
        // Two, so a second person in frame can be detected and rejected.
        numPoses: 2,
        outputSegmentationMasks: true,
      });
      try {
        this.landmarker = await PoseLandmarker.createFromOptions(fileset, options('GPU'));
      } catch {
        this.landmarker = await PoseLandmarker.createFromOptions(fileset, options('CPU'));
      }
    })().catch((err: unknown) => {
      this.loading = null; // allow a retry
      throw err;
    });
    return this.loading;
  }

  /** Pose landmarks, person mask and image-quality checks for one photo (also used for try-on photos). */
  async detect(image: HTMLCanvasElement): Promise<{ frame: PoseFrame; qualityChecks: CaptureCheck[] }> {
    await this.load();
    const ctx = image.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    const qualityChecks = assessImageQuality(ctx.getImageData(0, 0, image.width, image.height));

    const result = this.landmarker!.detect(image);
    const firstMask = result.segmentationMasks?.[0];
    const frame: PoseFrame = {
      width: image.width,
      height: image.height,
      poses: result.landmarks.map((pose) => pose.map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility ?? 0 }))),
      // Copy: mask memory belongs to MediaPipe and is released below.
      mask: firstMask ? { width: firstMask.width, height: firstMask.height, data: firstMask.getAsFloat32Array().slice() } : null,
    };
    result.segmentationMasks?.forEach((m) => m.close());
    return { frame, qualityChecks };
  }

  async assess(view: ScanView, image: HTMLCanvasElement): Promise<CaptureAssessment> {
    const { frame, qualityChecks } = await this.detect(image);
    const checks = [...qualityChecks, ...assessPose(view, frame)];
    const ok = checks.every((c) => c.status === 'pass');
    const analysis: MediaPipeAnalysis = { view, frame };
    return { ok, checks, analysis: ok ? analysis : null };
  }

  estimate(captures: AcceptedCaptures, heightCm: number) {
    const frame = (a: CaptureAnalysis) => (a as MediaPipeAnalysis).frame;
    return estimateMeasurements(
      { front: frame(captures.front), side: frame(captures.side), back: captures.back && frame(captures.back) },
      heightCm,
      this.processingVersion,
    );
  }

  close() {
    this.landmarker?.close();
    this.landmarker = null;
    this.loading = null;
  }
}
