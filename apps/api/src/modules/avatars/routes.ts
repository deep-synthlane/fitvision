import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Avatar, AvatarResponse } from '@fitvision/shared';
import type { Db } from '../../db/client.js';
import { avatars, tryOnPhotos, type AvatarRow } from '../../db/schema.js';
import { deleteAvatarRenders } from '../tryon/routes.js';
import { AppError } from '../../lib/errors.js';
import type { SessionTools } from '../../plugins/auth.js';
import type { Storage } from '../../storage/index.js';
import type { AvatarGenerator } from '../../avatar/generator.js';
import { AvatarJobs } from './jobs.js';
import { loadSnapshot, sameInputs } from './snapshot.js';

const idParams = z.object({ id: z.uuid() });

function toAvatar(row: AvatarRow): Avatar {
  const ready = row.status === 'ready';
  return {
    id: row.id,
    status: row.status as Avatar['status'],
    avatarType: row.avatarType,
    modelVersion: row.modelVersion,
    measurementId: row.measurementId,
    bodyScanId: row.bodyScanId,
    parameters: row.bodyParametersJson ?? null,
    error: row.error,
    assetUrl: ready && row.assetPath ? `/api/avatars/${row.id}/asset` : null,
    previewUrl: ready && row.previewImagePath ? `/api/avatars/${row.id}/preview` : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function avatarRoutes(db: Db, storage: Storage, generator: AvatarGenerator, jobs: AvatarJobs, session: SessionTools) {
  const latest = async (userId: string) => {
    const [row] = await db.select().from(avatars).where(eq(avatars.userId, userId)).orderBy(desc(avatars.createdAt)).limit(1);
    return row ?? null;
  };

  async function findOwn(userId: string, rawParams: unknown) {
    const params = idParams.safeParse(rawParams);
    const [row] = params.success
      ? await db
          .select()
          .from(avatars)
          .where(and(eq(avatars.id, params.data.id), eq(avatars.userId, userId)))
          .limit(1)
      : [];
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Avatar not found');
    return row;
  }

  return async (app: FastifyInstance) => {
    app.addHook('preHandler', session.requireAuth);

    app.get('/current', async (req): Promise<AvatarResponse> => {
      const userId = req.userId!;
      const [row, snapshot] = await Promise.all([latest(userId), loadSnapshot(db, userId)]);
      const used = row?.bodyParametersJson?.inputs;
      return {
        avatar: row ? toAvatar(row) : null,
        outdated: Boolean(row?.status === 'ready' && used && snapshot && !sameInputs(used, snapshot.inputs)),
        canGenerate: snapshot !== null,
      };
    });

    /** Starts generation from the latest confirmed measurements (or returns the job in progress). */
    app.post('/', async (req, reply): Promise<{ avatar: Avatar }> => {
      const userId = req.userId!;
      const inProgress = async () => {
        const [row] = await db
          .select()
          .from(avatars)
          .where(and(eq(avatars.userId, userId), inArray(avatars.status, ['pending', 'processing'])))
          .limit(1);
        return row;
      };
      reply.status(202);
      const existing = await inProgress();
      if (existing) return { avatar: toAvatar(existing) };
      const snapshot = await loadSnapshot(db, userId);
      if (!snapshot) {
        throw new AppError(409, 'NO_MEASUREMENTS', 'Save your measurements or complete a body scan before creating an avatar');
      }
      const [row] = await db
        .insert(avatars)
        .values({
          userId,
          bodyScanId: snapshot.measurement.scanId,
          measurementId: snapshot.measurement.id,
          modelVersion: generator.modelVersion,
          avatarType: generator.avatarType,
          status: 'pending',
        })
        // The partial unique index rejects a second active job from a concurrent request.
        .onConflictDoNothing()
        .returning();
      if (!row) return { avatar: toAvatar((await inProgress())!) };
      jobs.enqueue(row.id);
      return { avatar: toAvatar(row) };
    });

    const sendFile = (kind: 'asset' | 'preview') => async (req: FastifyRequest, reply: FastifyReply) => {
      const row = await findOwn(req.userId!, req.params);
      const key = kind === 'asset' ? row.assetPath : row.previewImagePath;
      const data = row.status === 'ready' && key ? await storage.get(key) : null;
      if (!data) throw new AppError(404, 'NOT_FOUND', 'Avatar file not found');
      reply
        .header('cache-control', 'private, no-store')
        .header('x-content-type-options', 'nosniff')
        .header('content-type', kind === 'asset' ? 'model/gltf-binary' : 'image/svg+xml');
      // The preview is our own SVG, but sandbox it anyway in case it is ever opened directly.
      if (kind === 'preview') reply.header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      return reply.send(data);
    };
    app.get('/:id/asset', sendFile('asset'));
    app.get('/:id/preview', sendFile('preview'));

    app.delete('/:id', async (req, reply) => {
      const row = await findOwn(req.userId!, req.params);
      await deleteAvatarRenders(db, storage, eq(tryOnPhotos.avatarId, row.id));
      await db.delete(avatars).where(eq(avatars.id, row.id));
      await AvatarJobs.deleteFiles(storage, row);
      return reply.status(204).send();
    });
  };
}
