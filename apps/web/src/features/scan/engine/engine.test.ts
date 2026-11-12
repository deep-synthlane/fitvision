import { describe, expect, it } from 'vitest';
import { classifyBodyShape, ellipseCircumference, estimateMeasurements } from './geometry';
import { assessPose } from './poseChecks';
import { assessImageQuality } from './quality';
import { syntheticFrame } from './syntheticBody.testutil';
import type { PoseFrame } from './types';

const front = () => syntheticFrame({ view: 'front', chest: 120, waist: 100, hips: 130 });
const side = () => syntheticFrame({ view: 'side', chest: 90, waist: 80, hips: 100 });
const failed = (checks: { id: string; status: string; message?: string }[]) => checks.filter((c) => c.status === 'fail');

describe('image quality', () => {
  const image = (fn: (x: number, y: number) => number, w = 256, h = 256) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = fn(x, y);
        data.set([v, v, v, 255], (y * w + x) * 4);
      }
    return { width: w, height: h, data };
  };

  it('passes a well-lit, detailed image', () => {
    const checks = assessImageQuality(image((x, y) => ((x >> 2) + (y >> 2)) % 2 ? 180 : 70));
    expect(failed(checks)).toEqual([]);
  });

  it('flags dark, overexposed and featureless (blurry) images', () => {
    expect(failed(assessImageQuality(image((x, y) => ((x + y) % 2 ? 30 : 10))))[0]?.id).toBe('lighting');
    expect(failed(assessImageQuality(image((x, y) => ((x + y) % 2 ? 255 : 240))))[0]?.id).toBe('lighting');
    expect(failed(assessImageQuality(image(() => 128))).map((c) => c.id)).toEqual(['sharpness']);
  });
});

describe('pose checks', () => {
  it('accepts well-framed front, side and back photos', () => {
    expect(failed(assessPose('front', front()))).toEqual([]);
    expect(failed(assessPose('side', side()))).toEqual([]);
    expect(failed(assessPose('back', syntheticFrame({ view: 'back', chest: 120, waist: 100, hips: 130 })))).toEqual([]);
  });

  it('rejects no person or more than one person', () => {
    const none: PoseFrame = { ...front(), poses: [] };
    expect(failed(assessPose('front', none))[0]?.message).toMatch(/No person/);
    const two: PoseFrame = { ...front(), poses: [front().poses[0]!, front().poses[0]!] };
    expect(failed(assessPose('front', two))[0]?.message).toMatch(/More than one/);
  });

  it('requires the full body, including head and feet inside the frame', () => {
    const frame = front();
    frame.poses[0]![28]!.visibility = 0.1; // right ankle hidden
    expect(failed(assessPose('front', frame))[0]?.id).toBe('fullBody');

    const cut = front();
    for (let x = 150; x < 250; x++) cut.mask!.data[x] = 1; // person touches the top edge
    expect(failed(assessPose('front', cut))[0]?.message).toMatch(/head is cut off/);
  });

  it('asks the user to centre themselves', () => {
    expect(failed(assessPose('front', syntheticFrame({ view: 'front', chest: 120, waist: 100, hips: 130, dx: 110 })))[0]?.id).toBe(
      'centered',
    );
  });

  it('flags camera too close or too far', () => {
    const far = front();
    far.poses[0] = far.poses[0]!.map((p) => ({ ...p, y: 0.3 + p.y * 0.4 }));
    expect(failed(assessPose('front', far))[0]?.message).toMatch(/too far/);
    const close = front();
    close.poses[0] = close.poses[0]!.map((p) => ({ ...p, y: (p.y - 0.5) * 1.15 + 0.5 }));
    expect(failed(assessPose('front', close))[0]?.message).toMatch(/too close/);
  });

  it('checks the required pose for each view', () => {
    expect(failed(assessPose('side', front()))[0]?.message).toMatch(/Turn 90°/);
    expect(failed(assessPose('front', side()))[0]?.message).toMatch(/Face the camera/);
    expect(failed(assessPose('back', front()))[0]?.message).toMatch(/turn your back/);
    const armsDown = syntheticFrame({ view: 'front', chest: 120, waist: 100, hips: 130, armsOut: false });
    expect(failed(assessPose('front', armsDown))[0]?.message).toMatch(/arms slightly away/);
  });
});

describe('geometry', () => {
  it('computes ellipse circumference (circle sanity check)', () => {
    expect(ellipseCircumference(10, 10)).toBeCloseTo(Math.PI * 10, 6);
  });

  it('estimates circumferences from front width and side depth, scaled by height', () => {
    // 720 px silhouette at 180 cm → 0.25 cm/px.
    const r = estimateMeasurements({ front: front(), side: side() }, 180, 'test');
    expect(r.estimates.chestCm?.valueCm).toBeCloseTo(ellipseCircumference(30, 22.5), 0);
    expect(r.estimates.waistCm?.valueCm).toBeCloseTo(ellipseCircumference(25, 20), 0);
    expect(r.estimates.hipsCm?.valueCm).toBeCloseTo(ellipseCircumference(32.5, 25), 0);
    expect(r.estimates.shoulderCm?.valueCm).toBeCloseTo(100 * 0.25 * 1.1, 1);
    for (const e of Object.values(r.estimates)) {
      expect(e!.confidence).toBeGreaterThan(0.6);
      expect(e!.confidence).toBeLessThanOrEqual(1);
    }
    expect(r.proportions.legToHeightRatio).toBeCloseTo((740 - 420) / 720, 2);
    expect(r.warnings).toEqual([]);
  });

  it('scales with the entered height', () => {
    const a = estimateMeasurements({ front: front(), side: side() }, 180, 'test');
    const b = estimateMeasurements({ front: front(), side: side() }, 160, 'test');
    expect(b.estimates.chestCm!.valueCm / a.estimates.chestCm!.valueCm).toBeCloseTo(160 / 180, 2);
  });

  it('lowers confidence for implausible depth and when front and back disagree', () => {
    const flat = syntheticFrame({ view: 'side', chest: 30, waist: 80, hips: 100 });
    const r = estimateMeasurements({ front: front(), side: flat }, 180, 'test');
    expect(r.estimates.chestCm!.confidence).toBeLessThan(0.6);

    const backAgrees = syntheticFrame({ view: 'back', chest: 120, waist: 100, hips: 130 });
    const backDisagrees = syntheticFrame({ view: 'back', chest: 160, waist: 100, hips: 130 });
    const agree = estimateMeasurements({ front: front(), side: side(), back: backAgrees }, 180, 'test');
    const disagree = estimateMeasurements({ front: front(), side: side(), back: backDisagrees }, 180, 'test');
    expect(disagree.estimates.chestCm!.confidence).toBeLessThan(agree.estimates.chestCm!.confidence);
  });

  it('returns no estimates (with a warning) when the silhouette is missing', () => {
    const r = estimateMeasurements({ front: { ...front(), mask: null }, side: side() }, 180, 'test');
    expect(r.estimates).toEqual({});
    expect(r.warnings[0]).toMatch(/enter them manually/);
  });

  it('classifies body shape from chest, waist and hips', () => {
    expect(classifyBodyShape(92, 66, 94)).toBe('hourglass');
    expect(classifyBodyShape(88, 74, 100)).toBe('triangle');
    expect(classifyBodyShape(108, 88, 96)).toBe('inverted_triangle');
    expect(classifyBodyShape(96, 86, 98)).toBe('rectangle');
    expect(classifyBodyShape(100, 104, 102)).toBe('oval');
  });
});

