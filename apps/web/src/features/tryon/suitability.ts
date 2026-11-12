import type { TryOnSuitability } from '@fitvision/shared';
import { LM, bodySpan, inFrame, visible } from '../scan/engine/landmarks';
import type { CaptureCheck, Landmark, PoseFrame } from '../scan/engine/types';

export const SUITABILITY_VERSION = 'mediapipe-pose+rules-0.1';
const MIN_FACING_RATIO = 0.13;
const MIN_HEIGHT_FRACTION = 0.35;

const both = (pose: Landmark[], a: number, b: number) => [pose[a], pose[b]].every((p) => visible(p) && inFrame(p!));

function headCutOff(frame: PoseFrame): boolean {
  const mask = frame.mask;
  if (!mask) return false;
  const rows = Math.max(1, Math.round(mask.height * 0.01));
  let n = 0;
  for (let y = 0; y < rows; y++) for (let x = 0; x < mask.width; x++) if (mask.data[y * mask.width + x]! > 0.5) n++;
  return n > rows * mask.width * 0.01;
}

/**
 * Which garment regions a try-on photo supports, from on-device pose landmarks and image quality.
 * Rules: exactly one person, facing the camera, large enough in frame, and the landmarks for the
 * region visible (upper: head, shoulders, hips; lower: hips, knees, ankles; full: both, head not cut off).
 */
export function assessTryOnPhoto(frame: PoseFrame, quality: CaptureCheck[], checkedBy = SUITABILITY_VERSION): TryOnSuitability {
  const issues: string[] = [];
  const lightingOk = quality.find((c) => c.id === 'lighting')?.status !== 'fail';
  const sharpOk = quality.find((c) => c.id === 'sharpness')?.status !== 'fail';
  if (!lightingOk) issues.push(quality.find((c) => c.id === 'lighting')!.message ?? 'Lighting is poor.');
  if (!sharpOk) issues.push(quality.find((c) => c.id === 'sharpness')!.message ?? 'The photo is blurry.');

  const none = { upper_body: false, lower_body: false, full_body: false };
  if (frame.poses.length !== 1) {
    issues.unshift(frame.poses.length === 0 ? 'No person was detected.' : 'More than one person is in the photo — only you should be visible.');
    return { checkedBy, onePerson: false, facingCamera: false, personHeightFraction: 0, regions: none, lightingOk, sharpOk, issues };
  }

  const pose = frame.poses[0]!;
  const span = bodySpan(pose);
  const ys = pose.filter((p) => visible(p)).map((p) => p.y);
  // Head top sits roughly 10% of body height above the eyes/nose.
  const top = span ? span.top - 0.06 : Math.min(...ys);
  const bottom = Math.max(...ys);
  const personHeightFraction = Math.max(0, Math.min(1, bottom - top));

  const ls = pose[LM.leftShoulder];
  const rs = pose[LM.rightShoulder];
  const shoulderPx = ls && rs ? Math.abs(ls.x - rs.x) * frame.width : 0;
  const facingCamera = Boolean(ls && rs && ls.x > rs.x && shoulderPx / (personHeightFraction * frame.height || 1) >= MIN_FACING_RATIO);
  if (!facingCamera) issues.push('Face the camera directly.');
  if (personHeightFraction < MIN_HEIGHT_FRACTION) issues.push('You’re too small in the photo — move closer or crop less.');

  const head = [LM.nose, LM.leftEye, LM.rightEye].some((i) => visible(pose[i]) && inFrame(pose[i]!));
  const upperVisible = head && both(pose, LM.leftShoulder, LM.rightShoulder) && both(pose, LM.leftHip, LM.rightHip);
  const lowerVisible = both(pose, LM.leftHip, LM.rightHip) && both(pose, LM.leftKnee, LM.rightKnee) && both(pose, LM.leftAnkle, LM.rightAnkle);
  if (!upperVisible) issues.push('Your head, shoulders and hips need to be visible for tops and jackets.');
  if (!lowerVisible) issues.push('Your hips, knees and ankles need to be visible for trousers, skirts and shorts.');
  const cut = headCutOff(frame);
  if (cut) issues.push('The top of your head is cut off.');

  const usable = facingCamera && personHeightFraction >= MIN_HEIGHT_FRACTION;
  return {
    checkedBy,
    onePerson: true,
    facingCamera,
    personHeightFraction: Math.round(personHeightFraction * 100) / 100,
    regions: {
      upper_body: usable && upperVisible,
      lower_body: usable && lowerVisible,
      full_body: usable && upperVisible && lowerVisible && !cut,
    },
    lightingOk,
    sharpOk,
    issues,
  };
}
