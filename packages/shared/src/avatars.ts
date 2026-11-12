import type { ClothingPreference } from './profile.js';

export const AVATAR_STATUSES = ['pending', 'processing', 'ready', 'failed'] as const;
export type AvatarStatus = (typeof AVATAR_STATUSES)[number];

export const AVATAR_VIEWS = ['front', 'side', 'back'] as const;
export type AvatarView = (typeof AVATAR_VIEWS)[number];

export const AVATAR_DISCLAIMER =
  'Your avatar is an approximate digital representation built from your measurements. It is not an exact reconstruction of your body.';

/** Measurements an avatar is built from, in priority order. */
export const AVATAR_MEASUREMENTS = ['heightCm', 'shoulderCm', 'chestCm', 'waistCm', 'hipsCm', 'inseamCm', 'armLengthCm'] as const;
export type AvatarMeasurementKey = (typeof AVATAR_MEASUREMENTS)[number];

/** `measured`: from the user's confirmed measurements; `default`: typical proportion for their height. */
export type ParameterSource = 'measured' | 'default';

/** The confirmed measurement snapshot an avatar was generated from. */
export interface AvatarInputs {
  measurementId: string;
  clothingPreference: ClothingPreference;
  values: Record<AvatarMeasurementKey, number | null>;
}

export interface BodyParameters {
  inputs: AvatarInputs;
  /** Every value the model used, and whether it was measured or a default. */
  resolved: Record<AvatarMeasurementKey, { valueCm: number; source: ParameterSource }>;
  /** Torso cross-sections (cm) solved from girths with typical depth-to-width ratios. */
  sections: Record<'chest' | 'waist' | 'hips', { widthCm: number; depthCm: number }>;
  /**
   * Self-check: the generated model re-measured and compared with `resolved`. Shows the model
   * reflects the numbers it was given — not that it matches the person's real body.
   */
  fidelity: {
    heightErrorCm: number;
    shoulderErrorCm: number;
    inseamErrorCm: number;
    chestErrorPct: number;
    waistErrorPct: number;
    hipsErrorPct: number;
  };
}

export interface Avatar {
  id: string;
  status: AvatarStatus;
  avatarType: string;
  modelVersion: string;
  measurementId: string;
  bodyScanId: string | null;
  parameters: BodyParameters | null;
  error: string | null;
  /** Owner-only URLs, present when ready. */
  assetUrl: string | null;
  previewUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AvatarResponse {
  avatar: Avatar | null;
  /** True when the measurements or profile changed since the avatar was generated. */
  outdated: boolean;
  /** False until the user has saved at least one set of measurements. */
  canGenerate: boolean;
}
