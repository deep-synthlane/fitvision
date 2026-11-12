import { readFileSync } from 'node:fs';
import { parseJsonl, summarise, MIN_GROUP_SIZE, type FeedbackGroup } from './feedback.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: pnpm --filter @fitvision/sizing-eval feedback <feedback.jsonl>');
  process.exit(1);
}
const rows = parseJsonl(readFileSync(file, 'utf8'));
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);
const print = (title: string, groups: FeedbackGroup[]) => {
  console.log(`\n${title}`);
  for (const g of groups) {
    console.log(
      `  ${g.key.padEnd(40)} n=${String(g.count).padEnd(4)} followed=${String(g.followed).padEnd(4)} just-right=${pct(g.justRightWhenFollowed).padEnd(5)} bias=${g.sizeBias === null ? '—' : g.sizeBias.toFixed(2).padStart(5)} returned=${g.returned}${g.enoughData ? '' : '  (too few rows to act on)'}`,
    );
  }
};
console.log(`${rows.length} feedback rows. Groups under ${MIN_GROUP_SIZE} rows are descriptive only.`);
console.log('bias: −1 = runs small … +1 = runs large, for buyers who took the recommended size.');
print('By category', summarise(rows, (r) => r.category));
print('By brand', summarise(rows, (r) => r.brand ?? 'no brand'));
console.log('\nThis report never changes the size engine. Any change is a new engine version, re-run against `pnpm --filter @fitvision/sizing-eval eval`.');
