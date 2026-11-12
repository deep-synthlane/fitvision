import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, asc, desc, eq, ilike, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  IMPORT_FALLBACK_MESSAGE,
  MAX_PRODUCT_IMAGE_BYTES,
  MAX_PRODUCT_IMAGES,
  createProductSchema,
  importRequestSchema,
  productListQuerySchema,
  updateProductSchema,
  type ImportResponse,
  type ProductListResponse,
  type ProductResponse,
  type SizeChart,
  type VariantInput,
} from '@fitvision/shared';
import type { Db } from '../../db/client.js';
import {
  productImages,
  productSizeMeasurements,
  productVariants,
  products,
  tryOnResults,
  wardrobeCollectionItems,
  type ProductMetadata,
} from '../../db/schema.js';
import type { VirtualTryOnProvider } from '../../tryon/provider.js';
import { GarmentImageError, isNearDuplicate, type GarmentProcessor, type PreparedGarmentImage } from '../../garment/processor.js';
import { AppError, parseInput } from '../../lib/errors.js';
import { FetchError, type FetchPolicy } from '../../net/policy.js';
import { safeFetch, type DnsLookup } from '../../net/safeFetch.js';
import type { SessionTools } from '../../plugins/auth.js';
import { ImportFailure, importFromUrl } from '../../products/import/index.js';
import type { ProductImporter } from '../../products/import/types.js';
import type { Storage } from '../../storage/index.js';
import { toProduct, toSummary } from './mapper.js';

export interface ProductDeps {
  db: Db;
  storage: Storage;
  processor: GarmentProcessor;
  importers: ProductImporter[];
  policy: FetchPolicy;
  lookup?: DnsLookup;
  session: SessionTools;
  /** To cancel paid try-on jobs when a product is deleted. */
  provider?: VirtualTryOnProvider;
}

const PRODUCT_UPLOAD_LIMITS = {
  fileSize: MAX_PRODUCT_IMAGE_BYTES,
  files: MAX_PRODUCT_IMAGES,
  fields: 1,
  fieldSize: 512 * 1024,
  parts: MAX_PRODUCT_IMAGES + 1,
};

const idParams = z.object({ id: z.uuid() });

/** "Acme" and "acme" are one filter option (filtering is case-insensitive). */
function uniqueIgnoringCase(values: (string | null)[]): string[] {
  const seen = new Map<string, string>();
  for (const v of values) if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v);
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
const imageParams = z.object({ id: z.uuid(), imageId: z.uuid() });
const imageQuery = z.object({ variant: z.enum(['prepared', 'original']).default('prepared') });

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** One variant per offered size, carrying SKU/availability found during import where the size matches. */
function variantRows(productId: string, sizes: string[], found: VariantInput[], color: string | null) {
  return sizes.map((size) => {
    const match = found.find((v) => v.sizeLabel?.toLowerCase() === size.toLowerCase());
    return { productId, sizeLabel: size, color: match?.color ?? color, sku: match?.sku ?? null, availability: match?.availability ?? null };
  });
}

async function writeSizeChart(tx: Tx, productId: string, chart: SizeChart | null) {
  await tx.delete(productSizeMeasurements).where(eq(productSizeMeasurements.productId, productId));
  if (!chart?.rows.length) return;
  const variants = await tx.select().from(productVariants).where(eq(productVariants.productId, productId));
  await tx.insert(productSizeMeasurements).values(
    chart.rows.map((r, position) => ({
      productId,
      variantId: variants.find((v) => v.sizeLabel?.toLowerCase() === r.sizeLabel.toLowerCase())?.id ?? null,
      sizeLabel: r.sizeLabel,
      chestCm: r.chestCm,
      waistCm: r.waistCm,
      hipsCm: r.hipsCm,
      shoulderCm: r.shoulderCm,
      inseamCm: r.inseamCm,
      sleeveCm: r.sleeveCm,
      rawMeasurementsJson: r.raw,
      source: chart.source,
      position,
    })),
  );
}

async function readCreateUpload(req: FastifyRequest) {
  const files = new Map<string, Buffer>();
  let json: unknown;
  for await (const part of req.parts({ limits: PRODUCT_UPLOAD_LIMITS })) {
    if (part.type === 'file') {
      if (!/^image\d{1,2}$/.test(part.fieldname) || files.has(part.fieldname)) {
        throw new AppError(400, 'BAD_UPLOAD', `Unexpected file field "${part.fieldname}"`);
      }
      const data = await part.toBuffer();
      files.set(part.fieldname, data);
    } else if (part.fieldname === 'data' && typeof part.value === 'string') {
      try {
        json = JSON.parse(part.value);
      } catch {
        throw new AppError(400, 'BAD_UPLOAD', 'The data field must be valid JSON');
      }
    } else {
      throw new AppError(400, 'BAD_UPLOAD', `Unexpected field "${part.fieldname}"`);
    }
  }
  return { files, input: parseInput(createProductSchema, json) };
}

export function productRoutes(deps: ProductDeps) {
  const { db, storage, processor, session } = deps;

  async function loadOwned(userId: string, rawParams: unknown) {
    const params = idParams.safeParse(rawParams);
    const [row] = params.success
      ? await db.select().from(products).where(and(eq(products.id, params.data.id), eq(products.userId, userId))).limit(1)
      : [];
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Product not found');
    return row;
  }

  async function bundle(productId: string) {
    const [row] = await db.select().from(products).where(eq(products.id, productId)).limit(1);
    const [images, variants, measurements] = await Promise.all([
      db.select().from(productImages).where(eq(productImages.productId, productId)),
      db.select().from(productVariants).where(eq(productVariants.productId, productId)),
      db.select().from(productSizeMeasurements).where(eq(productSizeMeasurements.productId, productId)),
    ]);
    return toProduct(row!, images, variants, measurements);
  }

  const deleteImageFiles = (rows: { imagePath: string; originalPath: string }[]) =>
    Promise.all(rows.flatMap((r) => [storage.delete(r.imagePath), storage.delete(r.originalPath)]));

  return async (app: FastifyInstance) => {
    app.addHook('preHandler', session.requireAuth);

    /** Extracts a product draft from a URL. Nothing is saved; the user reviews it first. */
    app.post(
      '/import',
      { config: { rateLimit: { max: 20, timeWindow: '10 minutes', keyGenerator: (req: FastifyRequest) => req.userId ?? req.ip } } },
      async (req): Promise<ImportResponse> => {
        const { url } = parseInput(importRequestSchema, req.body);
        try {
          const draft = await importFromUrl(url, { policy: deps.policy, lookup: deps.lookup, importers: deps.importers });
          const urls = [...new Set([draft.canonicalUrl, draft.fetchedUrl, url].filter((u): u is string => Boolean(u)))];
          const dupes = await db
            .select({ id: products.id, name: products.name })
            .from(products)
            .where(and(eq(products.userId, req.userId!), inArray(products.sourceUrl, urls)))
            .limit(5);
          req.server.metrics.productImports.inc({ result: 'ok', reason: 'none' });
          return { draft: { ...draft, possibleDuplicates: dupes } };
        } catch (err) {
          if (err instanceof ImportFailure) {
            req.server.metrics.productImports.inc({ result: 'failed', reason: err.code });
            req.log.info({ reason: err.code }, 'Product import failed');
            throw new AppError(422, 'IMPORT_FAILED', IMPORT_FALLBACK_MESSAGE, { reason: err.reason });
          }
          throw err;
        }
      },
    );

    app.post('/', async (req, reply): Promise<ProductResponse> => {
      if (!req.isMultipart()) throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Expected multipart/form-data');
      const userId = req.userId!;
      const { files, input } = await readCreateUpload(req);
      if (input.tryOnImageIndex >= input.images.length) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', { tryOnImageIndex: 'Choose one of the images' });
      }
      const notices: string[] = [];

      // 1. Collect and prepare every image (uploads must be valid; remote images may be skipped).
      const prepared: { image: PreparedGarmentImage; sourceUrl: string | null; imageType: string; inputIndex: number }[] = [];
      for (const [inputIndex, image] of input.images.entries()) {
        let data: Buffer;
        if (image.kind === 'upload') {
          const file = files.get(image.field);
          if (!file) throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', { [image.field]: 'File missing' });
          data = file;
        } else {
          try {
            data = (await safeFetch(image.url, { policy: deps.policy, lookup: deps.lookup, accept: ['image/'], maxBytes: MAX_PRODUCT_IMAGE_BYTES, timeoutMs: 15_000 })).body;
          } catch (err) {
            notices.push(`An image couldn’t be downloaded and was skipped${err instanceof FetchError ? ` (${err.message})` : ''}.`);
            continue;
          }
        }
        try {
          const ready = await processor.prepare(data);
          const dupe = prepared.find((p) => isNearDuplicate(p.image.hash, ready.hash));
          if (dupe) {
            notices.push('A duplicate image was skipped.');
            continue;
          }
          prepared.push({ image: ready, sourceUrl: image.kind === 'url' ? image.url : null, imageType: image.imageType, inputIndex });
        } catch (err) {
          if (!(err instanceof GarmentImageError)) throw err;
          if (image.kind === 'upload') throw new AppError(400, 'BAD_IMAGE', err.message, { [image.field]: err.message });
          notices.push(`An image was skipped: ${err.message}`);
        }
      }
      if (prepared.length === 0) {
        throw new AppError(422, 'NO_USABLE_IMAGES', 'None of the images could be used. Upload a garment photo instead.', {
          images: 'No usable images',
        });
      }
      let tryOn = prepared.find((p) => p.inputIndex === input.tryOnImageIndex);
      if (!tryOn) {
        tryOn = prepared[0]!;
        notices.push('The image you chose for try-on couldn’t be used, so the first image was selected instead.');
      }

      // 2. Possible duplicates already in the library (same link or a near-identical try-on image).
      const fields = input.fields;
      const existing = await db
        .select({ id: products.id, name: products.name, sourceUrl: products.sourceUrl, hash: productImages.perceptualHash })
        .from(products)
        .innerJoin(productImages, eq(productImages.id, products.selectedImageId))
        .where(eq(products.userId, userId))
        .orderBy(desc(products.createdAt))
        .limit(500);
      const similar = existing.find(
        (e) => (fields.sourceUrl && e.sourceUrl === fields.sourceUrl) || isNearDuplicate(e.hash, tryOn!.image.hash),
      );
      if (similar) notices.push(`This looks similar to “${similar.name}” already in your clothing.`);

      // 3. Store files, then write rows in one transaction.
      const productId = randomUUID();
      const stored = prepared.map((p, position) => {
        const id = randomUUID();
        const base = `products/${userId}/${productId}/${id}`;
        return { ...p, id, position, imagePath: `${base}-prepared.${p.image.ext}`, originalPath: `${base}-original.${p.image.ext}` };
      });
      try {
        for (const s of stored) {
          await storage.put(s.imagePath, s.image.prepared);
          await storage.put(s.originalPath, s.image.original);
        }
        const metadata: ProductMetadata = {
          description: fields.description ?? null,
          colors: fields.colors ?? [],
          sizeLabel: fields.sizeLabel ?? null,
          sizeChart: fields.sizeChart ? { unit: fields.sizeChart.unit, kind: fields.sizeChart.kind, source: fields.sizeChart.source } : null,
          import: input.importInfo,
          preparation: { processorVersion: processor.version, backgroundRemoval: processor.backgroundRemoval },
        };
        await db.transaction(async (tx) => {
          await tx.insert(products).values({
            id: productId,
            userId,
            source: input.source,
            sourceUrl: fields.sourceUrl ?? null,
            name: fields.name,
            brand: fields.brand ?? null,
            category: fields.category,
            subcategory: fields.subcategory ?? null,
            color: fields.color ?? null,
            price: fields.price ?? null,
            currency: fields.currency ?? null,
            metadataJson: metadata,
          });
          await tx.insert(productImages).values(
            stored.map((s) => ({
              id: s.id,
              productId,
              imagePath: s.imagePath,
              originalPath: s.originalPath,
              sourceUrl: s.sourceUrl,
              imageType: s.imageType,
              position: s.position,
              width: s.image.width,
              height: s.image.height,
              perceptualHash: s.image.hash,
            })),
          );
          await tx.update(products).set({ selectedImageId: stored.find((s) => s.inputIndex === tryOn!.inputIndex)!.id }).where(eq(products.id, productId));
          const variants = variantRows(productId, fields.sizes ?? [], fields.variants ?? [], fields.color ?? null);
          if (variants.length) await tx.insert(productVariants).values(variants);
          await writeSizeChart(tx, productId, fields.sizeChart ?? null);
        });
      } catch (err) {
        await deleteImageFiles(stored);
        throw err;
      }
      req.server.analytics.track(input.source === 'product_url' ? 'product_imported' : 'product_uploaded', userId, { category: fields.category, source: input.source });
      reply.status(201);
      return { product: await bundle(productId), notices };
    });

    /** Wardrobe listing: search, filters, sort, plus facets for the filter menus. */
    app.get('/', async (req): Promise<ProductListResponse> => {
      const userId = req.userId!;
      const q = parseInput(productListQuerySchema, req.query);
      const like = (v: string) => `%${v.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const conds: (SQL | undefined)[] = [eq(products.userId, userId)];
      if (q.q) conds.push(or(ilike(products.name, like(q.q)), ilike(products.brand, like(q.q))));
      if (q.category) conds.push(eq(products.category, q.category));
      if (q.brand) conds.push(sql`lower(${products.brand}) = lower(${q.brand})`);
      if (q.color) conds.push(sql`lower(${products.color}) = lower(${q.color})`);
      if (q.favourite) conds.push(eq(products.isFavourite, q.favourite === 'true'));
      if (q.viewed) conds.push(isNotNull(products.lastViewedAt));
      if (q.collectionId) {
        conds.push(
          inArray(
            products.id,
            db.select({ id: wardrobeCollectionItems.productId }).from(wardrobeCollectionItems).where(eq(wardrobeCollectionItems.collectionId, q.collectionId)),
          ),
        );
      }
      const order =
        q.sort === 'oldest'
          ? [asc(products.createdAt)]
          : q.sort === 'name'
            ? [asc(sql`lower(${products.name})`)]
            : q.sort === 'recently_viewed'
              ? [sql`${products.lastViewedAt} desc nulls last`, desc(products.createdAt)]
              : [desc(products.createdAt)];
      const [rows, all] = await Promise.all([
        db.select().from(products).where(and(...conds)).orderBy(...order).limit(200),
        db.select({ category: products.category, brand: products.brand, color: products.color }).from(products).where(eq(products.userId, userId)),
      ]);
      const facets = {
        categories: [...new Set(all.map((a) => a.category))].sort() as ProductListResponse['facets']['categories'],
        brands: uniqueIgnoringCase(all.map((a) => a.brand)),
        colors: uniqueIgnoringCase(all.map((a) => a.color)),
      };
      if (rows.length === 0) return { products: [], facets, total: all.length };
      const ids = rows.map((r) => r.id);
      const [variants, firstImages, items] = await Promise.all([
        db.select().from(productVariants).where(inArray(productVariants.productId, ids)),
        db.select().from(productImages).where(and(inArray(productImages.productId, ids), eq(productImages.position, 0))),
        db.select().from(wardrobeCollectionItems).where(inArray(wardrobeCollectionItems.productId, ids)),
      ]);
      return {
        products: rows.map((r) =>
          toSummary(
            r,
            variants.filter((v) => v.productId === r.id && v.sizeLabel).map((v) => v.sizeLabel!),
            r.selectedImageId ?? firstImages.find((i) => i.productId === r.id)?.id ?? null,
            items.filter((i) => i.productId === r.id).map((i) => i.collectionId),
          ),
        ),
        facets,
        total: all.length,
      };
    });

    app.post('/:id/favourite', async (req): Promise<ProductResponse> => {
      const row = await loadOwned(req.userId!, req.params);
      const { favourite } = parseInput(z.object({ favourite: z.boolean() }), req.body);
      await db.update(products).set({ isFavourite: favourite }).where(eq(products.id, row.id));
      return { product: await bundle(row.id), notices: [] };
    });

    app.get('/:id', async (req): Promise<ProductResponse> => {
      const row = await loadOwned(req.userId!, req.params);
      // "Recently viewed" for the wardrobe.
      await db.update(products).set({ lastViewedAt: new Date() }).where(eq(products.id, row.id));
      return { product: await bundle(row.id), notices: [] };
    });

    app.patch('/:id', async (req): Promise<ProductResponse> => {
      const row = await loadOwned(req.userId!, req.params);
      const input = parseInput(updateProductSchema, req.body);
      const images = await db.select().from(productImages).where(eq(productImages.productId, row.id));
      const ownImage = (id: string) => images.some((i) => i.id === id);
      const remove = input.removeImageIds ?? [];
      if (remove.some((id) => !ownImage(id)) || (input.tryOnImageId && !ownImage(input.tryOnImageId))) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', { images: 'Unknown image' });
      }
      if (Object.keys(input.imageTypes ?? {}).some((id) => !ownImage(id))) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', { images: 'Unknown image' });
      }
      const remaining = images.filter((i) => !remove.includes(i.id));
      if (remaining.length === 0) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', { images: 'A product needs at least one image' });
      }
      if (input.tryOnImageId && remove.includes(input.tryOnImageId)) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', { tryOnImageId: 'That image is being removed' });
      }

      const f = input.fields;
      const removed = images.filter((i) => remove.includes(i.id));
      // Read before the transaction (a single-connection database can't serve it mid-transaction).
      const chartToWrite = f.sizeChart !== undefined ? f.sizeChart : f.sizes !== undefined ? (await bundle(row.id)).sizeChart : undefined;
      await db.transaction(async (tx) => {
        const meta = { ...row.metadataJson };
        if (f.description !== undefined) meta.description = f.description;
        if (f.colors !== undefined) meta.colors = f.colors;
        if (f.sizeLabel !== undefined) meta.sizeLabel = f.sizeLabel;
        if (f.sizeChart !== undefined) meta.sizeChart = f.sizeChart ? { unit: f.sizeChart.unit, kind: f.sizeChart.kind, source: f.sizeChart.source } : null;

        let selected = input.tryOnImageId ?? row.selectedImageId;
        if (!selected || remove.includes(selected)) selected = [...remaining].sort((a, b) => a.position - b.position)[0]!.id;

        await tx
          .update(products)
          .set({
            ...(f.name !== undefined && { name: f.name }),
            ...(f.brand !== undefined && { brand: f.brand }),
            ...(f.category !== undefined && { category: f.category }),
            ...(f.subcategory !== undefined && { subcategory: f.subcategory }),
            ...(f.color !== undefined && { color: f.color }),
            ...(f.sourceUrl !== undefined && { sourceUrl: f.sourceUrl }),
            ...(f.price !== undefined && { price: f.price }),
            ...(f.currency !== undefined && { currency: f.currency }),
            selectedImageId: selected,
            metadataJson: meta,
            updatedAt: new Date(),
          })
          .where(eq(products.id, row.id));
        for (const [id, imageType] of Object.entries(input.imageTypes ?? {})) {
          await tx.update(productImages).set({ imageType }).where(eq(productImages.id, id));
        }
        if (remove.length) await tx.delete(productImages).where(inArray(productImages.id, remove));
        if (f.sizes !== undefined) {
          const old = await tx.select().from(productVariants).where(eq(productVariants.productId, row.id));
          const known: VariantInput[] = [...(f.variants ?? []), ...old.map((v) => ({ sizeLabel: v.sizeLabel, color: v.color, sku: v.sku, availability: v.availability }))];
          await tx.delete(productVariants).where(eq(productVariants.productId, row.id));
          const fresh = variantRows(row.id, f.sizes, known, f.color ?? row.color);
          if (fresh.length) await tx.insert(productVariants).values(fresh);
        }
        // Re-link chart rows to the (possibly new) variants.
        if (chartToWrite !== undefined) await writeSizeChart(tx, row.id, chartToWrite ?? null);
      });
      await deleteImageFiles(removed);
      return { product: await bundle(row.id), notices: [] };
    });

    app.delete('/:id', async (req, reply) => {
      const row = await loadOwned(req.userId!, req.params);
      const images = await db.select().from(productImages).where(eq(productImages.productId, row.id));
      // Try-ons of this product go too: stop paid jobs and remove their result images.
      const tryOns = await db.select().from(tryOnResults).where(eq(tryOnResults.productId, row.id));
      await Promise.all(
        tryOns
          .filter((t) => (t.status === 'pending' || t.status === 'processing') && t.providerJobId && deps.provider?.cancel)
          .map((t) => deps.provider!.cancel!(t.providerJobId!).catch(() => {})),
      );
      await db.delete(products).where(eq(products.id, row.id));
      await deleteImageFiles(images);
      await Promise.all(tryOns.filter((t) => t.resultImagePath).map((t) => storage.delete(t.resultImagePath!)));
      return reply.status(204).send();
    });

    /** Owner-only image download (prepared copy by default, `?variant=original` for full resolution). */
    app.get('/:id/images/:imageId', async (req, reply) => {
      const params = imageParams.safeParse(req.params);
      const query = imageQuery.safeParse(req.query);
      if (!params.success || !query.success) throw new AppError(404, 'NOT_FOUND', 'Image not found');
      const [image] = await db
        .select({ imagePath: productImages.imagePath, originalPath: productImages.originalPath })
        .from(productImages)
        .innerJoin(products, eq(products.id, productImages.productId))
        .where(and(eq(productImages.id, params.data.imageId), eq(products.id, params.data.id), eq(products.userId, req.userId!)))
        .limit(1);
      const key = image && (query.data.variant === 'original' ? image.originalPath : image.imagePath);
      const data = key ? await storage.get(key) : null;
      if (!data) throw new AppError(404, 'NOT_FOUND', 'Image not found');
      return reply
        .header('content-type', 'image/webp')
        .header('cache-control', 'private, no-store')
        .header('x-content-type-options', 'nosniff')
        .send(data);
    });
  };
}

