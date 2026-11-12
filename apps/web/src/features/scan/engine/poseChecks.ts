import type { ScanView } from '@fitvision/shared';
import { LM, bodySpan, inFrame, meanOf, visible } from './landmarks';
import type { CaptureCheck, CheckId, Landmark, PoseFrame } from './types';

/** Heuristic thresholds; see docs/PROGRESS.md for calibration notes. */
export const POSE = {
  maxCentreOffset: 0.15,
  /** Head-to-feet span as a fraction of image height. */
  minSpan: 0.45,
  maxSpan: 0.92,
  /** Shoulder width / body height: facing the camera vs turned sideways. */
  minFacingRatio: 0.13,
  maxSideRatio: 0.09,
  /** Wrist-to-hip horizontal gap (fraction of body height) for "arms away from body". */
  minArmGap: 0.03,
  /** Rows at the very top/bottom of the frame that must not contain the person. */
  edgeFraction: 0.01,
};

const LABELS: Record<Exclude<CheckId, 'lighting' | 'sharpness'>, string> = {
  onePerson: 'One person in frame',
  fullBody: 'Full body visible',
  centered: 'Body centred',
  distance: 'Camera distance',
  pose: 'Pose',
};

const pass = (id: keyof typeof LABELS): CaptureCheck => ({ id, label: LABELS[id], status: 'pass' });
const fail = (id: keyof typeof LABELS, message: string): CaptureCheck => ({ id, label: LABELS[id], status: 'fail', message });
const skipped = (id: keyof typeof LABELS): CaptureCheck => ({ id, label: LABELS[id], status: 'skipped' });

function maskTouchesEdge(frame: PoseFrame, edge: 'top' | 'bottom'): boolean {
  const mask = frame.mask;
  if (!mask) return false;
  const rows = Math.max(1, Math.round(mask.height * POSE.edgeFraction));
  const start = edge === 'top' ? 0 : mask.height - rows;
  let count = 0;
  for (let y = start; y < start + rows; y++) {
    for (let x = 0; x < mask.width; x++) if (mask.data[y * mask.width + x]! > 0.5) count++;
  }
  // A few stray pixels are noise; a real cut-off covers a meaningful width.
  return count > rows * mask.width * 0.01;
}

function fullBodyCheck(view: ScanView, pose: Landmark[], frame: PoseFrame): CaptureCheck {
  const pairs: [number, number][] = [
    [LM.leftShoulder, LM.rightShoulder],
    [LM.leftHip, LM.rightHip],
    [LM.leftAnkle, LM.rightAnkle],
  ];
  // Sideways, the far side is hidden, so one of each pair is enough.
  const need = view === 'side' ? 'any' : 'both';
  const ok = pairs.every(([a, b]) => {
    const pa = pose[a];
    const pb = pose[b];
    const va = visible(pa) && inFrame(pa);
    const vb = visible(pb) && inFrame(pb);
    return need === 'both' ? va && vb : va || vb;
  });
  if (!ok) return fail('fullBody', 'Make sure your whole body, from head to feet, is in the frame.');
  if (maskTouchesEdge(frame, 'top')) return fail('fullBody', 'Your head is cut off — step back or tilt the camera up.');
  if (maskTouchesEdge(frame, 'bottom')) return fail('fullBody', 'Your feet are cut off — step back or tilt the camera down.');
  return pass('fullBody');
}

function poseCheck(view: ScanView, pose: Landmark[], frame: PoseFrame, spanPx: number): CaptureCheck {
  const ls = pose[LM.leftShoulder];
  const rs = pose[LM.rightShoulder];
  if (!ls || !rs) return fail('pose', 'Stand so your shoulders are visible.');
  const shoulderRatio = (Math.abs(ls.x - rs.x) * frame.width) / spanPx;

  if (view === 'side') {
    return shoulderRatio <= POSE.maxSideRatio
      ? pass('pose')
      : fail('pose', 'Turn 90° so your side faces the camera.');
  }

  if (shoulderRatio < POSE.minFacingRatio) {
    return fail('pose', view === 'front' ? 'Face the camera directly.' : 'Turn your back directly to the camera.');
  }
  // Facing the camera, the person's left shoulder appears on the right of the (unmirrored) image.
  const facingCamera = ls.x > rs.x;
  if (view === 'front' && !facingCamera) return fail('pose', 'You seem to be facing away — turn to face the camera.');
  if (view === 'back' && facingCamera) return fail('pose', 'You seem to be facing the camera — turn your back to it.');

  // Arms must be away from the torso so the waist and hips can be measured.
  const outward = facingCamera ? 1 : -1;
  const gap = (wrist: number, hip: number, side: 1 | -1) => {
    const w = pose[wrist];
    const h = pose[hip];
    if (!visible(w) || !visible(h)) return 0;
    return ((w.x - h.x) * side * outward * frame.width) / spanPx;
  };
  const leftGap = gap(LM.leftWrist, LM.leftHip, 1);
  const rightGap = gap(LM.rightWrist, LM.rightHip, -1);
  if (leftGap < POSE.minArmGap || rightGap < POSE.minArmGap) {
    return fail('pose', 'Hold your arms slightly away from your body.');
  }
  return pass('pose');
}

/** Person/pose checks for a captured photo. Later checks are skipped once a basic one fails. */
export function assessPose(view: ScanView, frame: PoseFrame): CaptureCheck[] {
  const ids = ['onePerson', 'fullBody', 'centered', 'distance', 'pose'] as const;
  if (frame.poses.length === 0) return [fail('onePerson', 'No person detected — stand in front of the camera.'), ...ids.slice(1).map(skipped)];
  if (frame.poses.length > 1) return [fail('onePerson', 'More than one person detected — make sure only you are in the frame.'), ...ids.slice(1).map(skipped)];
  const pose = frame.poses[0]!;
  const checks: CaptureCheck[] = [pass('onePerson')];

  const full = fullBodyCheck(view, pose, frame);
  checks.push(full);
  const span = bodySpan(pose);
  if (full.status === 'fail' || !span) return [...checks, skipped('centered'), skipped('distance'), skipped('pose')];

  const centre = meanOf(pose, [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip]);
  checks.push(
    centre && Math.abs(centre.x - 0.5) <= POSE.maxCentreOffset
      ? pass('centered')
      : fail('centered', 'Move towards the centre of the frame.'),
  );

  const spanFraction = span.bottom - span.top;
  checks.push(
    spanFraction < POSE.minSpan
      ? fail('distance', 'You’re too far away — move closer to the camera.')
      : spanFraction > POSE.maxSpan
        ? fail('distance', 'You’re too close — step back from the camera.')
        : pass('distance'),
  );

  checks.push(poseCheck(view, pose, frame, spanFraction * frame.height));
  return checks;
}
