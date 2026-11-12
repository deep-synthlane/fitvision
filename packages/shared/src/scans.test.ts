import { describe, expect, it } from 'vitest';
import { deriveScanSource, scanSubmissionSchema, type MeasurementValues } from './index.js';

const empty: MeasurementValues = {
  heightCm: null,
  chestCm: null,
  waistCm: null,
  hipsCm: null,
  shoulderCm: null,
  inseamCm: null,
  armLengthCm: null,
};
const estimates = {
  chestCm: { valueCm: 96.2, confidence: 0.8 },
  waistCm: { valueCm: 82, confidence: 0.5 },
};

describe('deriveScanSource', () => {
  it('is body_scan when every estimate is accepted (manual-only fields may be added)', () => {
    expect(deriveScanSource(estimates, { ...empty, chestCm: 96.2, waistCm: 82, inseamCm: 80, heightCm: 176 })).toBe('body_scan');
    expect(deriveScanSource(estimates, { ...empty, chestCm: 96.24, waistCm: 82 })).toBe('body_scan');
  });

  it('is corrected when an estimate is changed or cleared', () => {
    expect(deriveScanSource(estimates, { ...empty, chestCm: 97, waistCm: 82 })).toBe('corrected');
    expect(deriveScanSource(estimates, { ...empty, chestCm: 96.2, waistCm: null })).toBe('corrected');
  });
});

describe('scanSubmissionSchema', () => {
  const scan = {
    processingVersion: 'test-1',
    estimates,
    proportions: { shoulderToHipRatio: 1.1, waistToHipRatio: 0.8, legToHeightRatio: 0.48, bodyShape: 'rectangle' },
  };

  it('accepts a valid submission and defaults warnings', () => {
    const r = scanSubmissionSchema.parse({ scan, measurements: { ...empty, chestCm: 96.2 } });
    expect(r.scan.warnings).toEqual([]);
  });

  it('rejects out-of-range confidence and empty measurements', () => {
    const bad = scanSubmissionSchema.safeParse({
      scan: { ...scan, estimates: { chestCm: { valueCm: 96, confidence: 1.4 } } },
      measurements: empty,
    });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues.map((i) => i.path.join('.')).sort()).toEqual(['measurements._', 'scan.estimates.chestCm.confidence']);
  });
});
