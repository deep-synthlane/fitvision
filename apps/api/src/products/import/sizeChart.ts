import type { CheerioAPI } from 'cheerio';
import type { SizeChart, SizeChartRow, SizeMeasurementKey } from '@fitvision/shared';

const MEASURE_HEADERS: [SizeMeasurementKey, RegExp, string][] = [
  ['chestCm', /\b(chest|bust)\b/i, 'chest'],
  ['waistCm', /\bwaist\b/i, 'waist'],
  ['hipsCm', /\bhips?\b|\bseat\b/i, 'hips'],
  ['shoulderCm', /\bshoulders?\b/i, 'shoulder'],
  ['inseamCm', /\binseam\b|\binside leg\b|\binner leg\b/i, 'inseam'],
  ['sleeveCm', /\bsleeve\b|\barm length\b/i, 'sleeve'],
];

const CM_PER_IN = 2.54;
const round1 = (n: number) => Math.round(n * 10) / 10;

function unitIn(text: string): 'cm' | 'in' | null {
  if (/\bcm\b|centimet/i.test(text)) return 'cm';
  if (/\bin(ch(es)?)?\b|"|″/i.test(text)) return 'in';
  return null;
}

/** "34 1/2", "34½", "86-90", "86 – 90 cm", "34 to 36" → numbers in the source unit. */
export function parseMeasurementCell(raw: string): { min: number; max: number } | null {
  const s = raw
    .replace(/½/g, '.5')
    .replace(/¼/g, '.25')
    .replace(/¾/g, '.75')
    .replace(/(\d+)\s+1\/2/g, '$1.5')
    .replace(/(\d+)\s+1\/4/g, '$1.25')
    .replace(/(\d+)\s+3\/4/g, '$1.75')
    .replace(/,(\d)/g, '.$1');
  const m = /(\d+(?:\.\d+)?)(?:\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?))?/.exec(s);
  if (!m) return null;
  const a = Number(m[1]);
  const b = m[2] ? Number(m[2]) : a;
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

/** Converts parsed cells into a normalised chart (cm, midpoint for ranges) keeping the raw text. */
export function buildChart(
  rows: { sizeLabel: string; cells: Partial<Record<SizeMeasurementKey, string>> }[],
  unit: 'cm' | 'in',
  kind: SizeChart['kind'],
  source: SizeChart['source'],
): SizeChart | null {
  const out: SizeChartRow[] = [];
  for (const row of rows) {
    const r: SizeChartRow = {
      sizeLabel: row.sizeLabel,
      chestCm: null,
      waistCm: null,
      hipsCm: null,
      shoulderCm: null,
      inseamCm: null,
      sleeveCm: null,
      raw: {},
    };
    let any = false;
    for (const [key, , short] of MEASURE_HEADERS) {
      const cell = row.cells[key];
      if (!cell) continue;
      const parsed = parseMeasurementCell(cell);
      const factor = (unitIn(cell) ?? unit) === 'in' ? CM_PER_IN : 1;
      const minCm = parsed ? round1(parsed.min * factor) : null;
      const maxCm = parsed ? round1(parsed.max * factor) : null;
      r.raw[short] = { raw: cell.slice(0, 80), minCm, maxCm };
      if (minCm !== null && maxCm !== null && maxCm > 0 && maxCm <= 300) {
        r[key] = round1((minCm + maxCm) / 2);
        any = true;
      }
    }
    if (any) out.push(r);
  }
  return out.length ? { unit, kind, source, rows: out.slice(0, 40) } : null;
}

function measureKey(text: string): SizeMeasurementKey | null {
  return MEASURE_HEADERS.find(([, re]) => re.test(text))?.[0] ?? null;
}

/**
 * Reads size-chart tables in either orientation:
 *  - sizes as rows:    | Size | Chest | Waist |
 *  - sizes as columns: | Size | S | M | L |  then rows "Chest", "Waist", …
 */
export function extractSizeChart($: CheerioAPI): { chart: SizeChart; inferredUnit: boolean } | null {
  for (const table of $('table').toArray()) {
    const $t = $(table);
    const grid = $t
      .find('tr')
      .toArray()
      .map((tr) =>
        $(tr)
          .find('th,td')
          .toArray()
          .map((c) => $(c).text().replace(/\s+/g, ' ').trim()),
      )
      .filter((r) => r.length > 1);
    if (grid.length < 2) continue;

    const context = `${$t.find('caption').text()} ${grid[0]!.join(' ')} ${surroundingText($, $t)}`;
    const kind: SizeChart['kind'] = /garment|product measure|laid flat|flat measure/i.test(context)
      ? 'garment'
      : /body measure|your measure|to fit/i.test(context)
        ? 'body'
        : 'unknown';
    const header = grid[0]!;
    const headerKeys = header.map(measureKey);
    let rows: { sizeLabel: string; cells: Partial<Record<SizeMeasurementKey, string>> }[] = [];

    if (headerKeys.filter(Boolean).length >= 1) {
      rows = grid.slice(1).map((r) => ({
        sizeLabel: r[0]!,
        cells: Object.fromEntries(headerKeys.map((k, i) => [k, r[i]]).filter(([k, v]) => k && v)) as Partial<Record<SizeMeasurementKey, string>>,
      }));
    } else if (grid.slice(1).some((r) => measureKey(r[0]!))) {
      const sizes = header.slice(1);
      rows = sizes.map((sizeLabel, col) => {
        const cells: Partial<Record<SizeMeasurementKey, string>> = {};
        for (const r of grid.slice(1)) {
          const k = measureKey(r[0]!);
          if (k && r[col + 1]) cells[k] = r[col + 1]!;
        }
        return { sizeLabel, cells };
      });
    } else continue;

    rows = rows.filter((r) => r.sizeLabel && r.sizeLabel.length <= 40);
    const allCells = rows.flatMap((r) => Object.values(r.cells)).join(' ');
    let unit = unitIn(context) ?? unitIn(allCells);
    let inferredUnit = false;
    if (!unit) {
      // No unit stated: adult chest/waist/hip values below ~60 are almost certainly inches.
      const sample = rows.flatMap((r) => [r.cells.chestCm, r.cells.waistCm, r.cells.hipsCm]).filter(Boolean).map((c) => parseMeasurementCell(c!)?.min ?? 0);
      unit = sample.length && Math.max(...sample) < 60 ? 'in' : 'cm';
      inferredUnit = true;
    }
    const chart = buildChart(rows, unit, kind, 'html_table');
    if (chart) return { chart, inferredUnit };
  }
  return null;
}

function surroundingText($: CheerioAPI, $t: ReturnType<CheerioAPI>): string {
  return $t.prevAll('h1,h2,h3,h4,p').slice(0, 2).text().slice(0, 300);
}
