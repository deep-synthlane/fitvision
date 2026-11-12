import type { AppConfig } from '../config.js';
import { MockVirtualTryOnProvider } from './mockProvider.js';
import type { VirtualTryOnProvider } from './provider.js';
import { ReplicateVirtualTryOnProvider } from './replicateProvider.js';

/** The only place that chooses a try-on provider. */
export function createTryOnProvider(config: AppConfig): VirtualTryOnProvider {
  if (config.tryOn.provider === 'replicate' && config.tryOn.replicate) {
    return new ReplicateVirtualTryOnProvider({
      apiToken: config.tryOn.replicate.apiToken,
      modelVersion: config.tryOn.replicate.modelVersion,
      estimatedCostUsd: config.tryOn.replicate.costUsd,
    });
  }
  return new MockVirtualTryOnProvider();
}
