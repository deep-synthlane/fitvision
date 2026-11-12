import type { Product, ProductSummary, SizeChart } from '@fitvision/shared';
import type { ProductImageRow, ProductRow, ProductSizeMeasurementRow, ProductVariantRow } from '../../db/schema.js';

export const imageUrl = (productId: string, imageId: string) => `/api/products/${productId}/images/${imageId}`;

export function toProduct(
  row: ProductRow,
  images: ProductImageRow[],
  variants: ProductVariantRow[],
  measurements: ProductSizeMeasurementRow[],
): Product {
  const meta = row.metadataJson;
  const chartMeta = meta.sizeChart;
  const sizeChart: SizeChart | null =
    chartMeta && measurements.length
      ? {
          ...chartMeta,
          rows: [...measurements]
            .sort((a, b) => a.position - b.position)
            .map((m) => ({
              sizeLabel: m.sizeLabel,
              chestCm: m.chestCm,
              waistCm: m.waistCm,
              hipsCm: m.hipsCm,
              shoulderCm: m.shoulderCm,
              inseamCm: m.inseamCm,
              sleeveCm: m.sleeveCm,
              raw: m.rawMeasurementsJson,
            })),
        }
      : null;
  return {
    id: row.id,
    source: row.source as Product['source'],
    sourceUrl: row.sourceUrl,
    name: row.name,
    brand: row.brand,
    category: row.category as Product['category'],
    subcategory: row.subcategory,
    color: row.color,
    sizeLabel: meta.sizeLabel,
    price: row.price,
    currency: row.currency,
    description: meta.description,
    sizes: variants.map((v) => v.sizeLabel).filter((s): s is string => Boolean(s)),
    colors: meta.colors,
    tryOnImageId: row.selectedImageId,
    isFavourite: row.isFavourite,
    images: [...images]
      .sort((a, b) => a.position - b.position)
      .map((i) => ({
        id: i.id,
        url: imageUrl(row.id, i.id),
        sourceUrl: i.sourceUrl,
        imageType: i.imageType as Product['images'][number]['imageType'],
        position: i.position,
        width: i.width,
        height: i.height,
      })),
    variants: variants.map((v) => ({ id: v.id, sizeLabel: v.sizeLabel, color: v.color, sku: v.sku, availability: v.availability })),
    sizeChart,
    preparation: meta.preparation,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toSummary(row: ProductRow, sizes: string[], imageId: string | null, collectionIds: string[] = []): ProductSummary {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    category: row.category as ProductSummary['category'],
    color: row.color,
    source: row.source as ProductSummary['source'],
    sizes,
    isFavourite: row.isFavourite,
    createdAt: row.createdAt.toISOString(),
    lastViewedAt: row.lastViewedAt?.toISOString() ?? null,
    imageUrl: imageId ? imageUrl(row.id, imageId) : null,
    collectionIds,
  };
}
