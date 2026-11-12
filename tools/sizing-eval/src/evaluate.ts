import { recommendSize, type SizeRecommendationResult } from '@fitvision/shared';
import type { SizeCase } from './cases.js';

export interface CaseOutcome {
  id: string;
  pass: boolean;
  deterministic: boolean;
  problems: string[];
  result: SizeRecommendationResult;
}

export function evaluateCase(c: SizeCase): CaseOutcome {
  const result = recommendSize(c.input);
  const again = recommendSize(structuredClone(c.input));
  const deterministic = JSON.stringify(result) === JSON.stringify(again);
  const e = c.expect;
  const problems: string[] = [];
  const check = (label: string, actual: unknown, expected: unknown) => {
    if (expected !== undefined && JSON.stringify(actual) !== JSON.stringify(expected)) problems.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  };
  check('recommendedSize', result.recommendedSize, e.recommendedSize);
  check('alternativeSize', result.alternativeSize, e.alternativeSize);
  check('confidence', result.confidence, e.confidence);
  check('fit', result.fit, e.fit);
  check('betweenSizes', result.betweenSizes, e.betweenSizes);
  check('chartQuality', result.chartQuality, e.chartQuality);
  if (e.summaryIncludes && !result.summary.includes(e.summaryIncludes)) problems.push(`summary missing "${e.summaryIncludes}": ${result.summary}`);
  if (e.warningIncludes && !result.warnings.some((w) => w.includes(e.warningIncludes!))) problems.push(`no warning containing "${e.warningIncludes}": ${JSON.stringify(result.warnings)}`);
  if (!deterministic) problems.push('non-deterministic output');
  return { id: c.id, pass: problems.length === 0, deterministic, problems, result };
}
