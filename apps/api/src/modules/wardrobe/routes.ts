import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  collectionNameSchema,
  sizeFeedbackSchema,
  type CollectionListResponse,
  type SizeFeedback,
  type SizeFeedbackListResponse,
  type WardrobeCollection,
} from '@fitvision/shared';
import type { Db } from '../../db/client.js';
import { products, sizeFeedback, sizeRecommendations, wardrobeCollectionItems, wardrobeCollections, type SizeFeedbackRow } from '../../db/schema.js';
import { AppError, parseInput } from '../../lib/errors.js';
import type { SessionTools } from '../../plugins/auth.js';

const idParams = z.object({ id: z.uuid() });
const itemParams = z.object({ id: z.uuid(), productId: z.uuid() });
const MAX_COLLECTIONS = 50;

const toFeedback = (r: SizeFeedbackRow): SizeFeedback => ({
  id: r.id,
  productId: r.productId,
  recommendationId: r.recommendationId,
  recommendedSize: r.recommendedSize,
  purchasedSize: r.purchasedSize,
  fitRating: r.fitRating as SizeFeedback['fitRating'],
  fitPreference: r.fitPreference as SizeFeedback['fitPreference'],
  returned: r.returned,
  returnReason: r.returnReason,
  engineVersion: r.engineVersion,
  createdAt: r.createdAt.toISOString(),
});

/** Wardrobe collections (manual groupings) and size-fit feedback. */
export function wardrobeRoutes(db: Db, session: SessionTools) {
  async function ownCollection(userId: string, raw: unknown) {
    const p = idParams.safeParse(raw);
    const [row] = p.success
      ? await db.select().from(wardrobeCollections).where(and(eq(wardrobeCollections.id, p.data.id), eq(wardrobeCollections.userId, userId))).limit(1)
      : [];
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Collection not found');
    return row;
  }
  async function ownProduct(userId: string, productId: string) {
    const [row] = await db.select().from(products).where(and(eq(products.id, productId), eq(products.userId, userId))).limit(1);
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Product not found');
    return row;
  }
  async function list(userId: string): Promise<WardrobeCollection[]> {
    const rows = await db.select().from(wardrobeCollections).where(eq(wardrobeCollections.userId, userId)).orderBy(wardrobeCollections.name);
    const items = rows.length
      ? await db.select().from(wardrobeCollectionItems).where(inArray(wardrobeCollectionItems.collectionId, rows.map((r) => r.id)))
      : [];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      productIds: items.filter((i) => i.collectionId === r.id).map((i) => i.productId),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  return async (app: FastifyInstance) => {
    app.addHook('preHandler', session.requireAuth);

    app.get('/collections', async (req): Promise<CollectionListResponse> => ({ collections: await list(req.userId!) }));

    app.post('/collections', async (req, reply): Promise<CollectionListResponse> => {
      const { name } = parseInput(collectionNameSchema, req.body);
      const existing = await list(req.userId!);
      if (existing.length >= MAX_COLLECTIONS) throw new AppError(409, 'LIMIT', `You can have up to ${MAX_COLLECTIONS} collections`);
      if (existing.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
        throw new AppError(409, 'DUPLICATE', 'You already have a collection with that name', { name: 'Already exists' });
      }
      await db.insert(wardrobeCollections).values({ userId: req.userId!, name });
      reply.status(201);
      return { collections: await list(req.userId!) };
    });

    app.patch('/collections/:id', async (req): Promise<CollectionListResponse> => {
      const row = await ownCollection(req.userId!, req.params);
      const { name } = parseInput(collectionNameSchema, req.body);
      if ((await list(req.userId!)).some((c) => c.id !== row.id && c.name.toLowerCase() === name.toLowerCase())) {
        throw new AppError(409, 'DUPLICATE', 'You already have a collection with that name', { name: 'Already exists' });
      }
      await db.update(wardrobeCollections).set({ name, updatedAt: new Date() }).where(eq(wardrobeCollections.id, row.id));
      return { collections: await list(req.userId!) };
    });

    app.delete('/collections/:id', async (req, reply) => {
      const row = await ownCollection(req.userId!, req.params);
      await db.delete(wardrobeCollections).where(eq(wardrobeCollections.id, row.id)); // products themselves are kept
      return reply.status(204).send();
    });

    app.put('/collections/:id/items/:productId', async (req): Promise<CollectionListResponse> => {
      const p = itemParams.safeParse(req.params);
      if (!p.success) throw new AppError(404, 'NOT_FOUND', 'Not found');
      const row = await ownCollection(req.userId!, { id: p.data.id });
      await ownProduct(req.userId!, p.data.productId);
      await db.insert(wardrobeCollectionItems).values({ collectionId: row.id, productId: p.data.productId }).onConflictDoNothing();
      await db.update(wardrobeCollections).set({ updatedAt: new Date() }).where(eq(wardrobeCollections.id, row.id));
      return { collections: await list(req.userId!) };
    });

    app.delete('/collections/:id/items/:productId', async (req): Promise<CollectionListResponse> => {
      const p = itemParams.safeParse(req.params);
      if (!p.success) throw new AppError(404, 'NOT_FOUND', 'Not found');
      const row = await ownCollection(req.userId!, { id: p.data.id });
      await db
        .delete(wardrobeCollectionItems)
        .where(and(eq(wardrobeCollectionItems.collectionId, row.id), eq(wardrobeCollectionItems.productId, p.data.productId)));
      return { collections: await list(req.userId!) };
    });

    /** "How did this size fit?" — stored for offline analysis only. */
    app.post('/products/:id/size-feedback', async (req, reply): Promise<{ feedback: SizeFeedback }> => {
      const p = idParams.safeParse(req.params);
      if (!p.success) throw new AppError(404, 'NOT_FOUND', 'Product not found');
      const product = await ownProduct(req.userId!, p.data.id);
      const input = parseInput(sizeFeedbackSchema, req.body);
      const [rec] = input.recommendationId
        ? await db
            .select()
            .from(sizeRecommendations)
            .where(and(eq(sizeRecommendations.id, input.recommendationId), eq(sizeRecommendations.userId, req.userId!), eq(sizeRecommendations.productId, product.id)))
            .limit(1)
        : [];
      if (input.recommendationId && !rec) throw new AppError(404, 'NOT_FOUND', 'Recommendation not found');
      const [row] = await db
        .insert(sizeFeedback)
        .values({
          userId: req.userId!,
          productId: product.id,
          recommendationId: rec?.id ?? null,
          recommendedSize: rec?.recommendedSizeLabel ?? null,
          purchasedSize: input.purchasedSize,
          fitRating: input.fitRating,
          fitPreference: input.fitPreference,
          returned: input.returned,
          returnReason: input.returned ? input.returnReason : null,
          engineVersion: rec?.algorithmVersion ?? null,
          brand: product.brand,
          category: product.category,
        })
        .returning();
      req.server.analytics.track('size_feedback_submitted', req.userId!, { fit_rating: input.fitRating, engine_version: rec?.algorithmVersion ?? 'none' });
      reply.status(201);
      return { feedback: toFeedback(row!) };
    });

    app.get('/products/:id/size-feedback', async (req): Promise<SizeFeedbackListResponse> => {
      const p = idParams.safeParse(req.params);
      if (!p.success) throw new AppError(404, 'NOT_FOUND', 'Product not found');
      await ownProduct(req.userId!, p.data.id);
      const rows = await db
        .select()
        .from(sizeFeedback)
        .where(and(eq(sizeFeedback.productId, p.data.id), eq(sizeFeedback.userId, req.userId!)))
        .orderBy(desc(sizeFeedback.createdAt));
      return { feedback: rows.map(toFeedback) };
    });
  };
}
