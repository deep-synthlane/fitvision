import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, count, desc, eq, gte, inArray, isNull, ne, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  ACTIVE_TRY_ON_STATUSES,
  AVATAR_TRY_ON_MISSING,
  CATEGORY_REGION,
  FRAMING_FOR_REGION,
  PHOTO_ORIGINS,
  GARMENT_REGION_LABELS,
  MAX_TRY_ON_PHOTO_BYTES,
  TRY_ON_ERROR_MESSAGES,
  avatarRenderRequestSchema,
  createTryOnSchema,
  tryOnSuitabilitySchema,
  type AvatarRenderFraming,
  type PersonSource,
  type PhotoOrigin,
  type ProductCategory,
  type SavedLookListResponse,
  type TryOnListResponse,
  type TryOnPhoto,
  type TryOnPhotoListResponse,
  type TryOnPhotoResponse,
  type TryOnProviderInfo,
  type TryOnResponse,
  type TryOnResult,
} from '@fitvision/shared';
import type { Db } from '../../db/client.js';
import { avatars, productImages, products, savedLooks, tryOnPhotos, tryOnResults, type TryOnPhotoRow, type TryOnResultRow } from '../../db/schema.js';
import { AVATAR_RENDERER_VERSION, renderAvatarFront } from '../../avatar/render.js';
import { AppError, parseInput } from '../../lib/errors.js';
import type { SessionTools } from '../../plugins/auth.js';
import type { Storage } from '../../storage/index.js';
import { PersonPhotoError, preparePersonPhoto } from '../../tryon/personPhoto.js';
import type { VirtualTryOnProvider } from '../../tryon/provider.js';
import type { TryOnJobs } from './jobs.js';

export interface TryOnDeps {
  db: Db;
  storage: Storage;
  provider: VirtualTryOnProvider;
  /** Overrides the provider's own flag: set only once a real provider has been verified. */
  verified?: boolean;
  /** Avatar try-on verified with this provider (default false). */
  avatarVerified?: boolean;
  jobs: TryOnJobs;
  session: SessionTools;
  limits: { dailyLimit: number; maxActive: number };
}

const idParams = z.object({ id: z.uuid() });
const MIN_GARMENT_EDGE = 256;
/** Image types that rarely work as try-on garment input. */
const UNSUITABLE_GARMENT_TYPES = new Set(['detail', 'lifestyle']);

const DISCLOSURE = (name: string) =>
  `Your photo (or avatar image) and the garment image will be sent to a third-party AI service (${name}) to generate the preview. The result is stored privately in your FitVision account.`;

const startOfUtcDay = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

const photoUrl = (id: string, size: 'full' | 'thumb' = 'full') => `/api/try-on-photos/${id}/image${size === 'thumb' ? '?size=thumb' : ''}`;

function toPhoto(row: TryOnPhotoRow): TryOnPhoto {
  return {
    id: row.id,
    source: row.source as PhotoOrigin,
    avatarId: row.avatarId,
    avatarModelVersion: row.avatarModelVersion,
    imageUrl: photoUrl(row.id),
    thumbnailUrl: photoUrl(row.id, 'thumb'),
    suitability: row.suitabilityJson,
    createdAt: row.createdAt.toISOString(),
  };
}

/** What an avatar render shows: the whole body, or head to mid-thigh (enough for tops). */
const RENDER_REGIONS: Record<AvatarRenderFraming, TryOnPhoto['suitability']['regions']> = {
  upper_body: { upper_body: true, lower_body: false, full_body: false },
  full_body: { upper_body: true, lower_body: true, full_body: true },
};

/**
 * Removes avatar renders (files now, rows marked deleted so past results stay listed). Call it
 * before deleting the avatar rows, while the renders still point at them.
 */
export async function deleteAvatarRenders(db: Db, storage: Storage, where: SQL) {
  const rows = await db
    .update(tryOnPhotos)
    .set({ deletedAt: new Date() })
    .where(and(eq(tryOnPhotos.source, 'avatar_render'), isNull(tryOnPhotos.deletedAt), where))
    .returning();
  await Promise.all(rows.flatMap((r) => [storage.delete(r.imagePath), storage.delete(r.thumbnailPath)]));
}

const tryOnError = (status: number, code: keyof typeof TRY_ON_ERROR_MESSAGES, reason?: string) =>
  new AppError(status, code.toUpperCase(), TRY_ON_ERROR_MESSAGES[code], reason ? { reason } : undefined);

export function tryOnRoutes(deps: TryOnDeps) {
  const { db, storage, provider, jobs, session } = deps;
  const meta = provider.metadata;

  /** Adds product name, garment/person image URLs and saved-look ids to result rows. */
  async function hydrate(rows: TryOnResultRow[]): Promise<TryOnResult[]> {
    if (rows.length === 0) return [];
    const productIds = [...new Set(rows.map((r) => r.productId))];
    const photoIds = [...new Set(rows.map((r) => r.personPhotoId))];
    const [prods, photos, looks] = await Promise.all([
      db.select({ id: products.id, name: products.name }).from(products).where(inArray(products.id, productIds)),
      db.select({ id: tryOnPhotos.id, deletedAt: tryOnPhotos.deletedAt }).from(tryOnPhotos).where(inArray(tryOnPhotos.id, photoIds)),
      db.select({ id: savedLooks.id, resultId: savedLooks.tryOnResultId }).from(savedLooks).where(inArray(savedLooks.tryOnResultId, rows.map((r) => r.id))),
    ]);
    return rows.map((r) => ({
      id: r.id,
      productId: r.productId,
      productImageId: r.productImageId ?? '',
      personPhotoId: r.personPhotoId,
      personSource: r.personSource as PersonSource,
      avatarId: r.avatarId,
      avatarModelVersion: r.avatarModelVersion,
      status: r.status as TryOnResult['status'],
      source: r.source as TryOnResult['source'],
      provider: r.provider,
      modelVersion: r.modelVersion,
      providerJobId: r.providerJobId,
      errorCode: r.errorCode as TryOnResult['errorCode'],
      errorMessage: r.errorMessage,
      resultImageUrl: r.status === 'ready' && r.resultImagePath ? `/api/try-ons/${r.id}/image` : null,
      personPhotoUrl: photos.find((p) => p.id === r.personPhotoId && !p.deletedAt) ? photoUrl(r.personPhotoId) : null,
      garmentImageUrl: r.productImageId ? `/api/products/${r.productId}/images/${r.productImageId}` : '',
      productName: prods.find((p) => p.id === r.productId)?.name ?? '',
      savedLookId: looks.find((l) => l.resultId === r.id)?.id ?? null,
      createdAt: r.createdAt.toISOString(),
      startedAt: r.startedAt?.toISOString() ?? null,
      completedAt: r.completedAt?.toISOString() ?? null,
    }));
  }

  async function ownResult(userId: string, raw: unknown) {
    const p = idParams.safeParse(raw);
    const [row] = p.success
      ? await db.select().from(tryOnResults).where(and(eq(tryOnResults.id, p.data.id), eq(tryOnResults.userId, userId))).limit(1)
      : [];
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Try-on not found');
    return row;
  }

  async function ownPhoto(userId: string, raw: unknown) {
    const p = idParams.safeParse(raw);
    const [row] = p.success
      ? await db
          .select()
          .from(tryOnPhotos)
          .where(and(eq(tryOnPhotos.id, p.data.id), eq(tryOnPhotos.userId, userId), isNull(tryOnPhotos.deletedAt)))
          .limit(1)
      : [];
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Photo not found');
    return row;
  }

  const usedToday = async (userId: string) =>
    (await db.select({ n: count() }).from(tryOnResults).where(and(eq(tryOnResults.userId, userId), gte(tryOnResults.createdAt, startOfUtcDay()))))[0]!.n;

  const sendImage = (reply: FastifyReply, data: Buffer) =>
    reply.header('content-type', 'image/webp').header('cache-control', 'private, no-store').header('x-content-type-options', 'nosniff').send(data);

  /* ---------------- Try-on photos ---------------- */
  const photoRoutes = async (app: FastifyInstance) => {
    app.addHook('preHandler', session.requireAuth);

    app.post('/', async (req, reply): Promise<{ photo: TryOnPhoto }> => {
      if (!req.isMultipart()) throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Expected multipart/form-data');
      let file: Buffer | null = null;
      let json: unknown;
      let origin: PhotoOrigin = 'uploaded_photo';
      for await (const part of req.parts({ limits: { fileSize: MAX_TRY_ON_PHOTO_BYTES, files: 1, fields: 2, fieldSize: 32 * 1024 } })) {
        if (part.type === 'file' && part.fieldname === 'photo') file = await part.toBuffer();
        else if (part.type === 'field' && part.fieldname === 'origin') {
          // Avatar renders are only ever created by the server.
          if (part.value !== 'uploaded_photo' && part.value !== 'camera_photo') throw new AppError(400, 'BAD_UPLOAD', 'origin must be uploaded_photo or camera_photo');
          origin = part.value;
        }
        else if (part.type === 'field' && part.fieldname === 'suitability' && typeof part.value === 'string') {
          try {
            json = JSON.parse(part.value);
          } catch {
            throw new AppError(400, 'BAD_UPLOAD', 'suitability must be JSON');
          }
        } else throw new AppError(400, 'BAD_UPLOAD', 'Unexpected field');
      }
      if (!file) throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', { photo: 'Photo required' });
      const suitability = parseInput(tryOnSuitabilitySchema, json);
      let prepared;
      try {
        prepared = await preparePersonPhoto(file);
      } catch (err) {
        if (err instanceof PersonPhotoError) throw new AppError(400, 'BAD_IMAGE', err.message, { photo: err.message });
        throw err;
      }
      const userId = req.userId!;
      const id = crypto.randomUUID();
      const keys = { imagePath: `tryon-photos/${userId}/${id}.webp`, thumbnailPath: `tryon-photos/${userId}/${id}-thumb.webp` };
      await storage.put(keys.imagePath, prepared.image);
      await storage.put(keys.thumbnailPath, prepared.thumbnail);
      const server = { width: prepared.width, height: prepared.height, sharpness: prepared.sharpness, sharpOk: prepared.sharpOk };
      const issues = [...suitability.issues];
      if (!prepared.sharpOk && !issues.some((i) => /blur/i.test(i))) issues.push('The photo looks blurry.');
      const [row] = await db
        .insert(tryOnPhotos)
        .values({ id, userId, ...keys, source: origin, suitabilityJson: { ...suitability, sharpOk: suitability.sharpOk && prepared.sharpOk, issues, server } })
        .returning();
      reply.status(201);
      return { photo: toPhoto(row!) };
    });

    /**
     * Front render of the user's current avatar, framed for this product's garment type, stored as
     * a try-on photo (source `avatar_render`). Reused while the avatar and framing are unchanged.
     */
    app.post('/avatar-render', async (req, reply): Promise<TryOnPhotoResponse> => {
      const userId = req.userId!;
      const { productId } = parseInput(avatarRenderRequestSchema, req.body);
      const [product] = await db.select({ category: products.category }).from(products).where(and(eq(products.id, productId), eq(products.userId, userId))).limit(1);
      if (!product) throw new AppError(404, 'NOT_FOUND', 'Product not found');
      const region = CATEGORY_REGION[product.category as ProductCategory];
      if (!region) throw tryOnError(422, 'unsupported_garment');
      const framing = FRAMING_FOR_REGION[region];

      const [avatar] = await db.select().from(avatars).where(eq(avatars.userId, userId)).orderBy(desc(avatars.createdAt)).limit(1);
      if (avatar && (avatar.status === 'pending' || avatar.status === 'processing')) {
        throw new AppError(409, 'AVATAR_NOT_READY', 'Your avatar is still being generated. Try again in a moment.');
      }
      if (!avatar || avatar.status !== 'ready' || !avatar.assetPath) throw new AppError(409, 'AVATAR_REQUIRED', AVATAR_TRY_ON_MISSING);

      const [existing] = await db
        .select()
        .from(tryOnPhotos)
        .where(and(eq(tryOnPhotos.userId, userId), eq(tryOnPhotos.avatarId, avatar.id), eq(tryOnPhotos.framing, framing), isNull(tryOnPhotos.deletedAt)))
        .limit(1);
      if (existing) return { photo: toPhoto(existing) };

      const glb = await storage.get(avatar.assetPath);
      if (!glb) throw new AppError(409, 'AVATAR_REQUIRED', AVATAR_TRY_ON_MISSING);
      const prepared = await preparePersonPhoto(await renderAvatarFront(glb, framing));
      const id = crypto.randomUUID();
      const keys = { imagePath: `tryon-photos/${userId}/${id}.webp`, thumbnailPath: `tryon-photos/${userId}/${id}-thumb.webp` };
      await storage.put(keys.imagePath, prepared.image);
      await storage.put(keys.thumbnailPath, prepared.thumbnail);
      const [row] = await db
        .insert(tryOnPhotos)
        .values({
          id,
          userId,
          ...keys,
          source: 'avatar_render',
          avatarId: avatar.id,
          avatarModelVersion: avatar.modelVersion,
          framing,
          // Known by construction: one figure, facing the camera, a clean render. The blur check is for camera photos.
          suitabilityJson: {
            checkedBy: AVATAR_RENDERER_VERSION,
            onePerson: true,
            facingCamera: true,
            personHeightFraction: framing === 'full_body' ? 0.92 : 1,
            regions: RENDER_REGIONS[framing],
            lightingOk: true,
            sharpOk: true,
            issues: [],
            server: { width: prepared.width, height: prepared.height, sharpness: prepared.sharpness, sharpOk: true },
          },
        })
        .returning();
      reply.status(201);
      return { photo: toPhoto(row!) };
    });

    app.get('/', async (req): Promise<TryOnPhotoListResponse> => {
      const rows = await db
        .select()
        .from(tryOnPhotos)
        .where(and(eq(tryOnPhotos.userId, req.userId!), isNull(tryOnPhotos.deletedAt), ne(tryOnPhotos.source, 'avatar_render')))
        .orderBy(desc(tryOnPhotos.createdAt))
        .limit(20);
      return { photos: rows.map(toPhoto) };
    });

    app.get('/:id/image', async (req, reply) => {
      const photo = await ownPhoto(req.userId!, req.params);
      const thumb = (req.query as { size?: string }).size === 'thumb';
      const data = await storage.get(thumb ? photo.thumbnailPath : photo.imagePath);
      if (!data) throw new AppError(404, 'NOT_FOUND', 'Photo not found');
      return sendImage(reply, data);
    });

    /** Removes the photo files immediately; the row is kept (deleted_at) so past results stay listed. */
    app.delete('/:id', async (req, reply) => {
      const photo = await ownPhoto(req.userId!, req.params);
      await db.update(tryOnPhotos).set({ deletedAt: new Date() }).where(eq(tryOnPhotos.id, photo.id));
      await Promise.all([storage.delete(photo.imagePath), storage.delete(photo.thumbnailPath)]);
      return reply.status(204).send();
    });
  };

  /* ---------------- Try-ons ---------------- */
  const resultRoutes = async (app: FastifyInstance) => {
    app.addHook('preHandler', session.requireAuth);

    app.get('/provider', async (req): Promise<TryOnProviderInfo> => ({
      provider: meta.provider,
      modelVersion: meta.modelVersion,
      source: meta.source,
      external: meta.external,
      verified: deps.verified ?? meta.verified,
      avatarVerified: meta.source === 'real' && (deps.avatarVerified ?? false),
      disclosure: meta.external ? DISCLOSURE(meta.provider) : null,
      limits: { dailyLimit: deps.limits.dailyLimit, usedToday: await usedToday(req.userId!), maxActive: deps.limits.maxActive },
    }));

    app.post(
      '/',
      { config: { rateLimit: { max: 10, timeWindow: '10 minutes', keyGenerator: (req: FastifyRequest) => req.userId ?? req.ip } } },
      async (req, reply): Promise<TryOnResponse> => {
        const userId = req.userId!;
        const input = parseInput(createTryOnSchema, req.body);

        // Idempotency: the same submit (e.g. a double click or a retried request) returns the same job.
        const [same] = await db
          .select()
          .from(tryOnResults)
          .where(and(eq(tryOnResults.userId, userId), eq(tryOnResults.idempotencyKey, input.idempotencyKey)))
          .limit(1);
        if (same) {
          reply.status(200);
          return { tryOn: (await hydrate([same]))[0]! };
        }

        const [product] = await db.select().from(products).where(and(eq(products.id, input.productId), eq(products.userId, userId))).limit(1);
        if (!product) throw new AppError(404, 'NOT_FOUND', 'Product not found');
        const photo = await ownPhoto(userId, { id: input.personPhotoId });
        const region = CATEGORY_REGION[product.category as ProductCategory];
        if (!region) throw tryOnError(422, 'unsupported_garment');

        const imageId = input.productImageId ?? product.selectedImageId;
        const [garment] = imageId
          ? await db.select().from(productImages).where(and(eq(productImages.id, imageId), eq(productImages.productId, product.id))).limit(1)
          : [];
        if (!garment) throw tryOnError(422, 'unsuitable_garment_image', 'Choose one of this product’s images.');
        if (Math.min(garment.width, garment.height) < MIN_GARMENT_EDGE) {
          throw tryOnError(422, 'unsuitable_garment_image', `The image is too small (under ${MIN_GARMENT_EDGE} px). Choose a larger image.`);
        }
        if (UNSUITABLE_GARMENT_TYPES.has(garment.imageType)) {
          throw tryOnError(422, 'unsuitable_garment_image', 'Detail and lifestyle shots rarely work. Choose a front view of the garment.');
        }

        let personSource: PersonSource;
        if (photo.source === 'avatar_render') {
          if (!photo.avatarId) throw tryOnError(422, 'unsuitable_person_photo', 'That avatar was deleted. Create your avatar again.');
          personSource = 'avatar_render';
        } else {
          const [earlier] = await db
            .select({ id: tryOnResults.id })
            .from(tryOnResults)
            .where(and(eq(tryOnResults.userId, userId), eq(tryOnResults.personPhotoId, photo.id)))
            .limit(1);
          personSource = earlier ? 'saved_photo' : PHOTO_ORIGINS.includes(photo.source as PhotoOrigin) ? (photo.source as PhotoOrigin) : 'uploaded_photo';
        }

        const s = photo.suitabilityJson;
        if (!s.onePerson || !s.regions[region] || !s.sharpOk) {
          const why = personSource === 'avatar_render'
            ? 'The avatar image doesn’t show enough of the body for this garment.'
            : !s.onePerson
            ? 'The photo must show exactly one person.'
            : !s.regions[region]
              ? `The photo doesn’t show enough of your body for ${GARMENT_REGION_LABELS[region].toLowerCase()}.`
              : 'The photo is too blurry.';
          throw tryOnError(422, 'unsuitable_person_photo', why);
        }

        if (meta.external && !input.acknowledgeThirdParty) {
          throw new AppError(400, 'CONSENT_REQUIRED', 'Please confirm that your photo may be sent to the third-party AI service.', {
            acknowledgeThirdParty: 'Required',
          });
        }

        // Cost protection (server-side, not just a disabled button).
        const [{ n: active }] = (await db
          .select({ n: count() })
          .from(tryOnResults)
          .where(and(eq(tryOnResults.userId, userId), inArray(tryOnResults.status, [...ACTIVE_TRY_ON_STATUSES])))) as [{ n: number }];
        if (active >= deps.limits.maxActive) {
          throw new AppError(429, 'TOO_MANY_ACTIVE', `You can have up to ${deps.limits.maxActive} try-ons generating at once. Please wait for one to finish.`);
        }
        if ((await usedToday(userId)) >= deps.limits.dailyLimit) {
          throw new AppError(429, 'DAILY_LIMIT', `You’ve reached today’s limit of ${deps.limits.dailyLimit} try-ons. Please try again tomorrow.`);
        }

        const [row] = await db
          .insert(tryOnResults)
          .values({
            userId,
            productId: product.id,
            productImageId: garment.id,
            personPhotoId: photo.id,
            personSource,
            avatarId: personSource === 'avatar_render' ? photo.avatarId : null,
            avatarModelVersion: personSource === 'avatar_render' ? photo.avatarModelVersion : null,
            provider: meta.provider,
            modelVersion: meta.modelVersion,
            source: meta.source,
            status: 'pending',
            idempotencyKey: input.idempotencyKey,
          })
          .onConflictDoNothing()
          .returning();
        if (!row) {
          // Same photo + garment already generating (or a racing duplicate submit): return that job.
          const [existing] = await db
            .select()
            .from(tryOnResults)
            .where(
              and(
                eq(tryOnResults.userId, userId),
                eq(tryOnResults.personPhotoId, photo.id),
                eq(tryOnResults.productImageId, garment.id),
                inArray(tryOnResults.status, [...ACTIVE_TRY_ON_STATUSES]),
              ),
            )
            .limit(1);
          const [byKey] = existing
            ? [existing]
            : await db.select().from(tryOnResults).where(and(eq(tryOnResults.userId, userId), eq(tryOnResults.idempotencyKey, input.idempotencyKey))).limit(1);
          reply.status(200);
          return { tryOn: (await hydrate([byKey!]))[0]! };
        }
        jobs.enqueue(row.id);
        req.server.analytics.track('try_on_started', userId, { category: product.category, provider_source: meta.source, source: personSource });
        reply.status(202);
        return { tryOn: (await hydrate([row]))[0]! };
      },
    );

    app.get('/', async (req): Promise<TryOnListResponse> => {
      const productId = z.uuid().safeParse((req.query as { productId?: string }).productId);
      const rows = await db
        .select()
        .from(tryOnResults)
        .where(and(eq(tryOnResults.userId, req.userId!), productId.success ? eq(tryOnResults.productId, productId.data) : undefined))
        .orderBy(desc(tryOnResults.createdAt))
        .limit(50);
      return { tryOns: await hydrate(rows) };
    });

    app.get('/:id', async (req): Promise<TryOnResponse> => ({ tryOn: (await hydrate([await ownResult(req.userId!, req.params)]))[0]! }));

    app.get('/:id/image', async (req, reply) => {
      const row = await ownResult(req.userId!, req.params);
      const data = row.status === 'ready' && row.resultImagePath ? await storage.get(row.resultImagePath) : null;
      if (!data) throw new AppError(404, 'NOT_FOUND', 'Result image not found');
      return sendImage(reply, data);
    });

    app.post('/:id/cancel', async (req): Promise<TryOnResponse> => {
      const row = await ownResult(req.userId!, req.params);
      if (row.status === 'pending' || row.status === 'processing') {
        await db.update(tryOnResults).set({ status: 'cancelled', completedAt: new Date() }).where(eq(tryOnResults.id, row.id));
        if (row.providerJobId && provider.cancel) await provider.cancel(row.providerJobId).catch((err: unknown) => req.log.warn({ err, tryOnId: row.id }, 'Provider cancel failed'));
      }
      return { tryOn: (await hydrate([(await ownResult(req.userId!, req.params))]))[0]! };
    });

    app.delete('/:id', async (req, reply) => {
      const row = await ownResult(req.userId!, req.params);
      if ((row.status === 'pending' || row.status === 'processing') && row.providerJobId && provider.cancel) {
        await provider.cancel(row.providerJobId).catch(() => {});
      }
      await db.delete(tryOnResults).where(eq(tryOnResults.id, row.id));
      if (row.resultImagePath) await storage.delete(row.resultImagePath);
      return reply.status(204).send();
    });
  };

  /* ---------------- Saved looks ---------------- */
  const lookRoutes = async (app: FastifyInstance) => {
    app.addHook('preHandler', session.requireAuth);

    app.post('/', async (req, reply) => {
      const { tryOnResultId } = parseInput(z.object({ tryOnResultId: z.uuid() }), req.body);
      const result = await ownResult(req.userId!, { id: tryOnResultId });
      if (result.status !== 'ready') throw new AppError(409, 'NOT_READY', 'Only completed try-ons can be saved');
      const inserted = await db.insert(savedLooks).values({ userId: req.userId!, tryOnResultId: result.id, productId: result.productId }).onConflictDoNothing().returning();
      if (inserted.length) req.server.analytics.track('try_on_saved', req.userId!, { provider_source: result.source });
      const [look] = await db.select().from(savedLooks).where(eq(savedLooks.tryOnResultId, result.id)).limit(1);
      reply.status(201);
      return { look: { id: look!.id, productId: look!.productId, tryOnResultId: look!.tryOnResultId, createdAt: look!.createdAt.toISOString(), tryOn: (await hydrate([result]))[0]! } };
    });

    app.get('/', async (req): Promise<SavedLookListResponse> => {
      const looks = await db.select().from(savedLooks).where(eq(savedLooks.userId, req.userId!)).orderBy(desc(savedLooks.createdAt)).limit(100);
      if (looks.length === 0) return { looks: [] };
      const results = await hydrate(await db.select().from(tryOnResults).where(inArray(tryOnResults.id, looks.map((l) => l.tryOnResultId))));
      return {
        looks: looks.map((l) => ({
          id: l.id,
          productId: l.productId,
          tryOnResultId: l.tryOnResultId,
          createdAt: l.createdAt.toISOString(),
          tryOn: results.find((r) => r.id === l.tryOnResultId)!,
        })),
      };
    });

    app.delete('/:id', async (req, reply) => {
      const p = idParams.safeParse(req.params);
      const deleted = p.success
        ? await db.delete(savedLooks).where(and(eq(savedLooks.id, p.data.id), eq(savedLooks.userId, req.userId!))).returning()
        : [];
      if (deleted.length === 0) throw new AppError(404, 'NOT_FOUND', 'Saved look not found');
      return reply.status(204).send();
    });
  };

  return { photoRoutes, resultRoutes, lookRoutes };
}
