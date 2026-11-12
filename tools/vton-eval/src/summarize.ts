import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CRITERIA, parseCsv, type RunRecord } from './criteria.js';

const percentile = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const fmt = (n: number, d = 1) => (Number.isNaN(n) ? '—' : n.toFixed(d));

/** Combines run records with reviewers' scores into a per-provider comparison (markdown). */
export function summarize(records: RunRecord[], scores: Record<string, string>[]): string {
  const providers = [...new Set(records.map((r) => `${r.provider} (${r.modelVersion})`))];
  const out = ['# Virtual try-on evaluation summary', ''];
  out.push('| Provider | Source | Runs | Failure rate | p50 latency (s) | p95 latency (s) | Est. cost / run |', '| --- | --- | --: | --: | --: | --: | --: |');
  for (const name of providers) {
    const rs = records.filter((r) => `${r.provider} (${r.modelVersion})` === name);
    const ok = rs.filter((r) => r.status === 'ready');
    const lat = ok.map((r) => r.latencyMs / 1000);
    const cost = rs.find((r) => r.estimatedCostUsd !== null)?.estimatedCostUsd;
    out.push(
      `| ${name} | ${rs[0]!.source} | ${rs.length} | ${fmt((100 * (rs.length - ok.length)) / rs.length, 0)}% | ${fmt(percentile(lat, 50))} | ${fmt(percentile(lat, 95))} | ${cost == null ? 'unknown' : `$${cost.toFixed(3)}`} |`,
    );
  }
  out.push('', '## Mean review scores (1–5, higher is better)', '');
  out.push(`| Provider | n scored | ${CRITERIA.join(' | ')} |`, `| --- | --: | ${CRITERIA.map(() => '--:').join(' | ')} |`);
  for (const name of providers) {
    const [provider] = name.split(' (');
    const rows = scores.filter((s) => s.provider === provider && CRITERIA.some((c) => s[c]));
    const means = CRITERIA.map((c) => {
      const vals = rows.map((r) => Number(r[c])).filter((v) => v >= 1 && v <= 5);
      return fmt(mean(vals));
    });
    out.push(`| ${name} | ${rows.length} | ${means.join(' | ')} |`);
  }
  const mock = records.some((r) => r.source === 'mock');
  if (mock) out.push('', '_Mock rows are placeholders and must not be compared with real providers._');
  out.push('', 'Choose a production provider only after reviewing the actual output images, licence terms and cost.');
  return out.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('Usage: pnpm --filter @fitvision/vton-eval summarize <runs/RUN_DIR>');
    process.exit(1);
  }
  const base = path.resolve(process.env.INIT_CWD ?? process.cwd(), dir);
  const records = JSON.parse(readFileSync(path.join(base, 'results.json'), 'utf8')) as RunRecord[];
  const scores = parseCsv(readFileSync(path.join(base, 'scoring.csv'), 'utf8'));
  console.log(summarize(records, scores));
}
