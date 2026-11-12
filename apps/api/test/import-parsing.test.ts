import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';
import { mapCategory } from '../src/products/import/categories.js';
import { buildChart, extractSizeChart, parseMeasurementCell } from '../src/products/import/sizeChart.js';
import { parsePrice } from '../src/products/import/types.js';

describe('category mapping', () => {
  it('maps common product names and breadcrumbs', () => {
    expect(mapCategory(['Women > Clothing > Denim Jackets']).category).toBe('jackets');
    expect(mapCategory(['Graphic T-Shirt']).category).toBe('t_shirts');
    expect(mapCategory(['Oxford Shirt']).category).toBe('shirts');
    expect(mapCategory(['Short Sleeve Shirt']).category).toBe('shirts');
    expect(mapCategory(['Cargo Shorts']).category).toBe('shorts');
    expect(mapCategory(['Slim Fit Jeans']).category).toBe('jeans');
    expect(mapCategory(['Wrap Dress']).category).toBe('dresses');
    expect(mapCategory(['Wool Jumper']).category).toBe('tops');
    expect(mapCategory(['Women > Denim Jackets']).subcategory).toBe('Denim Jackets');
  });

  it('flags footwear and accessories as unsupported', () => {
    expect(mapCategory(['Leather Ankle Boots'])).toMatchObject({ category: null, unsupported: true });
    expect(mapCategory(['Canvas Tote Bag'])).toMatchObject({ category: null, unsupported: true });
  });
});

describe('price parsing', () => {
  it('handles US and EU formats', () => {
    expect(parsePrice('89.50')).toBe(89.5);
    expect(parsePrice('$1,299.00')).toBe(1299);
    expect(parsePrice('1.299,00 €')).toBe(1299);
    expect(parsePrice('1 299,5')).toBe(1299.5);
    expect(parsePrice('free')).toBeUndefined();
  });
});

describe('size-chart normalisation', () => {
  it('parses ranges, fractions and single values', () => {
    expect(parseMeasurementCell('86-90')).toEqual({ min: 86, max: 90 });
    expect(parseMeasurementCell('34 1/2')).toEqual({ min: 34.5, max: 34.5 });
    expect(parseMeasurementCell('34½ – 36')).toEqual({ min: 34.5, max: 36 });
    expect(parseMeasurementCell('n/a')).toBeNull();
  });

  it('converts inches to cm (midpoint) and keeps the raw text', () => {
    const chart = buildChart([{ sizeLabel: 'M', cells: { chestCm: '38-40', waistCm: '32' } }], 'in', 'body', 'html_table')!;
    expect(chart.rows[0]).toMatchObject({ sizeLabel: 'M', chestCm: 99.1, waistCm: 81.3, hipsCm: null });
    expect(chart.rows[0]!.raw.chest).toEqual({ raw: '38-40', minCm: 96.5, maxCm: 101.6 });
  });

  it('reads tables with sizes as rows and detects cm', () => {
    const $ = cheerio.load(`<table><caption>Body measurements (cm)</caption>
      <tr><th>Size</th><th>Bust</th><th>Waist</th><th>Hip</th></tr>
      <tr><td>S</td><td>84-88</td><td>66-70</td><td>90-94</td></tr>
      <tr><td>M</td><td>88-92</td><td>70-74</td><td>94-98</td></tr></table>`);
    const { chart, inferredUnit } = extractSizeChart($)!;
    expect(inferredUnit).toBe(false);
    expect(chart).toMatchObject({ unit: 'cm', kind: 'body' });
    expect(chart.rows.map((r) => [r.sizeLabel, r.chestCm, r.waistCm, r.hipsCm])).toEqual([
      ['S', 86, 68, 92],
      ['M', 90, 72, 96],
    ]);
  });

  it('reads transposed tables and infers inches when no unit is given', () => {
    const $ = cheerio.load(`<table><tr><td>Size</td><td>S</td><td>M</td></tr>
      <tr><td>Chest</td><td>36</td><td>38</td></tr><tr><td>Sleeve</td><td>33</td><td>34</td></tr></table>`);
    const { chart, inferredUnit } = extractSizeChart($)!;
    expect(inferredUnit).toBe(true);
    expect(chart.unit).toBe('in');
    expect(chart.rows[1]).toMatchObject({ sizeLabel: 'M', chestCm: 96.5, sleeveCm: 86.4 });
  });

  it('ignores tables that are not size charts', () => {
    expect(extractSizeChart(cheerio.load('<table><tr><td>Delivery</td><td>Price</td></tr><tr><td>Standard</td><td>4.99</td></tr></table>'))).toBeNull();
  });
});
