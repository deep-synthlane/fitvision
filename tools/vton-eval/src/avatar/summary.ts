/**
 * Pass/fail report for avatar try-on, comparing provider × render style across one or more runs.
 *
 *   pnpm --filter @fitvision/vton-eval avatar-summary runs/<RUN_A> [runs/<RUN_B> …]
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseCsv } from '../criteria.js';
import { evaluate, report, type ScoringRow } from './review.js';

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error('Usage: pnpm --filter @fitvision/vton-eval avatar-summary <runs/RUN_DIR> [more run dirs]');
  process.exit(1);
}
const cwd = process.env.INIT_CWD ?? process.cwd();
const rows = dirs.flatMap((d) => parseCsv(readFileSync(path.join(path.resolve(cwd, d), 'avatar-scoring.csv'), 'utf8')) as unknown as ScoringRow[]);
console.log(report(evaluate(rows)));
