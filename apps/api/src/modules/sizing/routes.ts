import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  SIZE_ENGINE_VERSION,
  chartToEngineRows,
  recommendSize,
  type ProductCategory,
  type SizeEngineInput,
  type SizeRecommendation,
  type SizeRecommendationResponse,
  type StaleReason,
} from '@fitvision/shared';
import type { Db } from '../../db/client.js';
import {
  bodyMeasurements,
  productImages,
  productSizeMeasurements,
  productVariants,
  products,
  sizeRecommendations,
  type ProductRow,
  type SizeRecommendationRow,
} from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import type { SessionTools } from '../../plugins/auth.js';
import { toMeasurements } from '../measurements/routes.js';
import { toProduct } from '../products/mapper.js';

const idParams = z.object({ id: z.uuid() });

function toRecommendation(row: SizeRecommendationRow): SizeRecommendation {
  return {
    id: row.id,
    productId: row.productId,
    measurementId: row.measurementId,
    measurementSource: row.measurementSource as SizeRecommendation['measurementSource'],
    scanVersion: row.scanVersion,
    recommendedVariantId: row.recommendedVariantId,
    result: row.comparisonJson,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Size & fit recommendation (deterministic engine in @fitvision/shared). Try-on images are never used. */
export function sizingRoutes(db: Db, session: SessionTools) {
  async function ownProduct(userId: string, raw: unknown): Promise<ProductRow> {
    const p = idParams.safeParse(raw);
    const [row] = p.success ? await db.select().from(products).where(and(eq(products.id, p.data.id), eq(products.userId, userId))).limit(1) : [];
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Product not found');
    return row;
  }

  const latestMeasurement = async (userId: string) =>
    (
      await db
        .select()
        .from(bodyMeasurements)
        .where(eq(bodyMeasurements.userId, userId))
        .orderBy(desc(bodyMeasurements.createdAt), desc(bodyMeasurements.id))
        .limit(1)
    )[0];

  return async (app: FastifyInstance) => {
    app.addHook('preHandler', session.requireAuth);

    app.get('/:id/size-recommendation', async (req): Promise<SizeRecommendationResponse> => {
      const product = await ownProduct(req.userId!, req.params);
      const [rec] = await db
        .select()
        .from(sizeRecommendations)
        .where(and(eq(sizeRecommendations.userId, req.userId!), eq(sizeRecommendations.productId, product.id)))
        .orderBy(desc(sizeRecommendations.createdAt))
        .limit(1);
      const latest = await latestMeasurement(req.userId!);
      const stale: StaleReason[] = [];
      if (rec) {
        if (latest && latest.id !== rec.measurementId) stale.push('measurements_changed');
        if (product.updatedAt.getTime() > rec.productUpdatedAt.getTime()) stale.push('product_changed');
        if (rec.algorithmVersion !== SIZE_ENGINE_VERSION) stale.push('algorithm_changed');
      }
      return { recommendation: rec ? toRecommendation(rec) : null, stale, canCompute: Boolean(latest) };
    });

    /** Computes and stores a recommendation from the latest confirmed measurements. */
    app.post('/:id/size-recommendation', async (req, reply): Promise<SizeRecommendationResponse> => {
      const userId = req.userId!;
      const productRow = await ownProduct(userId, req.params);
      const measurementRow = await latestMeasurement(userId);
      if (!measurementRow) throw new AppError(409, 'NO_MEASUREMENTS', 'Save your body measurements or complete a body scan first');
      const m = toMeasurements(measurementRow);

      const [images, variants, sizeRows] = await Promise.all([
        db.select().from(productImages).where(eq(productImages.productId, productRow.id)),
        db.select().from(productVariants).where(eq(productVariants.productId, productRow.id)),
        db.select().from(productSizeMeasurements).where(eq(productSizeMeasurements.productId, productRow.id)),
      ]);
      const product = toProduct(productRow, images, variants, sizeRows);
      const input: SizeEngineInput = {
        category: product.category as ProductCategory,
        user: {
          measurementId: m.id,
          source: m.source,
          scanVersion: m.scanEstimates?.processingVersion ?? null,
          values: {
            heightCm: m.heightCm,
            chestCm: m.chestCm,
            waistCm: m.waistCm,
            hipsCm: m.hipsCm,
            shoulderCm: m.shoulderCm,
            inseamCm: m.inseamCm,
            armLengthCm: m.armLengthCm,
          },
        },
        chart: product.sizeChart
          ? { kind: product.sizeChart.kind, source: product.sizeChart.source, unit: product.sizeChart.unit, rows: chartToEngineRows(product.sizeChart) }
          : null,
        availableSizes: product.sizes,
      };
      const result = recommendSize(input);
      const variant = result.recommendedSize
        ? variants.find((v) => v.sizeLabel?.trim().toLowerCase() === result.recommendedSize!.trim().toLowerCase())
        : undefined;

      const [row] = await db
        .insert(sizeRecommendations)
        .values({
          userId,
          productId: product.id,
          measurementId: m.id,
          measurementSource: m.source,
          scanVersion: input.user.scanVersion,
          recommendedVariantId: variant?.id ?? null,
          recommendedSizeLabel: result.recommendedSize,
          alternativeSizeLabel: result.alternativeSize,
          fitType: result.fit,
          confidence: result.confidence,
          algorithmVersion: result.algorithmVersion,
          comparisonJson: result,
          warningsJson: result.warnings,
          chartSource: result.chartSource,
          productUpdatedAt: productRow.updatedAt,
        })
        .returning();
      req.server.metrics.sizeRecommendations.inc({ confidence: result.confidence, chart_source: result.chartSource ?? 'none' });
      req.server.analytics.track('size_recommendation_generated', userId, {
        category: product.category,
        confidence: result.confidence,
        chart_quality: result.chartQuality,
        engine_version: result.algorithmVersion,
      });
      reply.status(201);
      return { recommendation: toRecommendation(row!), stale: [], canCompute: true };
    });
  };
}
