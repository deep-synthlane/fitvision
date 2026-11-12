import { TryOnProviderError, type ProviderJobState, type ProviderMetadata, type TryOnRequest, type VirtualTryOnProvider } from './provider.js';

export interface ReplicateOptions {
  apiToken: string;
  /** Model version id of an IDM-VTON-style try-on model hosted on Replicate. */
  modelVersion: string;
  baseUrl?: string;
  estimatedCostUsd?: number | null;
  fetchImpl?: typeof fetch;
}

interface Prediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: string | string[] | null;
  error?: string | null;
}

const REGION_TO_CATEGORY = { upper_body: 'upper_body', lower_body: 'lower_body', full_body: 'dresses' } as const;

/**
 * Example external provider: a try-on model on Replicate's predictions API
 * (inputs `human_img`, `garm_img`, `garment_des`, `category`, as used by IDM-VTON ports).
 *
 * UNVERIFIED: covered only by contract tests against a local fake of the API. It has not been run
 * against the real service, and the model's licence must be checked before commercial use.
 */
export class ReplicateVirtualTryOnProvider implements VirtualTryOnProvider {
  readonly metadata: ProviderMetadata;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: ReplicateOptions) {
    this.baseUrl = (opts.baseUrl ?? 'https://api.replicate.com/v1').replace(/\/$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.metadata = {
      provider: 'replicate',
      modelVersion: opts.modelVersion,
      source: 'real',
      external: true,
      verified: false,
      supportsCancel: true,
      estimatedCostUsd: opts.estimatedCostUsd ?? null,
    };
  }

  private async call(path: string, init: RequestInit, signal?: AbortSignal): Promise<Prediction> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal,
        headers: { authorization: `Bearer ${this.opts.apiToken}`, 'content-type': 'application/json' },
      });
    } catch (err) {
      if (signal?.aborted) throw new TryOnProviderError('timeout', 'request aborted');
      throw new TryOnProviderError('unavailable', `network error: ${(err as Error).message}`);
    }
    if (res.status === 429) throw new TryOnProviderError('rate_limited', 'HTTP 429');
    if (res.status === 401 || res.status === 403) throw new TryOnProviderError('unavailable', `auth failed (HTTP ${res.status})`, false);
    if (res.status === 422 || res.status === 400) throw new TryOnProviderError('invalid_input', `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    if (res.status >= 500) throw new TryOnProviderError('unavailable', `HTTP ${res.status}`);
    if (!res.ok) throw new TryOnProviderError('failed', `HTTP ${res.status}`, false);
    return (await res.json()) as Prediction;
  }

  private toState(p: Prediction): ProviderJobState {
    switch (p.status) {
      case 'starting':
      case 'processing':
        return { state: 'processing', providerJobId: p.id };
      case 'succeeded': {
        const url = Array.isArray(p.output) ? p.output[0] : p.output;
        if (!url) return { state: 'failed', providerJobId: p.id, error: new TryOnProviderError('failed', 'succeeded without output', false) };
        return { state: 'ready', providerJobId: p.id, image: { url } };
      }
      case 'canceled':
        return { state: 'cancelled', providerJobId: p.id };
      default: {
        const detail = p.error ?? 'unknown error';
        const code = /nsfw|safety|moderat|policy/i.test(detail) ? 'moderation' : 'failed';
        return { state: 'failed', providerJobId: p.id, error: new TryOnProviderError(code, detail, false) };
      }
    }
  }

  async createTryOn(request: TryOnRequest, signal?: AbortSignal): Promise<ProviderJobState> {
    // Images are sent inline as data URIs, so no temporary upload files are left at the provider's file store.
    const dataUri = (img: { data: Buffer; mime: string }) => `data:${img.mime};base64,${img.data.toString('base64')}`;
    const prediction = await this.call(
      '/predictions',
      {
        method: 'POST',
        body: JSON.stringify({
          version: this.opts.modelVersion,
          input: {
            human_img: dataUri(request.personImage),
            garm_img: dataUri(request.garmentImage),
            garment_des: request.garmentDescription.slice(0, 200),
            category: REGION_TO_CATEGORY[request.region],
          },
        }),
      },
      signal,
    );
    return this.toState(prediction);
  }

  async getStatus(providerJobId: string, signal?: AbortSignal): Promise<ProviderJobState> {
    return this.toState(await this.call(`/predictions/${encodeURIComponent(providerJobId)}`, { method: 'GET' }, signal));
  }

  async cancel(providerJobId: string) {
    await this.call(`/predictions/${encodeURIComponent(providerJobId)}/cancel`, { method: 'POST' });
  }
}
