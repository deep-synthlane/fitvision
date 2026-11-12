import type { BodyKey, Confidence, FitType, SizeEngineInput } from '@fitvision/shared';

/**
 * Known-answer cases for the size engine. Synthetic charts and people only — never user data.
 * Each case states the expected outcome; the runner fails on any difference.
 */
export interface SizeCase {
  id: string;
  description: string;
  input: SizeEngineInput;
  expect: {
    recommendedSize: string | null;
    alternativeSize?: string | null;
    confidence: Confidence;
    fit?: FitType | null;
    betweenSizes?: [string, string] | null;
    chartQuality?: 'complete' | 'partial' | 'insufficient' | 'missing';
    summaryIncludes?: string;
    warningIncludes?: string;
  };
}

type Cell = [number, number] | number | null;
const cell = (c: Cell) => (c === null ? null : typeof c === 'number' ? { min: c, max: c } : { min: c[0], max: c[1] });
const chart = (kind: 'body' | 'garment' | 'unknown', cols: string[], rows: [string, ...Cell[]][], unit: 'cm' | 'in' = 'cm'): SizeEngineInput['chart'] => ({
  kind,
  source: 'html_table',
  unit,
  rows: rows.map(([sizeLabel, ...cells]) => ({
    sizeLabel,
    values: Object.fromEntries(cols.map((c, i) => [c, cell(cells[i] ?? null)])),
  })),
});
const user = (values: Partial<Record<BodyKey, number>>, source: SizeEngineInput['user']['source'] = 'manual') => ({
  measurementId: 'm-test',
  source,
  scanVersion: null,
  values,
});
const sizes = (...s: string[]) => s;

/** The example chart from the Phase 6 brief. */
const BRIEF = chart('body', ['chestCm', 'waistCm', 'hipsCm'], [
  ['S', [88, 92], [72, 76], [92, 96]],
  ['M', [93, 98], [77, 83], [97, 102]],
  ['L', [99, 104], [84, 90], [103, 108]],
]);

export const CASES: SizeCase[] = [
  {
    id: 'inside-all',
    description: 'Brief example: every measurement inside M',
    input: { category: 'dresses', user: user({ chestCm: 96, waistCm: 82, hipsCm: 98 }), chart: BRIEF, availableSizes: sizes('S', 'M', 'L') },
    expect: { recommendedSize: 'M', alternativeSize: null, confidence: 'high', chartQuality: 'complete', summaryIncludes: 'all fall within size M' },
  },
  {
    id: 'conflict-one-size',
    description: 'Chest and waist → M, hips → L: recommend L, explain, offer M',
    input: { category: 'dresses', user: user({ chestCm: 96, waistCm: 80, hipsCm: 105 }), chart: BRIEF, availableSizes: sizes('S', 'M', 'L') },
    expect: {
      recommendedSize: 'L',
      alternativeSize: 'M',
      confidence: 'medium',
      summaryIncludes: 'Your chest / bust and waist measurements align with M, while your hips measurement aligns more closely with L. We recommend L for a more comfortable fit.',
    },
  },
  {
    id: 'conflict-two-sizes',
    description: 'Chest → S, hips → L: large conflict lowers confidence',
    input: { category: 'dresses', user: user({ chestCm: 90, waistCm: 80, hipsCm: 105 }), chart: BRIEF, availableSizes: sizes('S', 'M', 'L') },
    expect: { recommendedSize: 'L', alternativeSize: 'S', confidence: 'low' },
  },
  {
    id: 'between-sizes',
    description: 'Waist in the gap between M (≤83) and L (≥84)',
    input: { category: 'trousers', user: user({ waistCm: 83.5, hipsCm: 99, inseamCm: 80 }), chart: BRIEF, availableSizes: sizes('S', 'M', 'L') },
    expect: { recommendedSize: 'L', alternativeSize: 'M', betweenSizes: ['M', 'L'], confidence: 'medium', fit: 'relaxed', summaryIncludes: 'Choose M for a closer fit or L for a more relaxed fit' },
  },
  {
    id: 'near-top-boundary',
    description: 'Chest at the very top of M: offer L for a relaxed fit',
    input: { category: 'dresses', user: user({ chestCm: 97.8, waistCm: 80, hipsCm: 99 }), chart: BRIEF, availableSizes: sizes('S', 'M', 'L') },
    expect: { recommendedSize: 'M', alternativeSize: 'L', confidence: 'medium', fit: 'fitted' },
  },
  {
    id: 'missing-user-measurement',
    description: 'User has no hip measurement: compare the rest, lower confidence, say so',
    input: { category: 'dresses', user: user({ chestCm: 96, waistCm: 80 }), chart: BRIEF, availableSizes: sizes('S', 'M', 'L') },
    expect: { recommendedSize: 'M', confidence: 'medium', warningIncludes: 'hips isn’t in your profile' },
  },
  {
    id: 'no-relevant-user-measurements',
    description: 'Trousers but the user only has a chest measurement',
    input: { category: 'trousers', user: user({ chestCm: 96 }), chart: BRIEF, availableSizes: sizes('S', 'M', 'L') },
    expect: { recommendedSize: null, confidence: 'none', summaryIncludes: 'Add your waist and hips measurements' },
  },
  {
    id: 'inches-converted',
    description: 'Chart published in inches (converted to cm on import: 36–38 in = 91.4–96.5 cm)',
    input: {
      category: 'shirts',
      user: user({ chestCm: 94, shoulderCm: 45 }),
      chart: chart('body', ['chestCm', 'shoulderCm'], [['S', [86.4, 91.4], [41.9, 43.2]], ['M', [91.4, 96.5], [43.2, 45.7]], ['L', [96.5, 101.6], [45.7, 48.3]]], 'in'),
      availableSizes: sizes('S', 'M', 'L'),
    },
    expect: { recommendedSize: 'M', confidence: 'high', chartQuality: 'complete' },
  },
  {
    id: 'single-values-midpoints',
    description: 'Chart lists one value per size: ranges derived from midpoints (88/94/100 → M = 91–97)',
    input: { category: 'shirts', user: user({ chestCm: 95, shoulderCm: 44 }), chart: chart('body', ['chestCm', 'shoulderCm'], [['S', 88, 42], ['M', 94, 44], ['L', 100, 46]]), availableSizes: sizes('S', 'M', 'L') },
    expect: { recommendedSize: 'M', confidence: 'high' },
  },
  {
    id: 'partial-chart',
    description: 'Shirt chart with chest only (no shoulder): partial → medium',
    input: { category: 'shirts', user: user({ chestCm: 95, shoulderCm: 44 }), chart: chart('body', ['chestCm'], [['S', [88, 92]], ['M', [93, 98]], ['L', [99, 104]]]), availableSizes: sizes('S', 'M', 'L') },
    expect: { recommendedSize: 'M', confidence: 'medium', chartQuality: 'partial', warningIncludes: 'doesn’t include shoulder width' },
  },
  {
    id: 'insufficient-chart',
    description: 'Shirt chart with only waist (not a primary measurement for tops): no recommendation',
    input: { category: 'shirts', user: user({ chestCm: 95, waistCm: 80 }), chart: chart('body', ['waistCm'], [['S', [72, 76]], ['M', [77, 83]]]), availableSizes: sizes('S', 'M') },
    expect: { recommendedSize: null, confidence: 'none', chartQuality: 'insufficient', summaryIncludes: 'does not provide enough sizing measurements' },
  },
  {
    id: 'labels-only',
    description: 'Sizes S/M/L with no measurements: never derive sizing from labels',
    input: { category: 't_shirts', user: user({ chestCm: 95, shoulderCm: 44 }), chart: chart('body', [], [['S'], ['M'], ['L']]), availableSizes: sizes('S', 'M', 'L') },
    expect: { recommendedSize: null, confidence: 'none', chartQuality: 'insufficient' },
  },
  {
    id: 'no-chart',
    description: 'No size chart at all',
    input: { category: 'jeans', user: user({ waistCm: 80, hipsCm: 96 }), chart: null, availableSizes: sizes('30', '32') },
    expect: { recommendedSize: null, confidence: 'none', chartQuality: 'missing' },
  },
  {
    id: 'garment-chart',
    description: 'Garment measurements: smallest size with minimum room (chest +4 cm, shoulder ≥ −1 cm); capped at medium',
    input: { category: 'shirts', user: user({ chestCm: 96, shoulderCm: 44 }), chart: chart('garment', ['chestCm', 'shoulderCm'], [['S', 100, 43], ['M', 106, 45], ['L', 112, 47]]), availableSizes: sizes('S', 'M', 'L') },
    expect: { recommendedSize: 'S', alternativeSize: 'M', confidence: 'medium', fit: 'fitted', warningIncludes: 'garment measurements' },
  },
  {
    id: 'garment-flat-measurements',
    description: 'Garment chart with flat (half) widths must not be compared with body girth',
    input: { category: 'shirts', user: user({ chestCm: 96, shoulderCm: 44 }), chart: chart('garment', ['chestCm', 'shoulderCm'], [['S', 50, 43], ['M', 53, 45], ['L', 56, 47]]), availableSizes: sizes('S', 'M', 'L') },
    expect: { recommendedSize: null, confidence: 'none', warningIncludes: 'flat (half)' },
  },
  {
    id: 'unknown-chart-type',
    description: 'Chart doesn’t say body or garment: treated as body, confidence reduced',
    input: { category: 'dresses', user: user({ chestCm: 96, waistCm: 80, hipsCm: 99 }), chart: { ...BRIEF!, kind: 'unknown' }, availableSizes: sizes('S', 'M', 'L') },
    expect: { recommendedSize: 'M', confidence: 'medium', warningIncludes: 'doesn’t state whether' },
  },
  {
    id: 'numeric-waist-sizes',
    description: 'Jeans sizes 32/34/36 with single waist values; hips not in chart',
    input: { category: 'jeans', user: user({ waistCm: 85, hipsCm: 100, inseamCm: 81 }), chart: chart('body', ['waistCm'], [['32', 81], ['34', 86], ['36', 91]]), availableSizes: sizes('32', '34', '36') },
    expect: { recommendedSize: '34', confidence: 'medium', chartQuality: 'partial' },
  },
  {
    id: 'dress-sizes-8-10-12',
    description: 'UK-style numeric dress sizes',
    input: {
      category: 'dresses',
      user: user({ chestCm: 87, waistCm: 70, hipsCm: 95 }),
      chart: chart('body', ['chestCm', 'waistCm', 'hipsCm'], [['8', [80, 84], [62, 66], [87, 91]], ['10', [85, 89], [67, 71], [92, 96]], ['12', [90, 94], [72, 76], [97, 101]]]),
      availableSizes: sizes('8', '10', '12'),
    },
    expect: { recommendedSize: '10', confidence: 'high' },
  },
  {
    id: 'descending-xs-2xl',
    description: 'Chart published largest-first (2XL…XS) is put back in size order',
    input: {
      category: 't_shirts',
      user: user({ chestCm: 92, shoulderCm: 43 }),
      chart: chart('body', ['chestCm', 'shoulderCm'], [['2XL', [112, 117], [49, 51]], ['XL', [106, 111], [47, 49]], ['L', [100, 105], [45, 47]], ['M', [94, 99], [43, 45]], ['S', [88, 93], [41, 43]], ['XS', [82, 87], [39, 41]]]),
      availableSizes: sizes('XS', 'S', 'M', 'L', 'XL', '2XL'),
    },
    // Chest 92 → S; shoulder 43 sits on the S/M boundary → M; so M is recommended with S as the closer fit.
    expect: { recommendedSize: 'M', alternativeSize: 'S', confidence: 'medium' },
  },
  {
    id: 'far-above-largest',
    description: 'Waist 6 cm above the largest size: no recommendation rather than a false one',
    input: { category: 'skirts', user: user({ waistCm: 96, hipsCm: 106 }), chart: BRIEF, availableSizes: sizes('S', 'M', 'L') },
    expect: { recommendedSize: null, confidence: 'none', summaryIncludes: 'larger than this product’s largest size' },
  },
  {
    id: 'slightly-above-largest',
    description: 'Hips 1 cm above the largest size: largest size, low confidence',
    input: { category: 'skirts', user: user({ waistCm: 88, hipsCm: 109 }), chart: BRIEF, availableSizes: sizes('S', 'M', 'L') },
    expect: { recommendedSize: 'L', confidence: 'low', fit: 'fitted' },
  },
  {
    id: 'uncalibrated-scan',
    description: 'Measurements straight from the body scan cap confidence at medium',
    input: { category: 'dresses', user: user({ chestCm: 96, waistCm: 80, hipsCm: 99 }, 'body_scan'), chart: BRIEF, availableSizes: sizes('S', 'M', 'L') },
    expect: { recommendedSize: 'M', confidence: 'medium' },
  },
  {
    id: 'size-not-offered',
    description: 'Recommended size appears in the chart but not in the offered sizes',
    input: { category: 'dresses', user: user({ chestCm: 100, waistCm: 86, hipsCm: 105 }), chart: BRIEF, availableSizes: sizes('S', 'M') },
    expect: { recommendedSize: 'L', confidence: 'high', warningIncludes: 'isn’t listed among the sizes offered' },
  },
];
