/**
 * Avatar try-on review: the fields each output is scored on, and the pass criteria for
 * TRYON_AVATAR_VERIFIED. Pure functions (tested); the CLIs are sheet.ts and summary.ts.
 */

/** Manual review fields (filled in avatar-scoring.csv by two reviewers). */
export const REVIEW_FIELDS = {
  garment_visible: 'yes | no — the garment visibly appears on the avatar',
  category_position: 'ok | wrong — garment sits in the expected body region for its category',
  neckline: '1–5 | na — neckline/collar aligned with the avatar neck',
  shoulder: '1–5 | na — shoulder seams aligned with the avatar shoulders',
  sleeve: '1–5 | na — sleeves placed on the arms with the right length',
  waist: '1–5 | na — waistline/waistband at the avatar waist',
  lower_body: '1–5 | na — trousers/skirt/hem placement on hips and legs',
  colour: '1–5 — garment colour preserved',
  pattern_logo: '1–5 | na — stripes, dots, logo and text preserved',
  body_distortion: 'none | minor | severe — avatar body changed (slimmed, widened, warped, extra limbs)',
  artifacts: 'none | minor | severe — smears, seams, background damage',
  acceptable: 'yes | no — overall, would this be acceptable to show a user as an approximate preview?',
  reviewer: 'initials',
  notes: 'free text',
} as const;
export type ReviewField = keyof typeof REVIEW_FIELDS;

/** Machine-filled columns (from results.json and image comparison). */
export interface AutoColumns {
  case: string;
  style: string;
  provider: string;
  source: 'mock' | 'real';
  body: string;
  garment: string;
  region: 'upper_body' | 'lower_body' | 'full_body';
  generation_failure: 'yes' | 'no';
  error: string;
  latency_s: string;
  /** Provider model version as reported by the provider (Replicate: prediction.version). */
  model_version: string;
  /** Billed compute time and actual cost where the provider reports it; estimate otherwise. */
  predict_time_s: string;
  actual_cost_usd: string;
  est_cost_usd: string;
  /** Output visually identical to the avatar input (the app rejects these). */
  auto_unchanged: 'yes' | 'no' | '';
  /** % of avatar pixels that changed, overall and in the upper/lower half of the body. */
  auto_changed_pct: string;
  auto_changed_upper_pct: string;
  auto_changed_lower_pct: string;
  output: string;
}
export type ScoringRow = AutoColumns & Record<ReviewField, string>;

export const PASS_CRITERIA = {
  minRuns: 20,
  /** Garment visible AND in the right region, over all runs (failures count as misses). */
  minCorrectRate: 0.9,
  /** Per region (upper/lower/full), share placed in the right region among completed runs. */
  minRegionPlacementRate: 0.9,
  /** Severe distortion: under 10 % overall and no body shape with 2 or more. */
  maxSevereDistortionRate: 0.1,
  maxSeverePerBody: 1,
};

export interface GroupVerdict {
  key: string;
  provider: string;
  style: string;
  source: 'mock' | 'real';
  runs: number;
  failures: number;
  reviewed: number;
  correct: number;
  correctRate: number;
  regionPlacement: Record<string, { ok: number; of: number }>;
  severeDistortion: number;
  severeByBody: Record<string, number>;
  unchanged: number;
  latencyP50: number | null;
  latencyP95: number | null;
  totalCostUsd: number | null;
  /** True when every cost came from the provider's billing data rather than an estimate. */
  costIsActual: boolean;
  acceptable: number;
  meanScores: Record<string, number | null>;
  verdict: 'PASS' | 'NOT MET' | 'NOT ELIGIBLE';
  reasons: string[];
}

const SCORE_FIELDS = ['neckline', 'shoulder', 'sleeve', 'waist', 'lower_body', 'colour', 'pattern_logo'] as const;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const percentile = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
};

/** Groups rows by provider × render style and checks the pass criteria. */
export function evaluate(rows: ScoringRow[]): GroupVerdict[] {
  const groups = new Map<string, ScoringRow[]>();
  for (const r of rows) {
    const key = `${r.provider} · ${r.style}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.entries()].map(([key, rs]) => {
    const done = rs.filter((r) => r.generation_failure === 'no');
    const reviewed = done.filter((r) => r.garment_visible && r.category_position);
    const correct = reviewed.filter((r) => r.garment_visible === 'yes' && r.category_position === 'ok').length;
    const regionPlacement: GroupVerdict['regionPlacement'] = {};
    for (const r of reviewed) {
      const slot = (regionPlacement[r.region] ??= { ok: 0, of: 0 });
      slot.of++;
      if (r.category_position === 'ok') slot.ok++;
    }
    const severe = reviewed.filter((r) => r.body_distortion === 'severe');
    const severeByBody: Record<string, number> = {};
    for (const r of severe) severeByBody[r.body] = (severeByBody[r.body] ?? 0) + 1;
    const unchanged = done.filter((r) => r.auto_unchanged === 'yes').length;
    const latencies = done.map((r) => Number(r.latency_s)).filter((n) => Number.isFinite(n));
    const costOf = (r: ScoringRow) => (r.actual_cost_usd !== '' ? Number(r.actual_cost_usd) : r.est_cost_usd !== '' ? Number(r.est_cost_usd) : NaN);
    const costs = rs.map(costOf).filter(Number.isFinite);
    const costIsActual = rs.every((r) => r.actual_cost_usd !== '');
    const meanScores = Object.fromEntries(
      SCORE_FIELDS.map((f) => {
        const vals = reviewed.map((r) => Number(r[f])).filter((v) => v >= 1 && v <= 5);
        return [f, vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null];
      }),
    );

    const source = rs[0]!.source;
    const reasons: string[] = [];
    let verdict: GroupVerdict['verdict'];
    if (source === 'mock') {
      verdict = 'NOT ELIGIBLE';
      reasons.push('Mock provider: placeholder images, never counts towards avatar try-on verification.');
    } else {
      const c = PASS_CRITERIA;
      if (rs.length < c.minRuns) reasons.push(`Only ${rs.length} runs (need ${c.minRuns}+).`);
      if (reviewed.length < done.length) reasons.push(`${done.length - reviewed.length} completed outputs not reviewed yet.`);
      if (correct / rs.length < c.minCorrectRate) reasons.push(`Garment visibly correct in ${pct(correct / rs.length)} of runs (need ${pct(c.minCorrectRate)}; failures count as misses).`);
      for (const [region, { ok, of }] of Object.entries(regionPlacement)) {
        if (of && ok / of < c.minRegionPlacementRate) reasons.push(`${region}: placed correctly in ${ok}/${of}.`);
      }
      if (reviewed.length && severe.length / reviewed.length >= c.maxSevereDistortionRate) reasons.push(`Severe body distortion in ${severe.length}/${reviewed.length}.`);
      const systematic = Object.entries(severeByBody).filter(([, n]) => n > c.maxSeverePerBody);
      if (systematic.length) reasons.push(`Systematic severe distortion on: ${systematic.map(([b, n]) => `${b} (${n})`).join(', ')}.`);
      if (unchanged) reasons.push(`${unchanged} outputs returned the avatar unchanged.`);
      verdict = reasons.length ? 'NOT MET' : 'PASS';
    }
    return {
      key,
      provider: rs[0]!.provider,
      style: rs[0]!.style,
      source,
      runs: rs.length,
      failures: rs.length - done.length,
      reviewed: reviewed.length,
      correct,
      correctRate: rs.length ? correct / rs.length : 0,
      regionPlacement,
      severeDistortion: severe.length,
      severeByBody,
      unchanged,
      latencyP50: percentile(latencies, 50),
      latencyP95: percentile(latencies, 95),
      totalCostUsd: costs.length ? Math.round(costs.reduce((a, b) => a + b, 0) * 1000) / 1000 : null,
      costIsActual,
      acceptable: reviewed.filter((r) => r.acceptable === 'yes').length,
      meanScores,
      verdict,
      reasons,
    };
  });
}

/** Markdown report comparing provider × style groups. */
export function report(verdicts: GroupVerdict[]): string {
  const out = ['# Avatar try-on validation', ''];
  out.push('| Provider · style | Source | Runs | Failures | Garment correct | Acceptable | Severe distortion | Unchanged | p50 / p95 latency (s) | Cost | Verdict |');
  out.push('| --- | --- | --: | --: | --: | --: | --: | --: | --: | --: | --- |');
  for (const v of verdicts) {
    const lat = v.latencyP50 === null ? '—' : `${v.latencyP50.toFixed(1)} / ${v.latencyP95!.toFixed(1)}`;
    out.push(
      `| ${v.key} | ${v.source} | ${v.runs} | ${v.failures} | ${v.correct}/${v.runs} (${pct(v.correctRate)}) | ${v.acceptable}/${v.runs} | ${v.severeDistortion} | ${v.unchanged} | ${lat} | ${v.totalCostUsd === null ? 'unknown' : `$${v.totalCostUsd.toFixed(2)}${v.costIsActual ? '' : ' (est.)'}`} | **${v.verdict}** |`,
    );
  }
  out.push('', '## Mean placement and preservation scores (1–5)', '', `| Provider · style | ${SCORE_FIELDS.join(' | ')} |`, `| --- | ${SCORE_FIELDS.map(() => '--:').join(' | ')} |`);
  for (const v of verdicts) out.push(`| ${v.key} | ${SCORE_FIELDS.map((f) => v.meanScores[f] ?? '—').join(' | ')} |`);
  for (const v of verdicts) {
    if (!v.reasons.length) continue;
    out.push('', `### ${v.key}: ${v.verdict}`, '', ...v.reasons.map((r) => `- ${r}`));
  }
  out.push('', 'Set TRYON_AVATAR_VERIFIED=true only for a real provider and model version with a PASS here, after looking at the images themselves.');
  return out.join('\n');
}
