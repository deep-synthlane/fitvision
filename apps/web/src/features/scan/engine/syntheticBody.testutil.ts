import { LM } from './landmarks';
import type { Landmark, Mask, PoseFrame } from './types';

/**
 * A synthetic 400×800 "person" with known torso widths, for testing geometry and pose checks.
 * Silhouette spans rows 40–759 (720 px), so at 180 cm the scale is exactly 0.25 cm/px.
 */
export const W = 400;
export const H = 800;

export interface BodySpec {
  view: 'front' | 'side' | 'back';
  chest: number;
  waist: number;
  hips: number;
  /** Arms held away from the body (front/back). */
  armsOut?: boolean;
  dx?: number;
}

function paint(mask: Float32Array, x0: number, x1: number, y0: number, y1: number) {
  for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) {
    for (let x = Math.max(0, Math.round(x0)); x <= Math.min(W - 1, Math.round(x1)); x++) mask[y * W + x] = 1;
  }
}

export function syntheticFrame(spec: BodySpec): PoseFrame {
  const dx = spec.dx ?? 0;
  const cx = 200 + dx;
  const data = new Float32Array(W * H);
  // Head (rows 40–110), neck, torso bands, legs.
  for (let y = 40; y <= 110; y++) {
    const half = Math.sqrt(Math.max(0, 35 * 35 - (y - 75) ** 2));
    paint(data, cx - half, cx + half, y, y);
  }
  paint(data, cx - 15, cx + 15, 110, 180);
  paint(data, cx - spec.chest / 2, cx + spec.chest / 2 - 1, 180, 299);
  paint(data, cx - spec.waist / 2, cx + spec.waist / 2 - 1, 300, 399);
  paint(data, cx - spec.hips / 2, cx + spec.hips / 2 - 1, 400, 480);
  paint(data, cx - 40, cx + 39, 481, 759);
  const facing = spec.view !== 'side';
  if (facing) {
    // Arms: 10 px gap from the chest, wrists out at hip level when held away.
    const armX = spec.chest / 2 + 10;
    paint(data, cx + armX, cx + armX + 20, 190, 430);
    paint(data, cx - armX - 20, cx - armX, 190, 430);
  }

  const pose: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  const set = (i: number, x: number, y: number, visibility = 0.99) => (pose[i] = { x: x / W, y: y / H, z: 0, visibility });
  // Facing the camera, the person's left appears on the image right; reversed from behind.
  const s = spec.view === 'back' ? -1 : 1;
  const shoulderHalf = facing ? 50 : 5;
  const hipHalf = facing ? 30 : 4;
  set(LM.nose, cx, 80, spec.view === 'back' ? 0.2 : 0.99);
  set(LM.leftEye, cx + 5 * s, 75);
  set(LM.rightEye, cx - 5 * s, 75);
  set(LM.leftEar, cx + 15 * s, 80);
  set(LM.rightEar, cx - 15 * s, 80);
  set(LM.leftShoulder, cx + shoulderHalf * s, 180);
  set(LM.rightShoulder, cx - shoulderHalf * s, 180);
  set(LM.leftHip, cx + hipHalf * s, 420);
  set(LM.rightHip, cx - hipHalf * s, 420);
  set(LM.leftKnee, cx + 15 * s, 600);
  set(LM.rightKnee, cx - 15 * s, 600);
  set(LM.leftAnkle, cx + 15 * s, 740);
  set(LM.rightAnkle, cx - 15 * s, 740);
  set(LM.leftHeel, cx + 15 * s, 755);
  set(LM.rightHeel, cx - 15 * s, 755);
  const wristOut = facing && spec.armsOut !== false ? spec.chest / 2 + 20 : hipHalf + 2;
  set(LM.leftWrist, cx + wristOut * s, 430);
  set(LM.rightWrist, cx - wristOut * s, 430);

  const mask: Mask = { width: W, height: H, data };
  return { width: W, height: H, poses: [pose], mask };
}
