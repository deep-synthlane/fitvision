import type { CaptureCheck, Pixels } from './types';

/** Thresholds are heuristics tuned for phone/laptop photos downsampled to ~256 px wide. */
export const QUALITY = {
  analysisWidth: 256,
  minMeanLuma: 70,
  maxMeanLuma: 215,
  maxClippedFraction: 0.3,
  minSharpness: 30,
};

/** Downsampled greyscale (Rec. 601 luma, 0–255) using box averaging. */
export function toGrey(img: Pixels, targetWidth = QUALITY.analysisWidth) {
  const scale = Math.max(1, Math.floor(img.width / targetWidth));
  const w = Math.floor(img.width / scale);
  const h = Math.floor(img.height / scale);
  const grey = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const i = ((y * scale + dy) * img.width + (x * scale + dx)) * 4;
          sum += 0.299 * img.data[i]! + 0.587 * img.data[i + 1]! + 0.114 * img.data[i + 2]!;
        }
      }
      grey[y * w + x] = sum / (scale * scale);
    }
  }
  return { width: w, height: h, grey };
}

export function lumaStats(grey: Float32Array) {
  let sum = 0;
  let clipped = 0;
  for (const v of grey) {
    sum += v;
    if (v > 245) clipped++;
  }
  return { mean: sum / grey.length, clippedFraction: clipped / grey.length };
}

/** Variance of the 4-neighbour Laplacian; low values mean a blurry image. */
export function laplacianVariance(grey: Float32Array, width: number, height: number): number {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const lap = grey[i - width]! + grey[i + width]! + grey[i - 1]! + grey[i + 1]! - 4 * grey[i]!;
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

export function assessImageQuality(img: Pixels): CaptureCheck[] {
  const { width, height, grey } = toGrey(img);
  const { mean, clippedFraction } = lumaStats(grey);
  const sharpness = laplacianVariance(grey, width, height);

  const lighting: CaptureCheck =
    mean < QUALITY.minMeanLuma
      ? { id: 'lighting', label: 'Lighting', status: 'fail', message: 'Too dark — move to a brighter spot or turn on more lights.' }
      : mean > QUALITY.maxMeanLuma || clippedFraction > QUALITY.maxClippedFraction
        ? { id: 'lighting', label: 'Lighting', status: 'fail', message: 'Too bright — avoid facing a window or strong light.' }
        : { id: 'lighting', label: 'Lighting', status: 'pass' };

  const sharp: CaptureCheck =
    sharpness < QUALITY.minSharpness
      ? { id: 'sharpness', label: 'Sharpness', status: 'fail', message: 'Photo is blurry — keep the camera steady and stand still.' }
      : { id: 'sharpness', label: 'Sharpness', status: 'pass' };

  return [lighting, sharp];
}
