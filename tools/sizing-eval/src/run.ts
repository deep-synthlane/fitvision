import { SIZE_ENGINE_VERSION } from '@fitvision/shared';
import { CASES } from './cases.js';
import { evaluateCase } from './evaluate.js';

const outcomes = CASES.map(evaluateCase);
console.log(`Size engine ${SIZE_ENGINE_VERSION} — ${outcomes.filter((o) => o.pass).length}/${outcomes.length} cases pass\n`);
for (const [i, o] of outcomes.entries()) {
  const r = o.result;
  console.log(`${o.pass ? 'PASS' : 'FAIL'}  ${o.id.padEnd(28)} → ${String(r.recommendedSize ?? '—').padEnd(4)} alt ${String(r.alternativeSize ?? '—').padEnd(4)} ${r.confidence.padEnd(6)} ${CASES[i]!.description}`);
  for (const p of o.problems) console.log(`      ${p}`);
}
process.exitCode = outcomes.every((o) => o.pass) ? 0 : 1;
