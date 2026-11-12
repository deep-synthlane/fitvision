import { describe, expect, it } from 'vitest';
import { LM } from '../scan/engine/landmarks';
import { syntheticFrame } from '../scan/engine/syntheticBody.testutil';
import type { CaptureCheck, PoseFrame } from '../scan/engine/types';
import { assessTryOnPhoto } from './suitability';

const goodQuality: CaptureCheck[] = [
  { id: 'lighting', label: 'Lighting', status: 'pass' },
  { id: 'sharpness', label: 'Sharpness', status: 'pass' },
];
const front = () => syntheticFrame({ view: 'front', chest: 120, waist: 100, hips: 130 });

describe('try-on photo suitability', () => {
  it('accepts a full-body, front-facing photo for every garment region', () => {
    const s = assessTryOnPhoto(front(), goodQuality);
    expect(s).toMatchObject({ onePerson: true, facingCamera: true, regions: { upper_body: true, lower_body: true, full_body: true }, issues: [] });
    expect(s.personHeightFraction).toBeGreaterThan(0.8);
  });

  it('allows upper-body garments when the legs are cropped, but not lower or full body', () => {
    const frame = front();
    for (const i of [LM.leftKnee, LM.rightKnee, LM.leftAnkle, LM.rightAnkle, LM.leftHeel, LM.rightHeel]) frame.poses[0]![i]!.visibility = 0.1;
    const s = assessTryOnPhoto(frame, goodQuality);
    expect(s.regions).toEqual({ upper_body: true, lower_body: false, full_body: false });
    expect(s.issues.join(' ')).toMatch(/knees and ankles/);
  });

  it('rejects no person, several people, turned-away poses and tiny people', () => {
    expect(assessTryOnPhoto({ ...front(), poses: [] }, goodQuality)).toMatchObject({ onePerson: false, regions: { upper_body: false } });
    const two: PoseFrame = { ...front(), poses: [front().poses[0]!, front().poses[0]!] };
    expect(assessTryOnPhoto(two, goodQuality).issues[0]).toMatch(/More than one person/);
    const side = assessTryOnPhoto(syntheticFrame({ view: 'side', chest: 90, waist: 80, hips: 100 }), goodQuality);
    expect(side.facingCamera).toBe(false);
    expect(side.regions.upper_body).toBe(false);
    const small = front();
    small.poses[0] = small.poses[0]!.map((p) => ({ ...p, y: 0.4 + p.y * 0.3 }));
    expect(assessTryOnPhoto(small, goodQuality).issues.join(' ')).toMatch(/too small/);
  });

  it('reports lighting and blur problems', () => {
    const s = assessTryOnPhoto(front(), [
      { id: 'lighting', label: 'Lighting', status: 'fail', message: 'Too dark.' },
      { id: 'sharpness', label: 'Sharpness', status: 'fail', message: 'Blurry.' },
    ]);
    expect(s).toMatchObject({ lightingOk: false, sharpOk: false });
    expect(s.issues).toEqual(expect.arrayContaining(['Too dark.', 'Blurry.']));
  });
});
