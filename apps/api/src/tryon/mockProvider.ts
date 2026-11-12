import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { TryOnProviderError, type ProviderJobState, type ProviderMetadata, type TryOnRequest, type VirtualTryOnProvider } from './provider.js';

/**
 * Placeholder provider for development and demos. It does NOT run any AI model: it lays the
 * garment over the person image and burns in "MOCK TRY-ON RESULT — NOT AI GENERATED", so a mock
 * result can never be mistaken for a real try-on, even if the image is viewed on its own.
 */
export class MockVirtualTryOnProvider implements VirtualTryOnProvider {
  readonly metadata: ProviderMetadata = {
    provider: 'mock',
    modelVersion: 'mock-composite-0.1',
    source: 'mock',
    external: false,
    verified: true,
    supportsCancel: true,
    estimatedCostUsd: 0,
  };
  private readonly jobs = new Map<string, { readyAt: number; image: Promise<Buffer>; cancelled: boolean }>();

  constructor(private readonly delayMs = 1500) {}

  async createTryOn(request: TryOnRequest): Promise<ProviderJobState> {
    const id = `mock-${randomUUID()}`;
    this.jobs.set(id, { readyAt: Date.now() + this.delayMs, image: compose(request), cancelled: false });
    return { state: 'processing', providerJobId: id };
  }

  async getStatus(providerJobId: string): Promise<ProviderJobState> {
    const job = this.jobs.get(providerJobId);
    if (!job) return { state: 'failed', providerJobId, error: new TryOnProviderError('failed', 'unknown mock job', false) };
    if (job.cancelled) return { state: 'cancelled', providerJobId };
    if (Date.now() < job.readyAt) return { state: 'processing', providerJobId };
    this.jobs.delete(providerJobId);
    return { state: 'ready', providerJobId, image: { data: await job.image } };
  }

  async cancel(providerJobId: string) {
    const job = this.jobs.get(providerJobId);
    if (job) job.cancelled = true;
  }
}

export const MOCK_WATERMARK = 'MOCK TRY-ON RESULT — NOT AI GENERATED';

/** Body band (fractions of image height) and width used for the garment overlay. */
const REGION_BOX = {
  upper_body: { top: 0.26, height: 0.4, width: 0.5 },
  lower_body: { top: 0.48, height: 0.46, width: 0.42 },
  full_body: { top: 0.24, height: 0.6, width: 0.5 },
} as const;

/**
 * Development-only composite: the garment (with its plain background knocked out) is laid over
 * the body region of the person image, and a watermark is burnt in. It looks clearly different
 * from the input so the pipeline can be checked by eye, and can never pass for a real try-on.
 */
async function compose(request: TryOnRequest): Promise<Buffer> {
  const { width = 768, height = 1024 } = await sharp(request.personImage.data).metadata();
  const box = REGION_BOX[request.region];

  // Knock out the near-white product-photo background so only the garment is overlaid.
  const { data, info } = await sharp(request.garmentImage.data)
    .resize({ width: Math.round(width * box.width), height: Math.round(height * box.height), fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    if (data[i]! > 228 && data[i + 1]! > 228 && data[i + 2]! > 228) data[i + 3] = 0;
    else data[i + 3] = 235;
  }
  const garment = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();

  const band = Math.round(height * 0.07);
  const font = Math.round(width * 0.034);
  const text = MOCK_WATERMARK.replace('—', '&#8212;');
  const watermark = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect x="0" y="0" width="${width}" height="${band}" fill="#b45309"/>
      <text x="50%" y="${Math.round(band * 0.66)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${font}" fill="#ffffff">${text}</text>
      <rect x="0" y="${height - band}" width="${width}" height="${band}" fill="#b45309"/>
      <text x="50%" y="${height - Math.round(band * 0.34)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${font}" fill="#ffffff">${text}</text>
      <text x="50%" y="50%" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${Math.round(width * 0.075)}"
        fill="#b45309" fill-opacity="0.28" transform="rotate(-35 ${width / 2} ${height / 2})">MOCK — NOT AI</text>
      <rect x="4" y="4" width="${width - 8}" height="${height - 8}" fill="none" stroke="#b45309" stroke-width="8" stroke-dasharray="24 12"/>
    </svg>`,
  );
  return sharp(request.personImage.data)
    .composite([
      { input: garment, left: Math.round((width - info.width) / 2), top: Math.round(height * box.top) },
      { input: watermark, left: 0, top: 0 },
    ])
    .webp({ quality: 88 })
    .toBuffer();
}
