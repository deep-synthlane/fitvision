import { z } from 'zod';

export interface WardrobeCollection {
  id: string;
  name: string;
  productIds: string[];
  createdAt: string;
  updatedAt: string;
}
export interface CollectionListResponse {
  collections: WardrobeCollection[];
}
export const collectionNameSchema = z.object({ name: z.string().trim().min(1, 'Give the collection a name').max(40) });

export const SUGGESTED_COLLECTIONS = ['Work', 'Casual', 'Party', 'Travel', 'Summer', 'Winter'] as const;

export const FIT_RATINGS = ['too_small', 'slightly_small', 'just_right', 'slightly_large', 'too_large'] as const;
export type FitRating = (typeof FIT_RATINGS)[number];
export const FIT_RATING_LABELS: Record<FitRating, string> = {
  too_small: 'Too small',
  slightly_small: 'Slightly small',
  just_right: 'Just right',
  slightly_large: 'Slightly large',
  too_large: 'Too large',
};
export const FIT_PREFERENCES = ['closer', 'regular', 'looser'] as const;
export const FIT_PREFERENCE_LABELS: Record<(typeof FIT_PREFERENCES)[number], string> = {
  closer: 'I like a closer fit',
  regular: 'I like a regular fit',
  looser: 'I like a looser fit',
};

/** "How did this size fit?" — stored for offline calibration; never changes the engine directly. */
export const sizeFeedbackSchema = z.object({
  recommendationId: z.uuid().nullable().default(null),
  fitRating: z.enum(FIT_RATINGS, { message: 'Choose how it fitted' }),
  purchasedSize: z.string().trim().max(40).nullable().default(null),
  fitPreference: z.enum(FIT_PREFERENCES).nullable().default(null),
  returned: z.boolean().nullable().default(null),
  returnReason: z.string().trim().max(300).nullable().default(null),
});
export type SizeFeedbackInput = z.input<typeof sizeFeedbackSchema>;

export interface SizeFeedback {
  id: string;
  productId: string;
  recommendationId: string | null;
  recommendedSize: string | null;
  purchasedSize: string | null;
  fitRating: FitRating;
  fitPreference: (typeof FIT_PREFERENCES)[number] | null;
  returned: boolean | null;
  returnReason: string | null;
  engineVersion: string | null;
  createdAt: string;
}
export interface SizeFeedbackListResponse {
  feedback: SizeFeedback[];
}

export const DATA_KIND_LABELS = {
  scans: 'Body-scan photos',
  measurements: 'Body measurements (also removes avatars and size recommendations built from them)',
  avatar: 'Avatar',
  'try-on-photos': 'Try-on photos',
  'try-ons': 'Try-on results (and saved looks)',
  products: 'Clothing products (and their try-ons, size recommendations and feedback)',
  'saved-looks': 'Saved looks',
} as const;
export type DataKind = keyof typeof DATA_KIND_LABELS;
