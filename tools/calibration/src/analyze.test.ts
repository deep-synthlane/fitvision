import { describe, expect, it } from 'vitest';
import { analyze, statsFor, toMarkdown } from './analyze.js';
import { parseCsv } from './csv.js';

const header =
  'participant_code,processing_version,tape_chest_1,tape_chest_2,scan_chest,scan_chest_conf,tape_waist_1,tape_waist_2,scan_waist,scan_waist_conf,notes';

describe('csv', () => {
  it('parses quoted fields with commas and escaped quotes', () => {
    const rows = parseCsv('a,b\r\n1,"x, ""y"""\n');
    expect(rows).toEqual([{ a: '1', b: 'x, "y"' }]);
  });
});

describe('statsFor', () => {
  it('computes bias, MAE and a scale factor that removes a proportional error', () => {
    // Scan consistently under-estimates by 5%.
    const pairs = [90, 95, 100, 105, 110].map((tape, i) => ({ participant: `P${i}`, tape, scan: tape * 0.95, confidence: 0.8 }));
    const s = statsFor(pairs, 'chest');
    expect(s.bias).toBeCloseTo(-5, 1);
    expect(s.mae).toBeCloseTo(5, 1);
    expect(s.suggestedFactor).toBeCloseTo(1 / 0.95, 3);
    expect(s.looMaeAfterFactor).toBeCloseTo(0, 3);
    expect(s.verdict).toBe('insufficient data');
  });

  it('passes or fails against targets once there are enough participants', () => {
    const good = Array.from({ length: 20 }, (_, i) => ({ participant: `P${i}`, tape: 90 + i, scan: 90 + i + (i % 2 ? 1 : -1), confidence: 0.7 }));
    expect(statsFor(good, 'waist').verdict).toBe('pass');
    const biased = good.map((p) => ({ ...p, scan: p.tape + 4 }));
    expect(statsFor(biased, 'waist').verdict).toBe('fail');
  });

  it('splits error by confidence so low-confidence flags can be validated', () => {
    const s = statsFor(
      [
        { participant: 'A', tape: 90, scan: 91, confidence: 0.9 },
        { participant: 'B', tape: 90, scan: 98, confidence: 0.4 },
      ],
      'hips',
    );
    expect(s.maeHighConfidence).toEqual({ n: 1, mae: 1 });
    expect(s.maeLowConfidence).toEqual({ n: 1, mae: 8 });
  });
});

describe('analyze', () => {
  it('averages repeated tape readings, groups by version, and flags data problems', () => {
    const csv = [
      header,
      'EXAMPLE-01,v1,98,98,95,0.8,84,84,82,0.6,example',
      'P01,v1,98,98.4,95,0.8,84,84,82,0.6,',
      'P02,v1,100,102,99,0.7,86,86,85,0.5,"tape slipped, redo"',
      'P01,v1,97,97,96,0.8,,,,,duplicate',
      'P03,v2,90,90,91,0.9,70,70,abc,0.9,',
      'P04,,90,90,91,0.9,70,70,71,0.9,',
    ].join('\n');
    const a = analyze(parseCsv(csv));
    const v1 = a.versions.find((v) => v.processingVersion === 'v1')!;
    expect(v1.participants).toBe(2);
    expect(v1.measures.chest!.n).toBe(3);
    expect(v1.measures.chest!.meanTape).toBeCloseTo((98.2 + 101 + 97) / 3, 1);
    expect(v1.measures.waist!.n).toBe(2);
    expect(a.versions.find((v) => v.processingVersion === 'v2')!.measures.waist).toBeUndefined();

    const w = a.warnings.join('\n');
    expect(w).toMatch(/example row skipped/);
    expect(w).toMatch(/P02\): chest tape readings differ by 2 cm/);
    expect(w).toMatch(/P01 appears more than once/);
    expect(w).toMatch(/P03\): non-numeric waist/);
    expect(w).toMatch(/missing processing_version/);
    expect(toMarkdown(a)).toContain('## v1');
  });
});
