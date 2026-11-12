import type { MeasurementSource } from './measurements.js';
import type { ProductCategory, SizeChart, SizeMeasurementKey } from './products.js';

/**
 * Deterministic, explainable size recommendation. Pure function of its inputs (no clock, no
 * randomness, no LLM, no try-on image): the same inputs always produce the same output, and the
 * inputs are returned with the result so it can be stored, audited and replayed.
 */
export const SIZE_ENGINE_VERSION = 'size-engine-1.1';

export const SIZE_DISCLAIMER =
  'Size recommendations are estimates based on the measurements and size information available for this product. Brand fit, garment cut, fabric stretch and personal fit preference may affect the actual fit.';
export const NO_SIZE_RECOMMENDATION_MESSAGE =
  'FitVision cannot confidently recommend a size because this product does not provide enough sizing measurements.';

export type BodyKey = 'chestCm' | 'waistCm' | 'hipsCm' | 'shoulderCm' | 'inseamCm' | 'armLengthCm' | 'heightCm';
type ChartKey = SizeMeasurementKey;

/** Size-chart measurement → the body measurement it is compared with. */
const PAIRS: Record<ChartKey, { body: BodyKey; label: string; kind: 'girth' | 'length' }> = {
  chestCm: { body: 'chestCm', label: 'Chest / bust', kind: 'girth' },
  waistCm: { body: 'waistCm', label: 'Waist', kind: 'girth' },
  hipsCm: { body: 'hipsCm', label: 'Hips', kind: 'girth' },
  shoulderCm: { body: 'shoulderCm', label: 'Shoulder width', kind: 'length' },
  inseamCm: { body: 'inseamCm', label: 'Inseam', kind: 'length' },
  sleeveCm: { body: 'armLengthCm', label: 'Sleeve / arm length', kind: 'length' },
};

const UPPER = { primary: ['chestCm', 'shoulderCm'], secondary: ['waistCm', 'sleeveCm'] } as const;
const LOWER = { primary: ['waistCm', 'hipsCm'], secondary: ['inseamCm'] } as const;

/** Which measurements matter for each category. Unrelated measurements are never required. */
export const SIZE_REQUIREMENTS: Record<ProductCategory, { primary: readonly ChartKey[]; secondary: readonly ChartKey[]; notCompared?: string }> = {
  tops: UPPER,
  shirts: UPPER,
  t_shirts: UPPER,
  jackets: UPPER,
  dresses: { primary: ['chestCm', 'waistCm', 'hipsCm'], secondary: [], notCompared: 'Height is not compared: size charts rarely give garment length for your height.' },
  trousers: LOWER,
  jeans: LOWER,
  shorts: LOWER,
  skirts: { primary: ['waistCm', 'hipsCm'], secondary: [] },
};

export type ChartQuality = 'complete' | 'partial' | 'insufficient' | 'missing';
export type ChartSource = 'product_body_chart' | 'product_garment_chart' | 'product_chart_unknown_type';
export type FitType = 'fitted' | 'regular' | 'relaxed';
export type Confidence = 'high' | 'medium' | 'low' | 'none';
export type MeasurementStatus = 'inside' | 'near_boundary' | 'between' | 'below_smallest' | 'above_largest' | 'unavailable';

export const CHART_SOURCE_LABELS: Record<ChartSource, string> = {
  product_body_chart: 'Product size chart (body measurements)',
  product_garment_chart: 'Product size chart (garment measurements)',
  product_chart_unknown_type: 'Product size chart (measurement type not stated)',
};
export const FIT_LABELS: Record<FitType, string> = { fitted: 'Fitted', regular: 'Regular', relaxed: 'Relaxed' };

export interface SizeEngineInput {
  category: ProductCategory;
  user: {
    measurementId: string;
    source: MeasurementSource;
    scanVersion: string | null;
    values: Partial<Record<BodyKey, number | null>>;
  };
  chart: {
    kind: SizeChart['kind'];
    source: SizeChart['source'];
    unit: SizeChart['unit'];
    /** In size order as published. Values in cm; min === max for single-value cells. */
    rows: { sizeLabel: string; values: Partial<Record<ChartKey, { min: number; max: number } | null>> }[];
  } | null;
  /** Sizes offered for sale (variants). */
  availableSizes: string[];
}

export interface PerSizeComparison {
  size: string;
  /** Range used for this size (cm), possibly derived from single values. */
  minCm: number | null;
  maxCm: number | null;
  status: 'inside' | 'below' | 'above' | 'unavailable';
}

export interface MeasurementComparison {
  key: ChartKey;
  label: string;
  role: 'primary' | 'secondary';
  userValueCm: number | null;
  status: MeasurementStatus;
  /** Size this measurement points to on its own. */
  matchedSize: string | null;
  betweenSizes: [string, string] | null;
  /** Garment charts: garment − body (cm) for the recommended size. */
  easeCm: number | null;
  rangesDerived: boolean;
  perSize: PerSizeComparison[];
  note: string;
}

export interface SizeRecommendationResult {
  algorithmVersion: string;
  chartQuality: ChartQuality;
  chartSource: ChartSource | null;
  recommendedSize: string | null;
  alternativeSize: string | null;
  alternativeReason: string | null;
  betweenSizes: [string, string] | null;
  fit: FitType | null;
  confidence: Confidence;
  confidenceReasons: string[];
  summary: string;
  measurements: MeasurementComparison[];
  /** Things to be aware of that may affect the result. */
  warnings: string[];
  /** Informational context (e.g. measurements deliberately not compared). */
  notes: string[];
  inputs: SizeEngineInput;
}

/* ------------------------------------------------------------------ */

/** Within this distance of a size edge counts as "close to boundary" (charts often step by 1 cm). */
const TOLERANCE_CM = 0.5;
const OUTSIDE_TOLERANCE_CM = 2; // beyond the chart by more than this → don't stretch the chart
const round1 = (n: number) => Math.round(n * 10) / 10;
const fmt = (n: number) => `${round1(n)} cm`;
const join = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
/** "chest / bust and waist measurements align" — subject + verb agreeing with the count. */
const subject = (ks: string[], plural: string, singular: string) => `${join(ks)} ${ks.length > 1 ? `measurements ${plural}` : `measurement ${singular}`}`;
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '');

/** Ranges per size for one column. Columns of single values get boundaries at the midpoints between neighbours. */
function columnRanges(rows: NonNullable<SizeEngineInput['chart']>['rows'], key: ChartKey) {
  const cells = rows.map((r) => r.values[key] ?? null);
  const present = cells.filter((c): c is { min: number; max: number } => c !== null);
  if (present.length === 0) return { ranges: cells.map(() => null), derived: false };
  const allPoints = present.every((c) => c.max - c.min < 0.5);
  if (!allPoints) {
    // Mixed: widen any single values slightly so they behave as ranges.
    return { ranges: cells.map((c) => (c ? (c.max - c.min < 0.5 ? { min: c.min - TOLERANCE_CM, max: c.max + TOLERANCE_CM } : c) : null)), derived: false };
  }
  const idx = cells.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
  const ranges: ({ min: number; max: number } | null)[] = cells.map(() => null);
  idx.forEach((i, k) => {
    const v = cells[i]!.min;
    const prev = k > 0 ? cells[idx[k - 1]!]!.min : null;
    const next = k < idx.length - 1 ? cells[idx[k + 1]!]!.min : null;
    const halfGapDown = prev !== null ? (v - prev) / 2 : next !== null ? (next - v) / 2 : 2;
    const halfGapUp = next !== null ? (next - v) / 2 : halfGapDown;
    ranges[i] = { min: round1(v - halfGapDown), max: round1(v + halfGapUp) };
  });
  return { ranges, derived: true };
}

interface Classified {
  status: MeasurementStatus;
  /** Index the measurement needs for a comfortable fit; and the closest smaller index. */
  needIndex: number | null;
  lowIndex: number | null;
  between: [number, number] | null;
  outsideByCm: number;
}

function classify(v: number, ranges: ({ min: number; max: number } | null)[]): Classified {
  const valid = ranges.map((r, i) => (r ? i : -1)).filter((i) => i >= 0);
  const inside = valid.filter((i) => v >= ranges[i]!.min && v <= ranges[i]!.max);
  if (inside.length > 0) {
    const i = inside[inside.length - 1]!; // on a shared boundary, prefer the larger size
    const r = ranges[i]!;
    const near = Math.min(v - r.min, r.max - v) <= Math.min(TOLERANCE_CM, (r.max - r.min) * 0.2) || inside.length > 1;
    return { status: near ? 'near_boundary' : 'inside', needIndex: i, lowIndex: inside[0]!, between: null, outsideByCm: 0 };
  }
  const first = valid[0]!;
  const last = valid[valid.length - 1]!;
  if (v < ranges[first]!.min) return { status: 'below_smallest', needIndex: first, lowIndex: first, between: null, outsideByCm: ranges[first]!.min - v };
  if (v > ranges[last]!.max) return { status: 'above_largest', needIndex: last, lowIndex: last, between: null, outsideByCm: v - ranges[last]!.max };
  const below = valid.filter((i) => ranges[i]!.max < v);
  const lo = below[below.length - 1]!;
  const hi = valid.find((i) => i > lo)!;
  return { status: 'between', needIndex: hi, lowIndex: lo, between: [lo, hi], outsideByCm: 0 };
}

const MIN_EASE_CM: Record<'upper' | 'dress' | 'lower', Partial<Record<ChartKey, number>>> = {
  upper: { chestCm: 4, waistCm: 2, shoulderCm: -1 },
  dress: { chestCm: 4, waistCm: 2, hipsCm: 2 },
  lower: { waistCm: 0, hipsCm: 2 },
};
const group = (c: ProductCategory) => (c === 'dresses' ? 'dress' : SIZE_REQUIREMENTS[c].primary.includes('chestCm') ? 'upper' : 'lower');

export function recommendSize(input: SizeEngineInput): SizeRecommendationResult {
  const req = SIZE_REQUIREMENTS[input.category];
  const warnings: string[] = [];
  const reasons: string[] = [];
  const notes: string[] = req.notCompared ? [req.notCompared] : [];
  const base = {
    algorithmVersion: SIZE_ENGINE_VERSION,
    recommendedSize: null,
    alternativeSize: null,
    alternativeReason: null,
    betweenSizes: null,
    fit: null,
    notes,
    inputs: input,
  } as const;

  const chart = input.chart;
  const chartSource: ChartSource | null = !chart
    ? null
    : chart.kind === 'body'
      ? 'product_body_chart'
      : chart.kind === 'garment'
        ? 'product_garment_chart'
        : 'product_chart_unknown_type';
  const rows = chart?.rows ?? [];
  const hasColumn = (k: ChartKey) => rows.some((r) => r.values[k]);
  const primaryInChart = req.primary.filter(hasColumn);
  const chartQuality: ChartQuality =
    rows.length === 0 ? 'missing' : primaryInChart.length === 0 || rows.length < 2 ? 'insufficient' : primaryInChart.length === req.primary.length ? 'complete' : 'partial';

  const none = (summary: string, extra: string[] = []): SizeRecommendationResult => ({
    ...base,
    chartQuality,
    chartSource,
    confidence: 'none',
    confidenceReasons: extra,
    summary,
    measurements,
    warnings,
  });

  // Size order: as published, but reversed if the first primary column clearly descends.
  let ordered = rows;
  const firstKey = primaryInChart[0];
  if (firstKey) {
    const mids = rows.map((r) => r.values[firstKey]).filter(Boolean).map((v) => (v!.min + v!.max) / 2);
    if (mids.length > 1 && mids[0]! > mids[mids.length - 1]!) ordered = [...rows].reverse();
  }
  const labels = ordered.map((r) => r.sizeLabel);

  const measurements: MeasurementComparison[] = [];
  const classified = new Map<ChartKey, Classified>();
  const rangesByKey = new Map<ChartKey, ({ min: number; max: number } | null)[]>();
  for (const [role, keys] of [['primary', req.primary], ['secondary', req.secondary]] as const) {
    for (const key of keys) {
      const pair = PAIRS[key];
      const v = input.user.values[pair.body] ?? null;
      const { ranges, derived } = columnRanges(ordered, key);
      rangesByKey.set(key, ranges);
      const perSize = labels.map((size, i) => {
        const r = ranges[i];
        return {
          size,
          minCm: r ? r.min : null,
          maxCm: r ? r.max : null,
          status: (!r || v === null ? 'unavailable' : v < r.min ? 'below' : v > r.max ? 'above' : 'inside') as PerSizeComparison['status'],
        };
      });
      const m: MeasurementComparison = {
        key,
        label: pair.label,
        role,
        userValueCm: v,
        status: 'unavailable',
        matchedSize: null,
        betweenSizes: null,
        easeCm: null,
        rangesDerived: derived,
        perSize,
        note: '',
      };
      if (!hasColumn(key)) m.note = 'Not in this size chart.';
      else if (v === null) m.note = 'You haven’t provided this measurement.';
      else if (chart?.kind !== 'garment') {
        const c = classify(v, ranges);
        classified.set(key, c);
        m.status = c.status;
        m.matchedSize = labels[c.needIndex!] ?? null;
        m.betweenSizes = c.between ? [labels[c.between[0]]!, labels[c.between[1]]!] : null;
        m.note =
          c.status === 'inside' || c.status === 'near_boundary'
            ? `${fmt(v)} fits ${labels[c.needIndex!]}${c.status === 'near_boundary' ? ' (close to the edge of the size)' : ''}.`
            : c.status === 'between'
              ? `${fmt(v)} falls between ${labels[c.between![0]]} and ${labels[c.between![1]]}.`
              : c.status === 'below_smallest'
                ? `${fmt(v)} is below the smallest size (${labels[c.needIndex!]}).`
                : `${fmt(v)} is above the largest size (${labels[c.needIndex!]}).`;
      }
      measurements.push(m);
    }
  }

  if (chartQuality === 'missing' || chartQuality === 'insufficient') {
    return none(NO_SIZE_RECOMMENDATION_MESSAGE, [chartQuality === 'missing' ? 'This product has no size chart.' : 'The size chart has no measurements relevant to this garment type.']);
  }
  const usable = req.primary.filter((k) => hasColumn(k) && input.user.values[PAIRS[k].body] != null);
  if (usable.length === 0) {
    return none(`Add your ${join(primaryInChart.map((k) => lower(PAIRS[k].label)))} measurements to get a size recommendation.`, ['None of the needed measurements are in your profile.']);
  }
  const missingUser = primaryInChart.filter((k) => !usable.includes(k));
  if (missingUser.length) warnings.push(`Your ${join(missingUser.map((k) => lower(PAIRS[k].label)))} isn’t in your profile, so it wasn’t compared.`);
  const missingChart = req.primary.filter((k) => !hasColumn(k));
  if (missingChart.length) warnings.push(`This size chart doesn’t include ${join(missingChart.map((k) => lower(PAIRS[k].label)))}.`);

  /* ---------- Garment-measurement charts: compare with minimum ease, conservatively ---------- */
  if (chart!.kind === 'garment') {
    const minEase = MIN_EASE_CM[group(input.category)];
    const girths = usable.filter((k) => PAIRS[k].kind === 'girth' || k === 'shoulderCm');
    for (const k of girths) {
      const v = input.user.values[PAIRS[k].body]!;
      const ranges = rangesByKey.get(k)!;
      const maxGarment = Math.max(...ranges.filter(Boolean).map((r) => r!.max));
      if (PAIRS[k].kind === 'girth' && maxGarment < v * 0.75) {
        warnings.push(`The ${lower(PAIRS[k].label)} values look like flat (half) garment measurements, which can’t be compared reliably with body measurements.`);
        return none('FitVision cannot confidently recommend a size because this product’s garment measurements can’t be compared reliably with your body measurements.', ['Garment chart values look like flat measurements.']);
      }
    }
    const ok = (i: number) =>
      girths.every((k) => {
        const r = rangesByKey.get(k)![i];
        return !r || (r.min + r.max) / 2 - input.user.values[PAIRS[k].body]! >= (minEase[k] ?? 2);
      });
    const idx = labels.findIndex((_, i) => ok(i));
    for (const m of measurements) {
      if (m.userValueCm === null || !girths.includes(m.key)) continue;
      const r = rangesByKey.get(m.key)![idx >= 0 ? idx : labels.length - 1];
      const ease = r ? round1((r.min + r.max) / 2 - m.userValueCm) : null;
      m.easeCm = ease;
      m.status = idx >= 0 ? 'inside' : 'above_largest';
      m.matchedSize = idx >= 0 ? labels[idx]! : null;
      if (r && ease !== null) m.note = `Garment ${fmt((r.min + r.max) / 2)} vs your ${fmt(m.userValueCm)} → ${ease >= 0 ? '+' : ''}${fmt(ease)} room (minimum used: ${minEase[m.key] ?? 2} cm).`;
    }
    if (idx < 0) return none('Even the largest size looks smaller than your measurements, based on the garment dimensions.', ['No size gives the minimum room needed.']);
    const leadKey = girths.find((k) => PAIRS[k].kind === 'girth') ?? girths[0]!;
    const leadEase = measurements.find((m) => m.key === leadKey)!.easeCm! - (minEase[leadKey] ?? 2);
    const fit: FitType = leadEase < 4 ? 'fitted' : leadEase < 10 ? 'regular' : 'relaxed';
    let confidence: Confidence = 'medium';
    reasons.push('Based on garment dimensions, not a body-measurement chart — exact drape is unknown.');
    if (chartQuality === 'partial' || missingUser.length) {
      confidence = 'low';
      reasons.push('Some key measurements couldn’t be compared.');
    }
    if (input.user.source === 'body_scan') reasons.push('Your measurements come from an uncalibrated body scan.');
    warnings.push('This chart lists garment measurements. We compared them with your body measurements using a minimum allowance for movement; actual fit depends on cut and fabric.');
    const alt = idx + 1 < labels.length ? labels[idx + 1]! : null;
    return {
      ...base,
      chartQuality,
      chartSource,
      recommendedSize: labels[idx]!,
      alternativeSize: alt,
      alternativeReason: alt ? `Choose ${alt} for a looser fit.` : null,
      fit,
      confidence,
      confidenceReasons: reasons,
      summary: `Based on the garment measurements, ${labels[idx]} is the smallest size that leaves room for your ${join(girths.map((k) => lower(PAIRS[k].label)))}.`,
      measurements,
      warnings: [...warnings, ...availabilityWarning(labels[idx]!, input.availableSizes)],
    };
  }

  /* ---------- Body-measurement (or unknown-type) charts ---------- */
  const prim = usable.map((k) => ({ key: k, c: classified.get(k)! }));
  const tooLarge = prim.find((p) => p.c.status === 'above_largest' && p.c.outsideByCm > OUTSIDE_TOLERANCE_CM);
  if (tooLarge) {
    const v = input.user.values[PAIRS[tooLarge.key].body]!;
    const last = rangesByKey.get(tooLarge.key)!.filter(Boolean).at(-1)!;
    return none(
      `Your ${lower(PAIRS[tooLarge.key].label)} (${fmt(v)}) is larger than this product’s largest size (${labels[tooLarge.c.needIndex!]}, up to ${fmt(last.max)}), so no size can be recommended.`,
      ['Your measurement is outside the size chart.'],
    );
  }
  const recIndex = Math.max(...prim.map((p) => p.c.needIndex!));
  const lowIndex = Math.min(...prim.map((p) => p.c.lowIndex!));
  const deciding = prim.filter((p) => p.c.needIndex === recIndex);
  const recommended = labels[recIndex]!;

  // Explanation: group measurements by the size they point to.
  const bySize = new Map<string, string[]>();
  for (const p of prim) {
    const s = p.c.status === 'between' ? `${labels[p.c.between![0]]}–${labels[p.c.between![1]]}` : labels[p.c.needIndex!]!;
    bySize.set(s, [...(bySize.get(s) ?? []), lower(PAIRS[p.key].label)]);
  }
  const lead = deciding[0]!;
  let summary: string;
  let alternative: string | null = null;
  let alternativeReason: string | null = null;
  let betweenSizes: [string, string] | null = null;
  const conflict = new Set(prim.map((p) => p.c.needIndex)).size > 1;

  if (lead.c.status === 'between') {
    const [lo, hi] = lead.c.between!;
    betweenSizes = [labels[lo]!, labels[hi]!];
    alternative = labels[lo]!;
    alternativeReason = `Choose ${labels[lo]} for a closer fit.`;
    const v = input.user.values[PAIRS[lead.key].body]!;
    summary = `Between ${labels[lo]} and ${labels[hi]}: your ${lower(PAIRS[lead.key].label)} (${fmt(v)}) falls between ${labels[lo]} (up to ${fmt(rangesByKey.get(lead.key)![lo]!.max)}) and ${labels[hi]} (from ${fmt(rangesByKey.get(lead.key)![hi]!.min)}). Choose ${labels[lo]} for a closer fit or ${labels[hi]} for a more relaxed fit.`;
  } else if (conflict) {
    const parts = [...bySize.entries()].map(([s, ks]) => ({ s, ks }));
    const others = parts.filter((p) => p.s !== recommended);
    const mine = parts.find((p) => p.s === recommended);
    const otherKs = others.flatMap((p) => p.ks);
    const mineKs = mine?.ks ?? deciding.map((d) => lower(PAIRS[d.key].label));
    summary = `Your ${subject(otherKs, 'align', 'aligns')} with ${join(others.map((p) => p.s))}, while your ${subject(mineKs, 'align', 'aligns')} more closely with ${recommended}. We recommend ${recommended} for a more comfortable fit.`;
    alternative = labels[lowIndex]!;
    alternativeReason = `Choose ${alternative} if you prefer a closer fit through the ${join(others.flatMap((p) => p.ks))}.`;
  } else {
    const ks = prim.map((p) => lower(PAIRS[p.key].label));
    summary = `Your ${ks.length > 1 ? `${join(ks)} measurements all fall` : `${ks[0]} measurement falls`} within size ${recommended}.`;
    if (lead.c.status === 'near_boundary' && recIndex + 1 < labels.length) {
      const r = rangesByKey.get(lead.key)![recIndex]!;
      const v = input.user.values[PAIRS[lead.key].body]!;
      if (r.max - v <= TOLERANCE_CM) {
        alternative = labels[recIndex + 1]!;
        alternativeReason = `Your ${lower(PAIRS[lead.key].label)} is near the top of ${recommended}; choose ${alternative} for a more relaxed fit.`;
      }
    }
  }
  if (lead.c.status === 'below_smallest') warnings.push(`Your ${lower(PAIRS[lead.key].label)} is below the smallest size, so ${recommended} may be loose.`);

  // Fit indication from where the deciding measurement sits within the recommended size.
  let fit: FitType;
  if (lead.c.status === 'between' || lead.c.status === 'below_smallest') fit = 'relaxed';
  else if (lead.c.status === 'above_largest') fit = 'fitted';
  else {
    const r = rangesByKey.get(lead.key)![recIndex]!;
    const pos = r.max > r.min ? (input.user.values[PAIRS[lead.key].body]! - r.min) / (r.max - r.min) : 0.5;
    fit = pos > 0.66 ? 'fitted' : pos < 0.34 ? 'relaxed' : 'regular';
  }

  // Secondary measurements inform but don't decide.
  for (const key of req.secondary) {
    const m = measurements.find((x) => x.key === key)!;
    if (!hasColumn(key)) continue;
    if (m.userValueCm === null) {
      reasons.push(`Your ${lower(m.label)} isn’t in your profile.`);
      continue;
    }
    const c = classified.get(key)!;
    if (c.needIndex! > recIndex) warnings.push(`Your ${lower(m.label)} is closer to ${labels[c.needIndex!]} — it may feel short or tight in ${recommended}.`);
  }

  // Confidence: explicit rules, most severe wins.
  let confidence: Confidence = 'high';
  const cap = (level: Confidence, reason: string) => {
    const order: Confidence[] = ['high', 'medium', 'low', 'none'];
    if (order.indexOf(level) > order.indexOf(confidence)) confidence = level;
    reasons.push(reason);
  };
  const secondaryMissing = reasons.splice(0);
  for (const note of secondaryMissing) cap('medium', note);
  if (chartQuality === 'partial') cap('medium', 'The size chart is missing some key measurements.');
  if (missingUser.length) cap('medium', 'Some key measurements weren’t available to compare.');
  if (lead.c.status === 'between' || lead.c.status === 'near_boundary') cap('medium', 'Your measurements are near a size boundary.');
  if (chart!.kind === 'unknown') {
    cap('medium', 'The size chart doesn’t say whether it lists body or garment measurements.');
    warnings.push('The chart doesn’t state whether these are body or garment measurements; we treated them as body measurements.');
  }
  if (input.user.source === 'body_scan') cap('medium', 'Your measurements come from an uncalibrated body scan — check them with a tape measure for a better match.');
  if (prim.some((p) => p.c.status === 'above_largest')) cap('low', 'Your measurement is slightly above the largest size.');
  if (lead.c.status === 'below_smallest') cap('low', 'Your measurement is below the smallest size.');
  if (recIndex - lowIndex >= 2) cap('low', 'Your measurements point to sizes more than one size apart.');
  else if (conflict) cap('medium', 'Your measurements point to different sizes.');
  if (confidence === 'high') reasons.push('Product body-measurement chart, all key measurements compared, comfortably within one size.');

  return {
    ...base,
    chartQuality,
    chartSource,
    recommendedSize: recommended,
    alternativeSize: alternative,
    alternativeReason,
    betweenSizes,
    fit,
    confidence,
    confidenceReasons: reasons,
    summary,
    measurements,
    warnings: [...warnings, ...availabilityWarning(recommended, input.availableSizes)],
  };
}

function availabilityWarning(size: string, available: string[]): string[] {
  if (available.length === 0 || available.some((a) => norm(a) === norm(size))) return [];
  return [`${size} is in the size chart but isn’t listed among the sizes offered for this product.`];
}

/** Converts a stored product size chart into engine rows (using the original min/max where known). */
export function chartToEngineRows(chart: SizeChart): NonNullable<SizeEngineInput['chart']>['rows'] {
  const RAW: Record<ChartKey, string> = { chestCm: 'chest', waistCm: 'waist', hipsCm: 'hips', shoulderCm: 'shoulder', inseamCm: 'inseam', sleeveCm: 'sleeve' };
  return chart.rows.map((r) => ({
    sizeLabel: r.sizeLabel,
    values: Object.fromEntries(
      (Object.keys(RAW) as ChartKey[]).map((k) => {
        const raw = r.raw[RAW[k]];
        if (raw && raw.minCm !== null && raw.maxCm !== null) return [k, { min: raw.minCm, max: raw.maxCm }];
        const v = r[k];
        return [k, v === null ? null : { min: v, max: v }];
      }),
    ),
  }));
}

/* ---------- API shapes ---------- */

export type StaleReason = 'measurements_changed' | 'product_changed' | 'algorithm_changed';

export interface SizeRecommendation {
  id: string;
  productId: string;
  measurementId: string;
  measurementSource: MeasurementSource;
  scanVersion: string | null;
  recommendedVariantId: string | null;
  result: SizeRecommendationResult;
  createdAt: string;
}

export interface SizeRecommendationResponse {
  recommendation: SizeRecommendation | null;
  stale: StaleReason[];
  /** False when the user has no saved measurements yet. */
  canCompute: boolean;
}
