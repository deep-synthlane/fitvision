import { describe, expect, it } from 'vitest';
import {
  bodyMeasurementsInputSchema,
  cmToFeetInches,
  feetInchesToCm,
  formatHeight,
  formatLength,
  fromDisplayLength,
  fromDisplayWeight,
  profileInputSchema,
  registerSchema,
  toDisplayLength,
} from './index.js';

describe('registerSchema', () => {
  it('normalises email', () => {
    const r = registerSchema.parse({ name: ' Ana ', email: ' Ana@Example.COM ', password: 'password1' });
    expect(r).toEqual({ name: 'Ana', email: 'ana@example.com', password: 'password1' });
  });

  it('rejects passwords over 72 bytes', () => {
    const r = registerSchema.safeParse({ name: 'A', email: 'a@b.co', password: 'é'.repeat(37) });
    expect(r.success).toBe(false);
  });
});

describe('profileInputSchema', () => {
  const valid = {
    name: 'Ana',
    birthYear: null,
    clothingPreference: 'womenswear',
    heightCm: 168,
    weightKg: 60,
    country: 'IN',
    measurementUnit: 'metric',
  };

  it('accepts a valid profile with optional birth year omitted', () => {
    expect(profileInputSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects unknown countries and out-of-range height', () => {
    const r = profileInputSchema.safeParse({ ...valid, country: 'XX', heightCm: 20 });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path[0]).sort()).toEqual(['country', 'heightCm']);
  });
});

describe('bodyMeasurementsInputSchema', () => {
  const empty = { heightCm: null, chestCm: null, waistCm: null, hipsCm: null, shoulderCm: null, inseamCm: null, armLengthCm: null };

  it('requires at least one measurement', () => {
    expect(bodyMeasurementsInputSchema.safeParse(empty).success).toBe(false);
  });

  it('defaults source to manual', () => {
    expect(bodyMeasurementsInputSchema.parse({ ...empty, chestCm: 96 }).source).toBe('manual');
  });

  it('rejects clients claiming body_scan as the source', () => {
    expect(bodyMeasurementsInputSchema.safeParse({ ...empty, chestCm: 96, source: 'body_scan' }).success).toBe(false);
  });
});

describe('units', () => {
  it('converts between metric and imperial', () => {
    expect(toDisplayLength(175.3, 'imperial')).toBe(69);
    expect(fromDisplayLength(38, 'imperial')).toBe(96.5);
    expect(fromDisplayWeight(150, 'imperial')).toBe(68);
    expect(formatLength(96, 'metric')).toBe('96 cm');
  });

  it('splits heights into feet and inches and back', () => {
    expect(cmToFeetInches(175)).toEqual({ feet: 5, inches: 8.9 });
    expect(cmToFeetInches(182.88)).toEqual({ feet: 6, inches: 0 });
    expect(cmToFeetInches(182.8)).toEqual({ feet: 6, inches: 0 }); // 71.97 in rounds up to a whole foot
    expect(feetInchesToCm(5, 9)).toBe(175.3);
    expect(formatHeight(175, 'imperial')).toBe('5′ 8.9″');
  });
});

import { parseSizeValue } from './index.js';
describe('parseSizeValue', () => {
  it('parses ranges, fractions and units into cm', () => {
    expect(parseSizeValue('86-90', 'cm')).toEqual({ minCm: 86, maxCm: 90, midCm: 88 });
    expect(parseSizeValue('34 1/2', 'in')).toEqual({ minCm: 87.6, maxCm: 87.6, midCm: 87.6 });
    expect(parseSizeValue('36–38', 'in')).toEqual({ minCm: 91.4, maxCm: 96.5, midCm: 94 });
    expect(parseSizeValue('96 cm', 'in')).toEqual({ minCm: 96, maxCm: 96, midCm: 96 });
    expect(parseSizeValue('large', 'cm')).toBeNull();
    expect(parseSizeValue('', 'cm')).toBeNull();
  });
});
