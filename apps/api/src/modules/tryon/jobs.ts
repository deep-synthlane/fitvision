import { and, eq, inArray, lt } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import sharp from 'sharp';
import { CATEGORY_REGION, TRY_ON_ERROR_MESSAGES, type ProductCategory, type TryOnErrorCode } from '@fitvision/shared';
import type { Db } from '../../db/client.js';
import { productImages, products, tryOnPhotos, tryOnResults, type TryOnResultRow } from '../../db/schema.js';
import type { FetchPolicy } from '../../net/policy.js';
import { safeFetch } from '../../net/safeFetch.js';
import type { Storage } from '../../storage/index.js';
import { TryOnProviderError, type ProviderJobState, type VirtualTryOnProvider } from '../../tryon/provider.js';
import type { Analytics } from '../../observability/analytics.js';
import type { Metrics } from '../../observability/metrics.js';

export interface TryOnJobOptions {
  timeoutMs: number;
  pollMs: number;
  /** Attempts for transient provider errors when submitting (rate limit, unavailable, timeout). */
  maxAttempts?: number;
  retryBaseMs?: number;
  /** For downloading provider result URLs (SSRF-safe). */
  fetchPolicy: FetchPolicy;
  metrics?: Metrics;
  analytics?: Analytics;
  /** False in an API process when a separate worker runs jobs. */
  runsJobs?: boolean;
}

const MAX_RESULT_BYTES = 25 * 1024 * 1024;

const PROVIDER_ERROR_TO_CODE: Record<TryOnProviderError['code'], TryOnErrorCode> = {
  timeout: 'provider_timeout',
  moderation: 'provider_moderation',
  rate_limited: 'provider_rate_limited',
  unavailable: 'provider_unavailable',
  invalid_input: 'generation_failed',
  failed: 'generation_failed',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs try-on generations in the background (pending → processing → ready/failed/cancelled).
 * Providers are polled server-side, so the browser only polls our API and users can leave and
 * come back. Webhooks can later replace polling by calling `complete()`-style updates.
 */
export class TryOnJobs {
  private readonly running = new Set<Promise<void>>();
  private readonly queued = new Set<string>();
  private stopping = false;

  constructor(
    private readonly db: Db,
    private readonly storage: Storage,
    private readonly provider: VirtualTryOnProvider,
    private readonly opts: TryOnJobOptions,
    private readonly log: FastifyBaseLogger,
  ) {}

  enqueue(id: string, resume = false) {
    if (this.stopping || this.opts.runsJobs === false || this.queued.has(id)) return;
    this.queued.add(id);
    const job: Promise<void> = new Promise<void>((r) => setImmediate(r))
      .then(() => (resume ? this.resume(id) : this.run(id)))
      .catch((err: unknown) => this.log.error({ err, tryOnId: id }, 'Try-on job crashed'))
      .finally(() => {
        this.running.delete(job);
        this.queued.delete(id);
      });
    this.running.add(job);
  }

  /** Worker: pick up queued jobs. Claiming is an atomic UPDATE, so duplicate delivery is harmless. */
  async pollPending(limit = 10) {
    const rows = await this.db.select({ id: tryOnResults.id }).from(tryOnResults).where(eq(tryOnResults.status, 'pending')).orderBy(tryOnResults.createdAt).limit(limit);
    rows.forEach((r) => this.enqueue(r.id));
    return rows.length;
  }

  private finished(row: Pick<TryOnResultRow, 'id' | 'userId' | 'startedAt' | 'provider' | 'source'>, outcome: string) {
    this.opts.metrics?.tryOnJobs.inc({ provider: row.provider, source: row.source, outcome });
    if (row.startedAt) this.opts.metrics?.tryOnProviderLatency.observe({ provider: row.provider, outcome: outcome === 'ready' ? 'ready' : 'other' }, (Date.now() - row.startedAt.getTime()) / 1000);
    this.log.info({ tryOnId: row.id, provider: row.provider, outcome }, 'Try-on finished');
    if (outcome === 'ready') this.opts.analytics?.track('try_on_completed', row.userId, { provider_source: row.source });
  }

  async drain() {
    while (this.running.size > 0) await Promise.all([...this.running]);
  }

  /** Stops polling loops promptly (shutdown); unfinished jobs are resumed on next start. */
  async stop() {
    this.stopping = true;
    await this.drain();
  }

  /** Resume jobs after a restart: poll ones the provider already has, restart ones never submitted. */
  async recover() {
    const rows = await this.db.select().from(tryOnResults).where(inArray(tryOnResults.status, ['pending', 'processing']));
    for (const row of rows) {
      if (row.status === 'pending') this.enqueue(row.id);
      else if (row.providerJobId) this.enqueue(row.id, true);
      else await this.fail(row, 'interrupted', 'server restarted before the job was submitted');
    }
  }

  /** Retention: failed/cancelled attempts are kept for a few days for support, then removed. */
  async purgeOld(days: number) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const old = await this.db
      .delete(tryOnResults)
      .where(and(inArray(tryOnResults.status, ['failed', 'cancelled']), lt(tryOnResults.createdAt, cutoff)))
      .returning();
    await Promise.all(old.filter((r) => r.resultImagePath).map((r) => this.storage.delete(r.resultImagePath!)));
    return old.length;
  }

  private async fail(row: Pick<TryOnResultRow, 'id'> & Partial<TryOnResultRow>, code: TryOnErrorCode, diagnostic: string) {
    // Diagnostics (raw provider messages) are logged and kept server-side, never shown to users.
    this.log.warn({ tryOnId: row.id, code, diagnostic }, 'Try-on failed');
    if (row.userId && row.provider && row.source) this.finished(row as TryOnResultRow, code);
    await this.db
      .update(tryOnResults)
      .set({ status: 'failed', errorCode: code, errorMessage: TRY_ON_ERROR_MESSAGES[code], diagnostic: diagnostic.slice(0, 1000), completedAt: new Date() })
      .where(and(eq(tryOnResults.id, row.id), inArray(tryOnResults.status, ['pending', 'processing'])));
  }

  private async run(id: string) {
    const [row] = await this.db
      .update(tryOnResults)
      .set({ status: 'processing', startedAt: new Date() })
      .where(and(eq(tryOnResults.id, id), eq(tryOnResults.status, 'pending')))
      .returning();
    if (!row) return;
    const deadline = row.startedAt!.getTime() + this.opts.timeoutMs;

    const [photo] = await this.db.select().from(tryOnPhotos).where(eq(tryOnPhotos.id, row.personPhotoId)).limit(1);
    const [garment] = row.productImageId
      ? await this.db.select().from(productImages).where(eq(productImages.id, row.productImageId)).limit(1)
      : [];
    const [product] = await this.db.select().from(products).where(eq(products.id, row.productId)).limit(1);
    const personData = photo && !photo.deletedAt ? await this.storage.get(photo.imagePath) : null;
    const garmentData = garment ? await this.storage.get(garment.imagePath) : null;
    if (!personData) return this.fail(row, 'unsuitable_person_photo', 'person photo missing or deleted');
    if (!garmentData || !product) return this.fail(row, 'unsuitable_garment_image', 'garment image missing');

    const request = {
      personImage: { data: personData, mime: 'image/webp' },
      garmentImage: { data: garmentData, mime: 'image/webp' },
      region: CATEGORY_REGION[product.category as ProductCategory],
      garmentDescription: [product.color, product.subcategory ?? product.category, product.name].filter(Boolean).join(' '),
    };

    const maxAttempts = this.opts.maxAttempts ?? 3;
    const retryBase = this.opts.retryBaseMs ?? 1000;
    let state: ProviderJobState | null = null;
    for (let attempt = 1; ; attempt++) {
      await this.db.update(tryOnResults).set({ attempts: attempt }).where(eq(tryOnResults.id, id));
      const remaining = deadline - Date.now();
      try {
        state = await this.provider.createTryOn(request, AbortSignal.timeout(Math.max(1, remaining)));
        break;
      } catch (err) {
        const e = err instanceof TryOnProviderError ? err : new TryOnProviderError('failed', (err as Error).message, false);
        this.opts.metrics?.tryOnProviderErrors.inc({ provider: row.provider, code: e.code, stage: 'submit' });
        const wait = retryBase * 2 ** (attempt - 1);
        if (e.retryable && attempt < maxAttempts && Date.now() + wait < deadline && !this.stopping) {
          this.log.info({ tryOnId: id, attempt, code: e.code }, 'Retrying try-on submission');
          await sleep(wait);
          continue;
        }
        return this.fail(row, Date.now() >= deadline ? 'provider_timeout' : PROVIDER_ERROR_TO_CODE[e.code], e.detail);
      }
    }
    await this.follow(row, state, deadline);
  }

  private async resume(id: string) {
    const [row] = await this.db.select().from(tryOnResults).where(eq(tryOnResults.id, id)).limit(1);
    if (!row || row.status !== 'processing' || !row.providerJobId) return;
    const deadline = (row.startedAt ?? row.createdAt).getTime() + this.opts.timeoutMs;
    await this.follow(row, { state: 'processing', providerJobId: row.providerJobId }, deadline);
  }

  private async follow(row: TryOnResultRow, initial: ProviderJobState, deadline: number) {
    let state = initial;
    if (state.providerJobId) await this.db.update(tryOnResults).set({ providerJobId: state.providerJobId }).where(eq(tryOnResults.id, row.id));
    let transientFailures = 0;
    while (state.state === 'processing') {
      if (this.stopping) return; // resumed on next start
      const [current] = await this.db.select({ status: tryOnResults.status }).from(tryOnResults).where(eq(tryOnResults.id, row.id)).limit(1);
      if (!current || current.status !== 'processing') return; // cancelled or deleted meanwhile
      if (Date.now() >= deadline) {
        await this.provider.cancel?.(state.providerJobId).catch(() => {});
        return this.fail(row, 'provider_timeout', `no result within ${this.opts.timeoutMs} ms`);
      }
      await sleep(Math.min(this.opts.pollMs, Math.max(0, deadline - Date.now())));
      try {
        state = await this.provider.getStatus(state.providerJobId, AbortSignal.timeout(Math.max(1, deadline - Date.now())));
        transientFailures = 0;
      } catch (err) {
        const e = err instanceof TryOnProviderError ? err : new TryOnProviderError('unavailable', (err as Error).message);
        this.opts.metrics?.tryOnProviderErrors.inc({ provider: row.provider, code: e.code, stage: 'poll' });
        if (e.retryable && ++transientFailures < 3) continue;
        return this.fail(row, PROVIDER_ERROR_TO_CODE[e.code], e.detail);
      }
    }

    if (state.state === 'failed') return this.fail(row, PROVIDER_ERROR_TO_CODE[state.error.code], state.error.detail);
    if (state.state === 'cancelled') {
      await this.db
        .update(tryOnResults)
        .set({ status: 'cancelled', completedAt: new Date() })
        .where(and(eq(tryOnResults.id, row.id), eq(tryOnResults.status, 'processing')));
      this.finished(row, 'cancelled');
      return;
    }

    // Ready: copy the image into our private storage (never keep only a provider URL).
    let image: Buffer;
    try {
      const raw =
        'data' in state.image
          ? state.image.data
          : (await safeFetch(state.image.url, { policy: this.opts.fetchPolicy, accept: ['image/'], maxBytes: MAX_RESULT_BYTES, timeoutMs: 30_000 })).body;
      image = await sharp(raw, { limitInputPixels: 40_000_000 }).rotate().webp({ quality: 90 }).toBuffer();
    } catch (err) {
      return this.fail(row, 'generation_failed', `result image unusable: ${(err as Error).message}`);
    }
    // A provider must return a generated image, never the person input passed back unchanged.
    const [photo] = await this.db.select({ imagePath: tryOnPhotos.imagePath }).from(tryOnPhotos).where(eq(tryOnPhotos.id, row.personPhotoId)).limit(1);
    const input = photo ? await this.storage.get(photo.imagePath) : null;
    if (input && (await looksUnchanged(image, input))) return this.fail(row, 'generation_failed', 'provider returned the person image unchanged');
    const key = `tryons/${row.userId}/${row.id}.webp`;
    await this.storage.put(key, image);
    const [done] = await this.db
      .update(tryOnResults)
      .set({ status: 'ready', resultImagePath: key, completedAt: new Date(), errorCode: null, errorMessage: null })
      .where(and(eq(tryOnResults.id, row.id), eq(tryOnResults.status, 'processing')))
      .returning();
    if (!done) await this.storage.delete(key); // deleted or cancelled while finishing
    else this.finished(done, 'ready');
  }
}

/** True when two images are visually the same (64×64 greyscale, mean absolute difference under 1.5 levels). */
export async function looksUnchanged(a: Buffer, b: Buffer): Promise<boolean> {
  const tiny = (img: Buffer) => sharp(img, { limitInputPixels: 40_000_000 }).greyscale().resize(64, 64, { fit: 'fill' }).raw().toBuffer();
  const [x, y] = await Promise.all([tiny(a), tiny(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff += Math.abs(x[i]! - y[i]!);
  return diff / x.length < 1.5;
}
