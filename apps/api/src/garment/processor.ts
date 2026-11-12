import sharp from 'sharp';

export interface PreparedGarmentImage {
  /** Full-resolution copy (≤ 4096 px), orientation applied, metadata (EXIF/GPS) stripped. */
  original: Buffer;
  /** Working copy for try-on/display (≤ 1600 px). */
  prepared: Buffer;
  ext: 'webp';
  mime: 'image/webp';
  width: number;
  height: number;
  /** Perceptual fingerprint for near-duplicate detection: `<dHash 16 hex>:<mean RGB 6 hex>`. */
  hash: string;
  sourceFormat: string;
}

/**
 * Garment image preparation. Phase 4 does validation, orientation, resizing, metadata stripping
 * and hashing. Phase 5 can extend an implementation with segmentation, background removal and
 * garment masks; until then `backgroundRemoval` is reported as not available.
 */
export interface GarmentProcessor {
  readonly version: string;
  readonly backgroundRemoval: 'not_available';
  prepare(data: Buffer): Promise<PreparedGarmentImage>;
}

export type GarmentImageErrorCode = 'unsupported_format' | 'too_small' | 'too_large' | 'corrupt';

export class GarmentImageError extends Error {
  constructor(
    public readonly code: GarmentImageErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const SUPPORTED_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif', 'gif']);
const MIN_EDGE = 200;
const MAX_INPUT_PIXELS = 40_000_000;

export class SharpGarmentProcessor implements GarmentProcessor {
  readonly version = 'sharp-basic-0.1';
  readonly backgroundRemoval = 'not_available' as const;

  async prepare(data: Buffer): Promise<PreparedGarmentImage> {
    const input = () => sharp(data, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error', animated: false });
    let meta: sharp.Metadata;
    try {
      meta = await input().metadata();
    } catch (err) {
      if (err instanceof Error && /pixel limit/i.test(err.message)) throw new GarmentImageError('too_large', 'The image has too many pixels.');
      throw new GarmentImageError('unsupported_format', 'The file isn’t a supported image (JPEG, PNG, WebP, AVIF or GIF).');
    }
    if (!meta.format || !SUPPORTED_FORMATS.has(meta.format)) {
      throw new GarmentImageError('unsupported_format', 'The file isn’t a supported image (JPEG, PNG, WebP, AVIF or GIF).');
    }
    // Orientation 5–8 swaps width and height.
    const swapped = (meta.orientation ?? 1) >= 5;
    const width = (swapped ? meta.height : meta.width) ?? 0;
    const height = (swapped ? meta.width : meta.height) ?? 0;
    if (width * height > MAX_INPUT_PIXELS) throw new GarmentImageError('too_large', 'The image has too many pixels.');
    if (Math.min(width, height) < MIN_EDGE) {
      throw new GarmentImageError('too_small', `The image is too small (minimum ${MIN_EDGE} × ${MIN_EDGE} px).`);
    }

    try {
      // rotate() with no angle applies EXIF orientation; sharp drops metadata unless asked to keep it.
      const [original, preparedOut, hash] = await Promise.all([
        input().rotate().resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true }).webp({ quality: 92 }).toBuffer(),
        input().rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer({ resolveWithObject: true }),
        differenceHash(input().rotate()),
      ]);
      return {
        original,
        prepared: preparedOut.data,
        ext: 'webp',
        mime: 'image/webp',
        width: preparedOut.info.width,
        height: preparedOut.info.height,
        hash,
        sourceFormat: meta.format,
      };
    } catch {
      throw new GarmentImageError('corrupt', 'The image couldn’t be read — it may be damaged.');
    }
  }
}

/** Neighbours closer than this count as equal, so flat backgrounds don't flip bits on re-encoding. */
const DHASH_TOLERANCE = 3;

/**
 * dHash (adjacent-pixel comparison on a 9×8 greyscale thumbnail) plus the mean colour, because
 * dHash alone sees only brightness structure: the same garment shot in two colours would match.
 * Linear resampling avoids ringing at garment edges that made re-encoded copies drift.
 */
async function differenceHash(img: sharp.Sharp): Promise<string> {
  const [{ data }, mean] = await Promise.all([
    img.clone().greyscale().resize(9, 8, { fit: 'fill', kernel: 'linear' }).raw().toBuffer({ resolveWithObject: true }),
    img.clone().removeAlpha().resize(1, 1, { fit: 'fill', kernel: 'linear' }).raw().toBuffer(),
  ]);
  let bits = '';
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) bits += data[y * 9 + x]! > data[y * 9 + x + 1]! + DHASH_TOLERANCE ? '1' : '0';
  }
  const rgb = [...mean.subarray(0, 3)].map((v) => v.toString(16).padStart(2, '0')).join('');
  return `${BigInt(`0b${bits}`).toString(16).padStart(16, '0')}:${rgb}`;
}

export function hammingDistance(a: string, b: string): number {
  let x = BigInt(`0x${a.split(':')[0]}`) ^ BigInt(`0x${b.split(':')[0]}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

function colourDistance(a: string, b: string): number {
  const rgb = (h: string) => [0, 2, 4].map((i) => parseInt(h.split(':')[1]?.slice(i, i + 2) ?? '00', 16));
  const [x, y] = [rgb(a), rgb(b)];
  return Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!);
}

/** Same picture re-encoded or resized: near-identical structure and similar overall colour. */
export function isNearDuplicate(a: string, b: string): boolean {
  return hammingDistance(a, b) <= 5 && colourDistance(a, b) <= 20;
}
