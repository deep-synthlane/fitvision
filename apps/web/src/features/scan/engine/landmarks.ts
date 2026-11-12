import type { Landmark } from './types';

/** BlazePose 33-landmark indices used by the scan. */
export const LM = {
  nose: 0,
  leftEye: 2,
  rightEye: 5,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
} as const;

export const MIN_VISIBILITY = 0.5;

export const visible = (lm: Landmark | undefined): lm is Landmark => Boolean(lm && lm.visibility >= MIN_VISIBILITY);

export const inFrame = (lm: Landmark, margin = 0.01) =>
  lm.x >= margin && lm.x <= 1 - margin && lm.y >= margin && lm.y <= 1 - margin;

/** Mean of the visible landmarks among `indices`, or null if none is visible. */
export function meanOf(pose: Landmark[], indices: number[]): { x: number; y: number } | null {
  const pts = indices.map((i) => pose[i]).filter(visible);
  if (pts.length === 0) return null;
  return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
}

export const meanVisibility = (pose: Landmark[], indices: number[]) =>
  indices.reduce((s, i) => s + (pose[i]?.visibility ?? 0), 0) / indices.length;

/** Vertical span from the head (nose/eyes/ears) to the feet, normalised to image height. */
export function bodySpan(pose: Landmark[]): { top: number; bottom: number } | null {
  const head = [LM.nose, LM.leftEye, LM.rightEye, LM.leftEar, LM.rightEar].map((i) => pose[i]).filter(visible);
  const feet = [LM.leftAnkle, LM.rightAnkle, LM.leftHeel, LM.rightHeel].map((i) => pose[i]).filter(visible);
  if (head.length === 0 || feet.length === 0) return null;
  return { top: Math.min(...head.map((p) => p.y)), bottom: Math.max(...feet.map((p) => p.y)) };
}
