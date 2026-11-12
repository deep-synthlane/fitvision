/**
 * Compares scan-estimated measurements against tape measurements from volunteers.
 * Results are grouped by scan `processing_version` — never mix versions in one calibration.
 */

export const MEASURES = ['shoulder', 'chest', 'waist', 'hips'] as const;
export type Measure = (typeof MEASURES)[number];

/** Proposed acceptance targets (cm). To be agreed with the product team before use. */
export const TARGETS: Record<Measure, { maxMae: number; maxAbsBias: number }> = {
  shoulder: { maxMae: 2, maxAbsBias: 1 },
  chest: { maxMae: 3, maxAbsBias: 1.5 },
  waist: { maxMae: 3, maxAbsBias: 1.5 },
  hips: { maxMae: 3, maxAbsBias: 1.5 },
};
export const MIN_PARTICIPANTS = 20;
/** Two tape readings further apart than this should be re-measured. */
export const TAPE_REPEAT_TOLERANCE_CM = 1;
const LOW_CONFIDENCE = 0.6;

export interface Pair {
  participant: string;
  tape: number;
  scan: number;
  confidence: number | null;
}

export interface MeasureStats {
  n: number;
  meanTape: number;
  meanScan: number;
  /** Mean of (scan − tape): positive means the scan over-estimates. */
  bias: number;
  mae: number;
  rmse: number;
  mapePct: number;
  within2cmPct: number;
  within4cmPct: number;
  /** Least-squares scale factor (tape ≈ factor × scan) — the candidate for geometry CALIBRATION. */
  suggestedFactor: number;
  /** Leave-one-out MAE after applying the factor: an honest estimate of the improvement. */
  looMaeAfterFactor: number;
  maeHighConfidence: { n: number; mae: number } | null;
  maeLowConfidence: { n: number; mae: number } | null;
  verdict: 'pass' | 'fail' | 'insufficient data';
}

export interface VersionReport {
  processingVersion: string;
  participants: number;
  measures: Partial<Record<Measure, MeasureStats>>;
}

export interface Analysis {
  versions: VersionReport[];
  warnings: string[];
}

const num = (v: string | undefined) => {
  if (v === undefined || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const scaleFactor = (pairs: Pair[]) => pairs.reduce((s, p) => s + p.tape * p.scan, 0) / pairs.reduce((s, p) => s + p.scan * p.scan, 0);

export function statsFor(pairs: Pair[], measure: Measure): MeasureStats {
  const errors = pairs.map((p) => p.scan - p.tape);
  const abs = errors.map(Math.abs);
  const factor = scaleFactor(pairs);
  const loo =
    pairs.length > 1
      ? mean(pairs.map((p, i) => Math.abs(scaleFactor(pairs.filter((_, j) => j !== i)) * p.scan - p.tape)))
      : NaN;
  const byConfidence = (high: boolean) => {
    const sel = pairs.filter((p) => p.confidence !== null && p.confidence >= LOW_CONFIDENCE === high);
    return sel.length ? { n: sel.length, mae: round(mean(sel.map((p) => Math.abs(p.scan - p.tape)))) } : null;
  };
  const mae = mean(abs);
  const bias = mean(errors);
  const target = TARGETS[measure];
  return {
    n: pairs.length,
    meanTape: round(mean(pairs.map((p) => p.tape))),
    meanScan: round(mean(pairs.map((p) => p.scan))),
    bias: round(bias),
    mae: round(mae),
    rmse: round(Math.sqrt(mean(errors.map((e) => e * e)))),
    mapePct: round(mean(pairs.map((p) => (100 * Math.abs(p.scan - p.tape)) / p.tape))),
    within2cmPct: round((100 * abs.filter((a) => a <= 2).length) / abs.length, 1),
    within4cmPct: round((100 * abs.filter((a) => a <= 4).length) / abs.length, 1),
    suggestedFactor: round(factor, 4),
    looMaeAfterFactor: round(loo),
    maeHighConfidence: byConfidence(true),
    maeLowConfidence: byConfidence(false),
    verdict:
      pairs.length < MIN_PARTICIPANTS
        ? 'insufficient data'
        : mae <= target.maxMae && Math.abs(bias) <= target.maxAbsBias
          ? 'pass'
          : 'fail',
  };
}

export function analyze(rows: Record<string, string>[]): Analysis {
  const warnings: string[] = [];
  const byVersion = new Map<string, Map<Measure, Pair[]>>();
  const participantsByVersion = new Map<string, Set<string>>();

  rows.forEach((row, i) => {
    const line = i + 2; // header is line 1
    const participant = row.participant_code ?? '';
    const version = row.processing_version ?? '';
    if (!participant || participant.startsWith('EXAMPLE')) {
      if (participant.startsWith('EXAMPLE')) warnings.push(`Line ${line}: example row skipped.`);
      return;
    }
    if (!version) {
      warnings.push(`Line ${line} (${participant}): missing processing_version — row skipped.`);
      return;
    }
    const seen = participantsByVersion.get(version) ?? new Set<string>();
    if (seen.has(participant)) warnings.push(`Line ${line}: ${participant} appears more than once for ${version}.`);
    seen.add(participant);
    participantsByVersion.set(version, seen);

    for (const m of MEASURES) {
      const t1 = num(row[`tape_${m}_1`]);
      const t2 = num(row[`tape_${m}_2`]);
      const scan = num(row[`scan_${m}`]);
      const conf = num(row[`scan_${m}_conf`]);
      if ([t1, t2, scan, conf].some((v) => Number.isNaN(v))) {
        warnings.push(`Line ${line} (${participant}): non-numeric ${m} value — ${m} skipped.`);
        continue;
      }
      const tapes = [t1, t2].filter((v): v is number => v !== null);
      if (tapes.length === 0 || scan === null) continue;
      if (tapes.length === 2 && Math.abs(tapes[0]! - tapes[1]!) > TAPE_REPEAT_TOLERANCE_CM) {
        warnings.push(
          `Line ${line} (${participant}): ${m} tape readings differ by ${round(Math.abs(tapes[0]! - tapes[1]!), 1)} cm — re-measure.`,
        );
      }
      const pairs = byVersion.get(version) ?? new Map<Measure, Pair[]>();
      pairs.set(m, [...(pairs.get(m) ?? []), { participant, tape: mean(tapes), scan, confidence: conf }]);
      byVersion.set(version, pairs);
    }
  });

  const versions = [...byVersion.entries()].map(([processingVersion, pairs]) => ({
    processingVersion,
    participants: participantsByVersion.get(processingVersion)?.size ?? 0,
    measures: Object.fromEntries(MEASURES.filter((m) => pairs.get(m)?.length).map((m) => [m, statsFor(pairs.get(m)!, m)])),
  }));
  return { versions, warnings };
}

export function toMarkdown(a: Analysis): string {
  const out: string[] = ['# Body-scan calibration report', ''];
  out.push(
    `Targets (proposed): MAE ≤ ${TARGETS.chest.maxMae} cm and |bias| ≤ ${TARGETS.chest.maxAbsBias} cm for chest/waist/hips; ` +
      `MAE ≤ ${TARGETS.shoulder.maxMae} cm and |bias| ≤ ${TARGETS.shoulder.maxAbsBias} cm for shoulder; at least ${MIN_PARTICIPANTS} participants.`,
    '',
  );
  if (a.versions.length === 0) out.push('_No usable rows._', '');
  for (const v of a.versions) {
    out.push(`## ${v.processingVersion}`, '', `Participants: ${v.participants}`, '');
    out.push('| Measure | n | Bias (scan−tape) | MAE | RMSE | MAPE | ≤2 cm | ≤4 cm | Factor | LOO MAE with factor | MAE conf ≥0.6 | MAE conf <0.6 | Verdict |');
    out.push('| --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --- |');
    for (const m of MEASURES) {
      const s = v.measures[m];
      if (!s) continue;
      const c = (x: { n: number; mae: number } | null) => (x ? `${x.mae} (n=${x.n})` : '—');
      out.push(
        `| ${m} | ${s.n} | ${s.bias} | ${s.mae} | ${s.rmse} | ${s.mapePct}% | ${s.within2cmPct}% | ${s.within4cmPct}% | ${s.suggestedFactor} | ${Number.isNaN(s.looMaeAfterFactor) ? '—' : s.looMaeAfterFactor} | ${c(s.maeHighConfidence)} | ${c(s.maeLowConfidence)} | ${s.verdict} |`,
      );
    }
    out.push('');
  }
  if (a.warnings.length) out.push('## Warnings', '', ...a.warnings.map((w) => `- ${w}`), '');
  out.push(
    '_Apply a factor only if its leave-one-out MAE is clearly better than the raw MAE, then bump `GEOMETRY_VERSION` and collect a fresh validation set — never validate on the data used to fit the factor._',
  );
  return out.join('\n');
}
