import sharp from 'sharp';
import type { FastifyInstance } from 'fastify';
import type { TryOnSuitability } from '@fitvision/shared';
import { TryOnProviderError, type ProviderJobState, type ProviderMetadata, type TryOnRequest, type VirtualTryOnProvider } from '../../src/tryon/provider.js';
import { garmentPng } from './productSite.js';

/** A detailed (sharp) stand-in for a person photo. */
export const personPhoto = (w = 600, h = 900) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#888', noise: { type: 'gaussian', mean: 128, sigma: 40 } } }).jpeg().toBuffer();
/** Flat image: fails the server-side blur check. */
export const blurryPhoto = () => sharp({ create: { width: 600, height: 900, channels: 3, background: '#999' } }).jpeg().toBuffer();

export const suitability = (overrides: Partial<TryOnSuitability> = {}): TryOnSuitability => ({
  checkedBy: 'test',
  onePerson: true,
  facingCamera: true,
  personHeightFraction: 0.8,
  regions: { upper_body: true, lower_body: true, full_body: true },
  lightingOk: true,
  sharpOk: true,
  issues: [],
  ...overrides,
});

export async function uploadPhoto(app: FastifyInstance, cookie: string, data?: Buffer, s: TryOnSuitability = suitability()) {
  const fd = new FormData();
  fd.append('photo', new Blob([data ?? (await personPhoto())]), 'me.jpg');
  fd.append('suitability', JSON.stringify(s));
  return app.inject({ method: 'POST', url: '/api/try-on-photos', headers: { cookie }, payload: fd });
}

export async function createProduct(app: FastifyInstance, cookie: string, category = 't_shirts', imageType = 'garment_front') {
  const fd = new FormData();
  fd.append('image0', new Blob([await garmentPng('#2563eb')]), 'g.png');
  fd.append(
    'data',
    JSON.stringify({
      source: 'manual_upload',
      fields: { name: 'Test Garment', category },
      images: [{ kind: 'upload', field: 'image0', imageType }],
      tryOnImageIndex: 0,
    }),
  );
  return (await app.inject({ method: 'POST', url: '/api/products', headers: { cookie }, payload: fd })).json().product;
}

type Step = () => Promise<ProviderJobState>;

/** Scriptable provider for tests: queue `create` and `status` behaviours. */
export class FakeProvider implements VirtualTryOnProvider {
  metadata: ProviderMetadata = {
    provider: 'fake',
    modelVersion: 'fake-1',
    source: 'real',
    external: false,
    verified: false,
    supportsCancel: true,
    estimatedCostUsd: 0.05,
  };
  createSteps: Step[] = [];
  statusSteps: Step[] = [];
  createCalls = 0;
  statusCalls = 0;
  cancelled: string[] = [];
  /** Every request the provider received (person + garment images). */
  requests: TryOnRequest[] = [];

  static readyImage = () => sharp({ create: { width: 300, height: 400, channels: 3, background: '#0f766e' } }).png().toBuffer();

  async createTryOn(request: TryOnRequest): Promise<ProviderJobState> {
    this.createCalls++;
    this.requests.push(request);
    const step = this.createSteps.shift();
    return step ? step() : { state: 'processing', providerJobId: `job-${this.createCalls}` };
  }

  async getStatus(providerJobId: string): Promise<ProviderJobState> {
    this.statusCalls++;
    const step = this.statusSteps.shift();
    return step ? step() : { state: 'ready', providerJobId, image: { data: await FakeProvider.readyImage() } };
  }

  async cancel(providerJobId: string) {
    this.cancelled.push(providerJobId);
  }

  /** Never finishes. */
  hang() {
    this.statusSteps = Array.from({ length: 10_000 }, () => async () => ({ state: 'processing' as const, providerJobId: 'job-hang' }));
  }
}

export const providerError = (code: TryOnProviderError['code'], detail = 'raw provider detail: secret-request-id-123') =>
  new TryOnProviderError(code, detail);
