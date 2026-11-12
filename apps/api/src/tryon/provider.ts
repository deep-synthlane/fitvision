import type { GarmentRegion } from '@fitvision/shared';

export interface TryOnRequest {
  /** Prepared person photo (WebP/JPEG bytes). */
  personImage: { data: Buffer; mime: string };
  /** Prepared garment image. */
  garmentImage: { data: Buffer; mime: string };
  region: GarmentRegion;
  garmentDescription: string;
}

export type ProviderJobState =
  | { state: 'processing'; providerJobId: string }
  | { state: 'ready'; providerJobId: string | null; image: { data: Buffer } | { url: string } }
  | { state: 'failed'; providerJobId: string | null; error: TryOnProviderError }
  | { state: 'cancelled'; providerJobId: string | null };

export interface ProviderMetadata {
  provider: string;
  modelVersion: string;
  source: 'mock' | 'real';
  /** Sends images to a third-party service. */
  external: boolean;
  /** Has this provider been manually tested end to end with real images? */
  verified: boolean;
  supportsCancel: boolean;
  /** Approximate cost per generation for budgeting (USD), if known. */
  estimatedCostUsd: number | null;
}

/**
 * Virtual try-on behind one interface so the app isn't tied to a single AI service.
 * `createTryOn` may finish immediately (ready/failed) or return a job to poll with `getStatus`.
 */
export interface VirtualTryOnProvider {
  readonly metadata: ProviderMetadata;
  createTryOn(request: TryOnRequest, signal?: AbortSignal): Promise<ProviderJobState>;
  getStatus(providerJobId: string, signal?: AbortSignal): Promise<ProviderJobState>;
  cancel?(providerJobId: string): Promise<void>;
}

export type ProviderErrorCode = 'timeout' | 'moderation' | 'rate_limited' | 'unavailable' | 'invalid_input' | 'failed';

/** Normalised provider error. `detail` is for server logs only — never shown to users. */
export class TryOnProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    public readonly detail: string,
    public readonly retryable = code === 'rate_limited' || code === 'unavailable' || code === 'timeout',
  ) {
    super(`${code}: ${detail}`);
  }
}
