import type { BodyParameters, ScanEstimates, ServerPhotoChecks, SizeChartRow, SizeChart, SizeRecommendationResult, TryOnSuitability, VariantInput } from '@fitvision/shared';
import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, numeric, pgTable, primaryKey, real, smallint, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  /** Incremented to revoke every existing session (sign out everywhere, account changes). */
  tokenVersion: integer('token_version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const profiles = pgTable('profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  birthYear: smallint('birth_year'),
  heightCm: real('height_cm').notNull(),
  weightKg: real('weight_kg').notNull(),
  clothingPreference: text('clothing_preference').notNull(),
  country: text('country').notNull(),
  measurementUnit: text('measurement_unit').notNull(),
  onboardedAt: timestamp('onboarded_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Scan metadata only; the measurement results live in `body_measurements`. Image paths are storage keys. */
export const bodyScans = pgTable(
  'body_scans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    frontImagePath: text('front_image_path').notNull(),
    sideImagePath: text('side_image_path').notNull(),
    backImagePath: text('back_image_path'),
    processingVersion: text('processing_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [index('body_scans_user_created_idx').on(t.userId, t.createdAt)],
);

/** Append-only: each save is a new row, the latest row is the current set. */
export const bodyMeasurements = pgTable(
  'body_measurements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    heightCm: real('height_cm'),
    chestCm: real('chest_cm'),
    waistCm: real('waist_cm'),
    hipsCm: real('hips_cm'),
    shoulderCm: real('shoulder_cm'),
    inseamCm: real('inseam_cm'),
    armLengthCm: real('arm_length_cm'),
    source: text('source').notNull(),
    scanId: uuid('scan_id').references(() => bodyScans.id, { onDelete: 'set null' }),
    scanEstimates: jsonb('scan_estimates').$type<ScanEstimates>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('body_measurements_user_created_idx').on(t.userId, t.createdAt)],
);

/**
 * Generated avatars. Linked to the measurement snapshot they were built from; deleting the
 * body scan keeps the avatar (scan link set to null). Asset and preview paths are storage keys.
 */
export const avatars = pgTable(
  'avatars',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bodyScanId: uuid('body_scan_id').references(() => bodyScans.id, { onDelete: 'set null' }),
    measurementId: uuid('measurement_id')
      .notNull()
      .references(() => bodyMeasurements.id, { onDelete: 'cascade' }),
    modelVersion: text('model_version').notNull(),
    avatarType: text('avatar_type').notNull(),
    bodyParametersJson: jsonb('body_parameters_json').$type<BodyParameters>(),
    assetPath: text('asset_path'),
    previewImagePath: text('preview_image_path'),
    status: text('status').notNull(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('avatars_user_created_idx').on(t.userId, t.createdAt),
    // At most one generation in flight per user, even if two requests race.
    uniqueIndex('avatars_one_active_per_user').on(t.userId).where(sql`${t.status} in ('pending', 'processing')`),
  ],
);

/** Extra product data that doesn't need its own column. */
export interface ProductMetadata {
  description: string | null;
  colors: string[];
  /** The size the user owns / is considering, if they entered one. */
  sizeLabel: string | null;
  sizeChart: Pick<SizeChart, 'unit' | 'kind' | 'source'> | null;
  import: { importers: string[]; fetchedUrl: string; warnings: string[] } | null;
  preparation: { processorVersion: string; backgroundRemoval: 'not_available' };
}

/** Garments in a user's clothing library. `source_url` is the canonical/original product URL. */
export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    sourceUrl: text('source_url'),
    name: text('name').notNull(),
    brand: text('brand'),
    category: text('category').notNull(),
    subcategory: text('subcategory'),
    color: text('color'),
    price: numeric('price', { precision: 12, scale: 2, mode: 'number' }),
    currency: text('currency'),
    /** The image chosen for virtual try-on. */
    selectedImageId: uuid('selected_image_id').references((): AnyPgColumn => productImages.id, { onDelete: 'set null' }),
    metadataJson: jsonb('metadata_json').$type<ProductMetadata>().notNull(),
    isFavourite: boolean('is_favourite').notNull().default(false),
    lastViewedAt: timestamp('last_viewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('products_user_created_idx').on(t.userId, t.createdAt), index('products_user_source_url_idx').on(t.userId, t.sourceUrl)],
);

/** Stored copies of product images: `original_path` (full resolution) and `image_path` (prepared for try-on). */
export const productImages = pgTable(
  'product_images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    imagePath: text('image_path').notNull(),
    originalPath: text('original_path').notNull(),
    sourceUrl: text('source_url'),
    imageType: text('image_type').notNull(),
    position: smallint('position').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    perceptualHash: text('perceptual_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('product_images_product_idx').on(t.productId, t.position)],
);

export const productVariants = pgTable(
  'product_variants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    sizeLabel: text('size_label'),
    color: text('color'),
    sku: text('sku'),
    availability: text('availability'),
  },
  (t) => [index('product_variants_product_idx').on(t.productId)],
);

/** Size chart rows, normalised to cm (range midpoints) with the original text in `raw_measurements_json`. */
export const productSizeMeasurements = pgTable(
  'product_size_measurements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id').references(() => productVariants.id, { onDelete: 'set null' }),
    sizeLabel: text('size_label').notNull(),
    chestCm: real('chest_cm'),
    waistCm: real('waist_cm'),
    hipsCm: real('hips_cm'),
    shoulderCm: real('shoulder_cm'),
    inseamCm: real('inseam_cm'),
    sleeveCm: real('sleeve_cm'),
    rawMeasurementsJson: jsonb('raw_measurements_json').$type<SizeChartRow['raw']>().notNull(),
    source: text('source').notNull(),
    position: smallint('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('product_size_measurements_product_idx').on(t.productId)],
);

/** Photos the user approved for virtual try-on (separate from body-scan photos). Soft-deleted: files are removed, the row stays for result history. */
export const tryOnPhotos = pgTable(
  'try_on_photos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    imagePath: text('image_path').notNull(),
    thumbnailPath: text('thumbnail_path').notNull(),
    suitabilityJson: jsonb('suitability_json').$type<TryOnSuitability & { server: ServerPhotoChecks }>().notNull(),
    /** uploaded_photo | camera_photo | avatar_render (rows before this column: uploaded_photo). */
    source: text('source').notNull().default('uploaded_photo'),
    /** For avatar renders: the avatar it was rendered from, its model version and the framing used. */
    avatarId: uuid('avatar_id').references(() => avatars.id, { onDelete: 'set null' }),
    avatarModelVersion: text('avatar_model_version'),
    framing: text('framing'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('try_on_photos_user_idx').on(t.userId, t.createdAt), index('try_on_photos_avatar_idx').on(t.avatarId)],
);

export const tryOnResults = pgTable(
  'try_on_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    /** The garment image used (the product's try-on image unless the user chose another). */
    productImageId: uuid('product_image_id').references(() => productImages.id, { onDelete: 'set null' }),
    personPhotoId: uuid('person_photo_id')
      .notNull()
      .references(() => tryOnPhotos.id),
    avatarId: uuid('avatar_id').references(() => avatars.id, { onDelete: 'set null' }),
    /** Snapshot: kept even if the avatar is later deleted or regenerated. */
    avatarModelVersion: text('avatar_model_version'),
    /** uploaded_photo | camera_photo | saved_photo | avatar_render. */
    personSource: text('person_source').notNull().default('uploaded_photo'),
    provider: text('provider').notNull(),
    modelVersion: text('model_version').notNull(),
    status: text('status').notNull(),
    source: text('source').notNull(),
    providerJobId: text('provider_job_id'),
    resultImagePath: text('result_image_path'),
    errorCode: text('error_code'),
    /** User-safe message. Raw provider details go to server logs (and `diagnostic`) only. */
    errorMessage: text('error_message'),
    diagnostic: text('diagnostic'),
    idempotencyKey: uuid('idempotency_key').notNull(),
    attempts: smallint('attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    index('try_on_results_user_created_idx').on(t.userId, t.createdAt),
    uniqueIndex('try_on_results_idempotency_idx').on(t.userId, t.idempotencyKey),
    // The same photo + garment can only be generating once at a time.
    uniqueIndex('try_on_results_one_active_pair')
      .on(t.userId, t.personPhotoId, t.productImageId)
      .where(sql`${t.status} in ('pending', 'processing')`),
  ],
);

/** A saved try-on result. References the result's image rather than copying it. */
export const savedLooks = pgTable(
  'saved_looks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tryOnResultId: uuid('try_on_result_id')
      .notNull()
      .references(() => tryOnResults.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('saved_looks_result_idx').on(t.tryOnResultId), index('saved_looks_user_idx').on(t.userId, t.createdAt)],
);

/**
 * Size recommendations. `comparison_json` holds the engine's full output including its inputs,
 * so every recommendation can be audited and replayed with the recorded algorithm version.
 */
export const sizeRecommendations = pgTable(
  'size_recommendations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    measurementId: uuid('measurement_id')
      .notNull()
      .references(() => bodyMeasurements.id, { onDelete: 'cascade' }),
    measurementSource: text('measurement_source').notNull(),
    scanVersion: text('scan_version'),
    recommendedVariantId: uuid('recommended_variant_id').references(() => productVariants.id, { onDelete: 'set null' }),
    recommendedSizeLabel: text('recommended_size_label'),
    alternativeSizeLabel: text('alternative_size_label'),
    fitType: text('fit_type'),
    confidence: text('confidence').notNull(),
    algorithmVersion: text('algorithm_version').notNull(),
    comparisonJson: jsonb('comparison_json').$type<SizeRecommendationResult>().notNull(),
    warningsJson: jsonb('warnings_json').$type<string[]>().notNull(),
    chartSource: text('chart_source'),
    /** Product state the recommendation was computed from (an edited size chart makes it stale). */
    productUpdatedAt: timestamp('product_updated_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('size_recommendations_user_product_idx').on(t.userId, t.productId, t.createdAt)],
);

export type SizeRecommendationRow = typeof sizeRecommendations.$inferSelect;

/** Manual wardrobe groupings (Work, Casual, …). */
export const wardrobeCollections = pgTable(
  'wardrobe_collections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('wardrobe_collections_user_name_idx').on(t.userId, t.name)],
);

export const wardrobeCollectionItems = pgTable(
  'wardrobe_collection_items',
  {
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => wardrobeCollections.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.collectionId, t.productId] })],
);

/**
 * How a recommended size actually fitted. Collected for offline calibration only — the size
 * engine never changes itself from individual feedback.
 */
export const sizeFeedback = pgTable(
  'size_feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    recommendationId: uuid('recommendation_id').references(() => sizeRecommendations.id, { onDelete: 'set null' }),
    recommendedSize: text('recommended_size'),
    purchasedSize: text('purchased_size'),
    fitRating: text('fit_rating').notNull(),
    fitPreference: text('fit_preference'),
    returned: boolean('returned'),
    returnReason: text('return_reason'),
    engineVersion: text('engine_version'),
    /** Snapshot for analysis even if the product is later edited. */
    brand: text('brand'),
    category: text('category').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('size_feedback_user_idx').on(t.userId, t.createdAt), index('size_feedback_engine_idx').on(t.engineVersion)],
);

/**
 * Privacy-conscious product analytics: event name, a pseudonymous subject (HMAC of the user id)
 * and an allow-listed set of non-sensitive properties. No measurements, photos or URLs.
 */
export const analyticsEvents = pgTable(
  'analytics_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    subject: text('subject').notNull(),
    properties: jsonb('properties').$type<Record<string, string | number | boolean>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('analytics_events_name_created_idx').on(t.name, t.createdAt)],
);

export type WardrobeCollectionRow = typeof wardrobeCollections.$inferSelect;
export type SizeFeedbackRow = typeof sizeFeedback.$inferSelect;

export type TryOnPhotoRow = typeof tryOnPhotos.$inferSelect;
export type TryOnResultRow = typeof tryOnResults.$inferSelect;
export type SavedLookRow = typeof savedLooks.$inferSelect;

export type ProductRow = typeof products.$inferSelect;
export type ProductImageRow = typeof productImages.$inferSelect;
export type ProductVariantRow = typeof productVariants.$inferSelect;
export type ProductSizeMeasurementRow = typeof productSizeMeasurements.$inferSelect;
export type { VariantInput };

export type UserRow = typeof users.$inferSelect;
export type ProfileRow = typeof profiles.$inferSelect;
export type BodyMeasurementsRow = typeof bodyMeasurements.$inferSelect;
export type BodyScanRow = typeof bodyScans.$inferSelect;
export type AvatarRow = typeof avatars.$inferSelect;
