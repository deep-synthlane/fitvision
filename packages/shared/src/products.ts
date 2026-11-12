import { z } from 'zod';

export const PRODUCT_CATEGORIES = ['tops', 'shirts', 't_shirts', 'jackets', 'dresses', 'trousers', 'jeans', 'skirts', 'shorts'] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
export const PRODUCT_CATEGORY_LABELS: Record<ProductCategory, string> = {
  tops: 'Tops',
  shirts: 'Shirts',
  t_shirts: 'T-shirts',
  jackets: 'Jackets',
  dresses: 'Dresses',
  trousers: 'Trousers / Pants',
  jeans: 'Jeans',
  skirts: 'Skirts',
  shorts: 'Shorts',
};

export const PRODUCT_SOURCES = ['manual_upload', 'product_url', 'supported_store', 'future_catalog'] as const;
export type ProductSource = (typeof PRODUCT_SOURCES)[number];
export const PRODUCT_SOURCE_LABELS: Record<ProductSource, string> = {
  manual_upload: 'Uploaded',
  product_url: 'Imported from link',
  supported_store: 'Supported store',
  future_catalog: 'Catalogue',
};

/** User-assigned; we don't auto-classify photos. */
export const PRODUCT_IMAGE_TYPES = ['garment_front', 'garment_back', 'on_model', 'detail', 'lifestyle', 'unknown'] as const;
export type ProductImageType = (typeof PRODUCT_IMAGE_TYPES)[number];
export const PRODUCT_IMAGE_TYPE_LABELS: Record<ProductImageType, string> = {
  garment_front: 'Garment – front',
  garment_back: 'Garment – back',
  on_model: 'Worn by model',
  detail: 'Detail',
  lifestyle: 'Lifestyle',
  unknown: 'Not set',
};

export const SIZE_MEASUREMENT_KEYS = ['chestCm', 'waistCm', 'hipsCm', 'shoulderCm', 'inseamCm', 'sleeveCm'] as const;
export type SizeMeasurementKey = (typeof SIZE_MEASUREMENT_KEYS)[number];
export const SIZE_MEASUREMENT_LABELS: Record<SizeMeasurementKey, string> = {
  chestCm: 'Chest / bust',
  waistCm: 'Waist',
  hipsCm: 'Hips',
  shoulderCm: 'Shoulder',
  inseamCm: 'Inseam',
  sleeveCm: 'Sleeve',
};

export const MAX_PRODUCT_IMAGES = 8;
export const MAX_PRODUCT_IMAGE_BYTES = 10 * 1024 * 1024;

export const IMPORT_FALLBACK_MESSAGE =
  'Import could not be completed automatically. Upload the garment image or enter the product details manually.';

/** One row of a size chart: normalised cm (midpoint for ranges) plus the original text. */
export const sizeChartRowSchema = z.object({
  sizeLabel: z.string().trim().min(1).max(40),
  chestCm: z.number().positive().max(300).nullable(),
  waistCm: z.number().positive().max(300).nullable(),
  hipsCm: z.number().positive().max(300).nullable(),
  shoulderCm: z.number().positive().max(150).nullable(),
  inseamCm: z.number().positive().max(200).nullable(),
  sleeveCm: z.number().positive().max(150).nullable(),
  /** Original cell text and parsed ranges, e.g. { chest: { raw: "34-36 in", minCm: 86.4, maxCm: 91.4 } }. */
  raw: z.record(z.string(), z.object({ raw: z.string().max(80), minCm: z.number().nullable(), maxCm: z.number().nullable() })),
});
export type SizeChartRow = z.infer<typeof sizeChartRowSchema>;

export const sizeChartSchema = z.object({
  unit: z.enum(['cm', 'in']),
  /** Body measurements (fit the wearer) or garment measurements (the item laid flat). */
  kind: z.enum(['body', 'garment', 'unknown']),
  source: z.enum(['json_ld', 'html_table', 'user']),
  rows: z.array(sizeChartRowSchema).max(40),
});
export type SizeChart = z.infer<typeof sizeChartSchema>;

const text = (max: number) => z.string().trim().max(max);

export const variantInputSchema = z.object({
  sizeLabel: z.string().trim().max(40).nullable(),
  color: z.string().trim().max(60).nullable(),
  sku: z.string().trim().max(100).nullable(),
  availability: z.string().trim().max(60).nullable(),
});
export type VariantInput = z.infer<typeof variantInputSchema>;
const optionalText = (max: number) =>
  text(max)
    .nullable()
    .transform((v) => (v === '' ? null : v));

const productFieldsShape = {
  name: text(200).min(1, 'Product name is required'),
  brand: optionalText(100),
  category: z.enum(PRODUCT_CATEGORIES, { message: 'Choose a category' }),
  subcategory: optionalText(100),
  color: optionalText(60),
  sizeLabel: optionalText(40),
  sourceUrl: z
    .url({ protocol: /^https?$/, message: 'Enter a valid http(s) link' })
    .max(2000)
    .nullable()
    .or(z.literal('').transform(() => null)),
  price: z.number({ message: 'Enter a valid price' }).nonnegative().max(1_000_000).nullable(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code, e.g. USD')
    .nullable()
    .or(z.literal('').transform(() => null)),
  description: optionalText(2000),
  /** Sizes offered (e.g. from the product page). */
  sizes: z.array(text(40).min(1)).max(40),
  colors: z.array(text(60).min(1)).max(40),
  /** Variant details found on the product page (kept only for sizes still listed in `sizes`). */
  variants: z.array(variantInputSchema).max(200),
  sizeChart: sizeChartSchema.nullable(),
};

/** Creating: name and category required; anything else may be omitted (stored as empty). */
export const productFieldsSchema = z
  .object(productFieldsShape)
  .partial({ brand: true, subcategory: true, color: true, sizeLabel: true, sourceUrl: true, price: true, currency: true, description: true, sizes: true, colors: true, variants: true, sizeChart: true });
/** Editing: only the fields sent are changed (no defaults, so omitted fields are never cleared). */
export const productPatchFieldsSchema = z.object(productFieldsShape).partial();
export type ProductFields = z.input<typeof productFieldsSchema>;

export const productImageInputSchema = z.discriminatedUnion('kind', [
  /** A file in the multipart upload, by field name. */
  z.object({ kind: z.literal('upload'), field: z.string().regex(/^image\d{1,2}$/), imageType: z.enum(PRODUCT_IMAGE_TYPES) }),
  /** A remote image found during import; fetched server-side with the same SSRF protections. */
  z.object({ kind: z.literal('url'), url: z.url({ protocol: /^https?$/ }).max(2000), imageType: z.enum(PRODUCT_IMAGE_TYPES) }),
]);
export type ProductImageInput = z.infer<typeof productImageInputSchema>;

/** JSON part of `POST /api/products` (multipart). */
export const createProductSchema = z.object({
  source: z.enum(['manual_upload', 'product_url']),
  fields: productFieldsSchema,
  images: z.array(productImageInputSchema).min(1, 'Add at least one image').max(MAX_PRODUCT_IMAGES),
  /** Index into `images` of the image to use for virtual try-on. */
  tryOnImageIndex: z.number().int().min(0),
  /** Import provenance, kept in metadata. */
  importInfo: z
    .object({ importers: z.array(z.string().max(60)).max(10), fetchedUrl: z.string().max(2000), warnings: z.array(z.string().max(300)).max(20) })
    .nullable()
    .default(null),
});
export type CreateProductInput = z.input<typeof createProductSchema>;

export const updateProductSchema = z.object({
  fields: productPatchFieldsSchema,
  tryOnImageId: z.uuid().optional(),
  imageTypes: z.record(z.uuid(), z.enum(PRODUCT_IMAGE_TYPES)).optional(),
  removeImageIds: z.array(z.uuid()).max(MAX_PRODUCT_IMAGES).optional(),
});
export type UpdateProductInput = z.input<typeof updateProductSchema>;

export const importRequestSchema = z.object({ url: z.string().trim().min(1, 'Paste a product link').max(2000) });

/** Where an extracted value came from, so the review screen can show what to double-check. */
export type FieldOrigin = 'structured_data' | 'opengraph' | 'store_adapter' | 'html' | 'not_found';

export interface ImportDraft {
  fetchedUrl: string;
  canonicalUrl: string | null;
  fields: {
    name: string | null;
    brand: string | null;
    category: ProductCategory | null;
    subcategory: string | null;
    color: string | null;
    price: number | null;
    currency: string | null;
    description: string | null;
    sizes: string[];
    colors: string[];
    variants: VariantInput[];
    sizeChart: SizeChart | null;
  };
  origins: Partial<Record<keyof ImportDraft['fields'], FieldOrigin>>;
  images: { url: string; origin: FieldOrigin }[];
  importers: string[];
  warnings: string[];
  /** Products in the user's library with the same canonical URL. */
  possibleDuplicates: { id: string; name: string }[];
}

export interface ImportResponse {
  draft: ImportDraft;
}

export interface ProductImage {
  id: string;
  url: string;
  sourceUrl: string | null;
  imageType: ProductImageType;
  position: number;
  width: number;
  height: number;
}

export interface ProductVariant {
  id: string;
  sizeLabel: string | null;
  color: string | null;
  sku: string | null;
  availability: string | null;
}

export interface Product {
  id: string;
  source: ProductSource;
  sourceUrl: string | null;
  name: string;
  brand: string | null;
  category: ProductCategory;
  subcategory: string | null;
  color: string | null;
  sizeLabel: string | null;
  price: number | null;
  currency: string | null;
  description: string | null;
  sizes: string[];
  colors: string[];
  tryOnImageId: string | null;
  isFavourite: boolean;
  images: ProductImage[];
  variants: ProductVariant[];
  sizeChart: SizeChart | null;
  /** Garment-preparation status: background removal etc. arrive in Phase 5. */
  preparation: { processorVersion: string; backgroundRemoval: 'not_available' };
  createdAt: string;
  updatedAt: string;
}

export type ProductSummary = Pick<
  Product,
  'id' | 'name' | 'brand' | 'category' | 'color' | 'source' | 'sizes' | 'isFavourite' | 'createdAt'
> & { imageUrl: string | null; lastViewedAt: string | null; collectionIds: string[] };

export const PRODUCT_SORTS = ['newest', 'oldest', 'recently_viewed', 'name'] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

/** Query for GET /api/products (wardrobe search and filters). */
export const productListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.enum(PRODUCT_CATEGORIES).optional(),
  brand: z.string().trim().max(100).optional(),
  color: z.string().trim().max(60).optional(),
  favourite: z.enum(['true', 'false']).optional(),
  collectionId: z.uuid().optional(),
  viewed: z.enum(['true']).optional(),
  sort: z.enum(PRODUCT_SORTS).default('newest'),
});
export type ProductListQuery = z.input<typeof productListQuerySchema>;

export interface ProductResponse {
  product: Product;
  /** e.g. near-duplicate images that were skipped, or a similar product already in the library. */
  notices: string[];
}

export interface ProductListResponse {
  products: ProductSummary[];
  /** Values present across all of the user's products, for filter menus. */
  facets: { categories: ProductCategory[]; brands: string[]; colors: string[] };
  total: number;
}

const CM_PER_IN_CHART = 2.54;
const round1Chart = (n: number) => Math.round(n * 10) / 10;

/**
 * Parses a size-chart cell typed by a user ("86-90", "34 1/2", "34½", "96") into cm. Shared so a
 * manually entered chart has exactly the same shape as an imported one and goes through the
 * same size engine.
 */
export function parseSizeValue(text: string, unit: 'cm' | 'in'): { minCm: number; maxCm: number; midCm: number } | null {
  const s = text
    .replace(/½/g, '.5')
    .replace(/¼/g, '.25')
    .replace(/¾/g, '.75')
    .replace(/(\d+)\s+1\/2/g, '$1.5')
    .replace(/(\d+)\s+1\/4/g, '$1.25')
    .replace(/(\d+)\s+3\/4/g, '$1.75')
    .replace(/,(\d)/g, '.$1');
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:(?:-|–|—|to)\s*(\d+(?:\.\d+)?))?\s*(cm|in|"|″)?\s*$/i.exec(s);
  if (!m) return null;
  const a = Number(m[1]);
  const b = m[2] ? Number(m[2]) : a;
  const factor = (m[3] ? (m[3].toLowerCase() === 'cm' ? 'cm' : 'in') : unit) === 'in' ? CM_PER_IN_CHART : 1;
  const minCm = round1Chart(Math.min(a, b) * factor);
  const maxCm = round1Chart(Math.max(a, b) * factor);
  return { minCm, maxCm, midCm: round1Chart((minCm + maxCm) / 2) };
}
