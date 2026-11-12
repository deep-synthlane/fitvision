import { describe, expect, it } from 'vitest';
import type { AvatarInputs } from '@fitvision/shared';
import { readGlbJson } from '../src/avatar/glb.js';
import { ParametricAvatarGenerator } from '../src/avatar/generator.js';
import { ellipsePerimeter, mapMeasurementsToParameters, solveSection } from '../src/avatar/parameters.js';

const inputs = (values: Partial<AvatarInputs['values']>, clothingPreference: AvatarInputs['clothingPreference'] = 'menswear'): AvatarInputs => ({
  measurementId: '00000000-0000-0000-0000-000000000001',
  clothingPreference,
  values: { heightCm: 176, shoulderCm: null, chestCm: null, waistCm: null, hipsCm: null, inseamCm: null, armLengthCm: null, ...values },
});

describe('body parameter mapping', () => {
  it('uses measured values and marks missing ones as typical defaults', () => {
    const p = mapMeasurementsToParameters(inputs({ chestCm: 98, waistCm: 84 }));
    expect(p.resolved.chestCm).toEqual({ valueCm: 98, source: 'measured' });
    expect(p.resolved.waistCm).toEqual({ valueCm: 84, source: 'measured' });
    expect(p.resolved.hipsCm).toEqual({ valueCm: 96.8, source: 'default' }); // 0.55 × 176
    expect(p.resolved.inseamCm.source).toBe('default');
  });

  it('uses clothing preference for defaults', () => {
    const w = mapMeasurementsToParameters(inputs({}, 'womenswear'));
    const m = mapMeasurementsToParameters(inputs({}, 'menswear'));
    expect(w.resolved.hipsCm.valueCm).toBeGreaterThan(m.resolved.hipsCm.valueCm);
  });

  it('solves torso sections whose ellipse perimeter equals the girth', () => {
    const s = solveSection(90, 0.75);
    expect(ellipsePerimeter(s.widthCm, s.depthCm)).toBeCloseTo(90, 6);
    expect(s.depthCm / s.widthCm).toBeCloseTo(0.75, 6);
  });

  it('requires height', () => {
    expect(() => mapMeasurementsToParameters(inputs({ heightCm: null }))).toThrow(/Height is required/);
  });
});

describe('parametric avatar generator', () => {
  const generator = new ParametricAvatarGenerator();

  it('produces a model that matches its parameters (self-check)', async () => {
    const out = await generator.generate(
      inputs({ heightCm: 176, shoulderCm: 45, chestCm: 98, waistCm: 84, hipsCm: 99, inseamCm: 80, armLengthCm: 60 }),
    );
    const f = out.parameters.fidelity;
    expect(Math.abs(f.heightErrorCm)).toBeLessThan(0.1);
    expect(Math.abs(f.shoulderErrorCm)).toBeLessThan(0.1);
    expect(Math.abs(f.inseamErrorCm)).toBeLessThan(0.1);
    for (const pct of [f.chestErrorPct, f.waistErrorPct, f.hipsErrorPct]) expect(Math.abs(pct)).toBeLessThan(0.5);
  });

  it('changes shape when measurements change', async () => {
    const slim = await generator.generate(inputs({ waistCm: 70 }));
    const wide = await generator.generate(inputs({ waistCm: 110 }));
    expect(wide.parameters.sections.waist.widthCm).toBeGreaterThan(slim.parameters.sections.waist.widthCm);
    expect(wide.asset.data.equals(slim.asset.data)).toBe(false);
  });

  it('writes a valid GLB (metres, y-up) and an SVG preview', async () => {
    const out = await generator.generate(inputs({ heightCm: 160 }, 'womenswear'));
    const { json, binLength } = readGlbJson(out.asset.data);
    const accessors = json.accessors as { count: number; max?: number[]; min?: number[] }[];
    expect((json.asset as { version: string }).version).toBe('2.0');
    expect(accessors[0]!.max![1]! - accessors[0]!.min![1]!).toBeCloseTo(1.6, 3);
    expect(accessors[2]!.count % 3).toBe(0);
    expect(binLength).toBeGreaterThan(0);
    expect(out.asset.data.length % 4).toBe(0);

    const svg = out.preview.data.toString('utf8');
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).not.toMatch(/<script|on\w+=/i);
  });
});
