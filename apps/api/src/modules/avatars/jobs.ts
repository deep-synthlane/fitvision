import { and, eq, inArray, lt } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { AvatarGenerator } from '../../avatar/generator.js';
import type { Db } from '../../db/client.js';
import { avatars, type AvatarRow } from '../../db/schema.js';
import type { Storage } from '../../storage/index.js';
import { loadSnapshot } from './snapshot.js';
import type { Analytics } from '../../observability/analytics.js';
import type { Metrics } from '../../observability/metrics.js';

export interface JobHooks {
  metrics?: Metrics;
  analytics?: Analytics;
  /** False in an API process when a separate worker runs jobs. */
  runsJobs?: boolean;
}

/**
 * In-process avatar generation queue. Generation is fast today, but runs as a job with
 * pending → processing → ready/failed states so a slower engine or external provider can
 * replace it without changing the API or UI.
 */
export class AvatarJobs {
  private readonly running = new Set<Promise<void>>();
  private readonly queued = new Set<string>();

  constructor(
    private readonly db: Db,
    private readonly storage: Storage,
    private readonly generator: AvatarGenerator,
    private readonly log: FastifyBaseLogger,
    private readonly hooks: JobHooks = {},
  ) {}

  enqueue(avatarId: string) {
    if (this.hooks.runsJobs === false || this.queued.has(avatarId)) return;
    this.queued.add(avatarId);
    const job: Promise<void> = new Promise<void>((resolve) => setImmediate(resolve))
      .then(() => this.run(avatarId))
      .catch((err: unknown) => this.log.error({ err, avatarId }, 'Avatar job crashed'))
      .finally(() => {
        this.running.delete(job);
        this.queued.delete(avatarId);
      });
    this.running.add(job);
  }

  /** Worker: pick up queued jobs (claims are atomic, so several workers are safe). */
  async pollPending(limit = 10) {
    const rows = await this.db.select({ id: avatars.id }).from(avatars).where(eq(avatars.status, 'pending')).orderBy(avatars.createdAt).limit(limit);
    rows.forEach((r) => this.enqueue(r.id));
    return rows.length;
  }

  /** Resolves once all queued jobs have finished (tests, graceful shutdown). */
  async drain() {
    while (this.running.size > 0) await Promise.all([...this.running]);
  }

  /** Jobs don't survive a restart; mark any left in flight as failed so the user can retry. */
  async failInterrupted() {
    await this.db
      .update(avatars)
      .set({ status: 'failed', error: 'Generation was interrupted. Please try again.', updatedAt: new Date() })
      .where(inArray(avatars.status, ['pending', 'processing']));
  }

  static deleteFiles(storage: Storage, row: Pick<AvatarRow, 'assetPath' | 'previewImagePath'>) {
    return Promise.all([row.assetPath, row.previewImagePath].filter((k): k is string => Boolean(k)).map((k) => storage.delete(k)));
  }

  private async run(avatarId: string) {
    const [row] = await this.db
      .update(avatars)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(and(eq(avatars.id, avatarId), eq(avatars.status, 'pending')))
      .returning();
    if (!row) return; // deleted or already handled

    const keys = {
      assetPath: `avatars/${row.userId}/${row.id}/model.glb`,
      previewImagePath: `avatars/${row.userId}/${row.id}/preview.svg`,
    };
    try {
      const snapshot = await loadSnapshot(this.db, row.userId, row.measurementId);
      if (!snapshot) throw new Error('Measurement snapshot not found');
      const out = await this.generator.generate(snapshot.inputs);
      await this.storage.put(keys.assetPath, out.asset.data);
      await this.storage.put(keys.previewImagePath, out.preview.data);

      const [ready] = await this.db
        .update(avatars)
        .set({ status: 'ready', bodyParametersJson: out.parameters, ...keys, error: null, updatedAt: new Date() })
        .where(and(eq(avatars.id, row.id), eq(avatars.status, 'processing')))
        .returning();
      if (!ready) {
        // Deleted while generating.
        await AvatarJobs.deleteFiles(this.storage, keys);
        return;
      }
      this.log.info({ avatarId, modelVersion: row.modelVersion }, 'Avatar ready');
      this.hooks.metrics?.avatarJobs.inc({ status: 'ready' });
      this.hooks.analytics?.track('avatar_generated', row.userId, { status: 'ready' });

      // The new avatar replaces older ones (a failed attempt never removes a working avatar).
      const older = await this.db
        .delete(avatars)
        .where(and(eq(avatars.userId, row.userId), lt(avatars.createdAt, row.createdAt), inArray(avatars.status, ['ready', 'failed'])))
        .returning();
      await Promise.all(older.map((o) => AvatarJobs.deleteFiles(this.storage, o)));
    } catch (err) {
      this.log.error({ err, avatarId }, 'Avatar generation failed');
      this.hooks.metrics?.avatarJobs.inc({ status: 'failed' });
      await AvatarJobs.deleteFiles(this.storage, keys);
      await this.db
        .update(avatars)
        .set({ status: 'failed', error: 'We couldn’t generate your avatar. Please try again.', updatedAt: new Date() })
        .where(eq(avatars.id, row.id));
    }
  }
}
