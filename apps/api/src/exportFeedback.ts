/**
 * Exports size feedback for offline analysis (`pnpm --filter @fitvision/api export-feedback > feedback.jsonl`).
 *
 * Pseudonymous: no user ids, emails or product ids; a per-export random salt groups rows by user
 * without being linkable to analytics or to other exports. Free-text return reasons are left out
 * unless --with-reasons is passed (they may contain personal details). Nothing here changes the
 * size engine; analysis happens in tools/sizing-eval.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { asc } from 'drizzle-orm';
import { openDb } from './db/client.js';
import { sizeFeedback } from './db/schema.js';
import { loadConfigOrExit } from './runtime.js';

const withReasons = process.argv.includes('--with-reasons');
const config = loadConfigOrExit();
const { db, close } = await openDb(config);
const salt = randomBytes(32);
const pseudonym = (id: string) => createHmac('sha256', salt).update(id).digest('hex').slice(0, 16);

try {
  const rows = await db.select().from(sizeFeedback).orderBy(asc(sizeFeedback.createdAt));
  for (const r of rows) {
    process.stdout.write(
      `${JSON.stringify({
        subject: pseudonym(r.userId),
        engineVersion: r.engineVersion,
        category: r.category,
        brand: r.brand,
        recommendedSize: r.recommendedSize,
        purchasedSize: r.purchasedSize,
        fitRating: r.fitRating,
        fitPreference: r.fitPreference,
        returned: r.returned,
        ...(withReasons ? { returnReason: r.returnReason } : {}),
        month: r.createdAt.toISOString().slice(0, 7),
      })}\n`,
    );
  }
  console.error(`Exported ${rows.length} feedback rows${withReasons ? ' (including return reasons)' : ''}.`);
} finally {
  await close();
}
