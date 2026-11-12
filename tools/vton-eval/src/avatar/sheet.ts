/**
 * Turns a run of an avatar manifest into avatar-scoring.csv: run data and automatic image checks,
 * plus empty review columns (REVIEW_FIELDS) for reviewers.
 *
 *   pnpm --filter @fitvision/vton-eval avatar-sheet runs/<RUN> data/avatar/<style>/manifest.json
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { looksUnchanged } from '../../../../apps/api/src/modules/tryon/jobs.js';
import { toCsv, type RunRecord } from '../criteria.js';
import { fetchPredictionBilling } from './replicateBilling.js';
import { REVIEW_FIELDS, type ScoringRow } from './review.js';

interface ManifestCase {
  id: string;
  person: string;
  garment: string;
  notes?: string;
  region: ScoringRow['region'];
  style: string;
  bodyId: string;
  garmentId: string;
}

const GRID = { width: 96, height: 128 };
const BACKGROUND = [242, 242, 240];

/** % of avatar pixels that changed, overall and in the upper and lower half of the avatar's extent. */
export async function changedShares(person: Buffer, output: Buffer) {
  const grid = (img: Buffer) => sharp(img).removeAlpha().resize(GRID.width, GRID.height, { fit: 'fill' }).raw().toBuffer();
  const [a, b] = await Promise.all([grid(person), grid(output)]);
  let top = GRID.height;
  let bottom = 0;
  const isBody = (i: number) => Math.abs(a[i]! - BACKGROUND[0]!) + Math.abs(a[i + 1]! - BACKGROUND[1]!) + Math.abs(a[i + 2]! - BACKGROUND[2]!) > 18;
  for (let y = 0; y < GRID.height; y++) {
    for (let x = 0; x < GRID.width; x++) {
      if (!isBody((y * GRID.width + x) * 3)) continue;
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  const mid = (top + bottom) / 2;
  const count: Record<'all' | 'upper' | 'lower', [number, number]> = { all: [0, 0], upper: [0, 0], lower: [0, 0] };
  for (let y = 0; y < GRID.height; y++) {
    for (let x = 0; x < GRID.width; x++) {
      const i = (y * GRID.width + x) * 3;
      if (!isBody(i)) continue;
      const changed = Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!) > 60 ? 1 : 0;
      for (const k of ['all', y < mid ? 'upper' : 'lower'] as const) {
        count[k][0] += changed;
        count[k][1]++;
      }
    }
  }
  const share = ([c, n]: [number, number]) => (n ? String(Math.round((100 * c) / n)) : '');
  return { all: share(count.all), upper: share(count.upper), lower: share(count.lower) };
}

const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** One row per case: avatar input | garment input | each provider's output with its automatic checks. */
function contactSheet(rows: ScoringRow[], cases: ManifestCase[], runDir: string, manifestDir: string): string {
  const rel = (p: string) => esc(path.relative(runDir, path.join(manifestDir, p)));
  const body = cases
    .filter((c) => rows.some((r) => r.case === c.id))
    .map((c) => {
      const outs = rows
        .filter((r) => r.case === c.id)
        .map((r) => {
          const checks = r.generation_failure === 'yes'
            ? `<b class="bad">FAILED</b> ${esc(r.error)}`
            : `unchanged: <b class="${r.auto_unchanged === 'yes' ? 'bad' : ''}">${r.auto_unchanged}</b> · changed upper ${r.auto_changed_upper_pct}% / lower ${r.auto_changed_lower_pct}%`;
          const img = r.output ? `<img src="${esc(r.output)}" alt="">` : '<div class="none">no output</div>';
          return `<td>${img}<div>${esc(r.provider)}${r.source === 'mock' ? ' <b class="bad">MOCK</b>' : ''}</div><div>${r.latency_s} s · ${r.actual_cost_usd ? `$${r.actual_cost_usd}` : r.est_cost_usd ? `~$${r.est_cost_usd}` : 'cost n/a'}</div><div>${checks}</div></td>`;
        })
        .join('');
      return `<tr><th>${esc(c.id.split('__').slice(1).join(' · '))}<br><small>${esc(c.region)}<br>${esc(c.notes ?? '')}</small></th><td><img src="${rel(c.person)}" alt=""><div>avatar input</div></td><td><img src="${rel(c.garment)}" alt=""><div>garment input</div></td>${outs}</tr>`;
    })
    .join('\n');
  const fields = Object.entries(REVIEW_FIELDS).map(([k, v]) => `<li><code>${k}</code>: ${esc(v)}</li>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>Avatar try-on review</title>
<style>body{font:14px system-ui;margin:16px}td,th{vertical-align:top;padding:6px;border-bottom:1px solid #ddd;text-align:left}img{width:200px;height:267px;object-fit:contain;background:#f4f4f4;display:block}.bad{color:#b91c1c}.none{width:200px;height:267px;background:#fee2e2}small{color:#555}</style>
<h1>Avatar try-on review</h1><p>Score every output in <code>avatar-scoring.csv</code>. Failed generations stay in the denominator.</p><ul>${fields}</ul>
<table><tr><th>Case</th><th>Avatar</th><th>Garment</th><th colspan="4">Outputs</th></tr>${body}</table>`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [runArg, manifestArg] = process.argv.slice(2);
  if (!runArg || !manifestArg) {
    console.error('Usage: pnpm --filter @fitvision/vton-eval avatar-sheet <runs/RUN_DIR> <data/avatar/STYLE/manifest.json>');
    process.exit(1);
  }
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const runDir = path.resolve(cwd, runArg);
  const manifestPath = path.resolve(cwd, manifestArg);
  const cases = (JSON.parse(readFileSync(manifestPath, 'utf8')) as { cases: ManifestCase[] }).cases;
  const records = JSON.parse(readFileSync(path.join(runDir, 'results.json'), 'utf8')) as RunRecord[];
  const token = process.env.REPLICATE_API_TOKEN;
  const pricePerSecond = process.env.REPLICATE_PRICE_PER_SECOND ? Number(process.env.REPLICATE_PRICE_PER_SECOND) : undefined;
  const rows: ScoringRow[] = [];
  for (const r of records) {
    const c = cases.find((x) => x.id === r.caseId);
    if (!c) throw new Error(`Case ${r.caseId} is not in ${manifestArg} — pass the manifest this run used.`);
    const person = readFileSync(path.join(path.dirname(manifestPath), c.person));
    const outputFile = r.output ? path.join(runDir, r.output) : null;
    const output = outputFile && existsSync(outputFile) ? readFileSync(outputFile) : null;
    const shares = output ? await changedShares(person, output) : { all: '', upper: '', lower: '' };
    const billing =
      r.provider === 'replicate' && r.providerJobId && token ? await fetchPredictionBilling(r.providerJobId, { token, pricePerSecond }) : null;
    rows.push({
      case: r.caseId,
      style: c.style,
      provider: `${r.provider} (${r.modelVersion})`,
      source: r.source,
      body: c.bodyId,
      garment: c.garmentId,
      region: c.region,
      generation_failure: r.status === 'ready' ? 'no' : 'yes',
      error: r.status === 'ready' ? '' : `${r.status}${r.errorCode ? `: ${r.errorCode}` : ''}`,
      latency_s: (r.latencyMs / 1000).toFixed(1),
      model_version: billing?.version ?? r.modelVersion,
      predict_time_s: billing?.predictTimeS == null ? '' : billing.predictTimeS.toFixed(1),
      actual_cost_usd: r.source === 'mock' ? '0' : billing?.costUsd == null ? '' : String(billing.costUsd),
      est_cost_usd: r.estimatedCostUsd === null ? '' : String(r.estimatedCostUsd),
      auto_unchanged: output ? ((await looksUnchanged(output, person)) ? 'yes' : 'no') : '',
      auto_changed_pct: shares.all,
      auto_changed_upper_pct: shares.upper,
      auto_changed_lower_pct: shares.lower,
      output: r.output ?? '',
      ...(Object.fromEntries(Object.keys(REVIEW_FIELDS).map((k) => [k, ''])) as Record<keyof typeof REVIEW_FIELDS, string>),
    });
  }
  const file = path.join(runDir, 'avatar-scoring.csv');
  writeFileSync(file, toCsv(rows as unknown as Record<string, string>[]));
  writeFileSync(path.join(runDir, 'avatar-contact-sheet.html'), contactSheet(rows, cases, runDir, path.dirname(manifestPath)));
  console.log(`Wrote ${path.relative(cwd, file)} and avatar-contact-sheet.html (${rows.length} rows). Review fields:`);
  for (const [k, v] of Object.entries(REVIEW_FIELDS)) console.log(`  ${k.padEnd(18)} ${v}`);
}
