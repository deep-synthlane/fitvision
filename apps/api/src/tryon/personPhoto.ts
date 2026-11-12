import sharp from 'sharp';

export interface PreparedPersonPhoto {
  image: Buffer;
  thumbnail: Buffer;
  width: number;
  height: number;
  sharpness: number;
  sharpOk: boolean;
}

export class PersonPhotoError extends Error {
  constructor(
    public readonly code: 'unsupported_format' | 'too_small' | 'too_large' | 'corrupt',
    message: string,
  ) {
    super(message);
  }
}

const SUPPORTED = new Set(['jpeg', 'png', 'webp', 'avif']);
const MIN_SHORT_EDGE = 384;
const MIN_LONG_EDGE = 512;
const MAX_PIXELS = 40_000_000;
/** Laplacian variance on a 512 px greyscale copy; below this the photo is too blurry. */
export const MIN_SHARPNESS = 25;

/** Validates and normalises a try-on photo: orientation applied, metadata stripped, ≤ 2048 px. */
export async function preparePersonPhoto(data: Buffer): Promise<PreparedPersonPhoto> {
  const input = () => sharp(data, { limitInputPixels: MAX_PIXELS, failOn: 'error' });
  let meta: sharp.Metadata;
  try {
    meta = await input().metadata();
  } catch {
    throw new PersonPhotoError('unsupported_format', 'The file isn’t a supported photo (JPEG, PNG, WebP or AVIF).');
  }
  if (!meta.format || !SUPPORTED.has(meta.format)) throw new PersonPhotoError('unsupported_format', 'The file isn’t a supported photo (JPEG, PNG, WebP or AVIF).');
  const swapped = (meta.orientation ?? 1) >= 5;
  const width = (swapped ? meta.height : meta.width) ?? 0;
  const height = (swapped ? meta.width : meta.height) ?? 0;
  if (width * height > MAX_PIXELS) throw new PersonPhotoError('too_large', 'The photo has too many pixels.');
  if (Math.min(width, height) < MIN_SHORT_EDGE || Math.max(width, height) < MIN_LONG_EDGE) {
    throw new PersonPhotoError('too_small', `The photo is too small (at least ${MIN_SHORT_EDGE} × ${MIN_LONG_EDGE} px).`);
  }
  try {
    const [full, thumbnail, sharpness] = await Promise.all([
      input().rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).webp({ quality: 90 }).toBuffer({ resolveWithObject: true }),
      input().rotate().resize({ width: 320, height: 320, fit: 'inside' }).webp({ quality: 80 }).toBuffer(),
      laplacianVariance(input().rotate()),
    ]);
    return { image: full.data, thumbnail, width: full.info.width, height: full.info.height, sharpness, sharpOk: sharpness >= MIN_SHARPNESS };
  } catch {
    throw new PersonPhotoError('corrupt', 'The photo couldn’t be read — it may be damaged.');
  }
}

async function laplacianVariance(img: sharp.Sharp): Promise<number> {
  const { data, info } = await img
    .greyscale()
    .resize({ width: 512, height: 512, fit: 'inside' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = data[i - w]! + data[i + w]! + data[i - 1]! + data[i + 1]! - 4 * data[i]!;
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  const mean = sum / n;
  return Math.round((sumSq / n - mean * mean) * 10) / 10;
}
