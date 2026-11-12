import { readFileSync } from 'node:fs';
import path from 'node:path';
import { analyze, toMarkdown } from './analyze.js';
import { parseCsv } from './csv.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: pnpm calibration:report <path/to/worksheet.csv>');
  process.exit(1);
}
// pnpm runs scripts in the package folder; resolve paths from where the command was typed.
const resolved = path.resolve(process.env.INIT_CWD ?? process.cwd(), file);
console.log(toMarkdown(analyze(parseCsv(readFileSync(resolved, 'utf8')))));
