import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import type { GarmentImageError} from '../src/garment/processor.js';
import { SharpGarmentProcessor, isNearDuplicate } from '../src/garment/processor.js';
import { garmentPng } from './fixtures/productSite.js';

const processor = new SharpGarmentProcessor();
const code = async (data: Buffer) => {
  try {
    await processor.prepare(data);
    return null;
  } catch (err) {
    return (err as GarmentImageError).code;
  }
};

describe('garment processor', () => {
  it('rejects non-images, tiny images and pixel bombs', async () => {
    expect(await code(Buffer.from('%PDF-1.7 not an image'))).toBe('unsupported_format');
    expect(await code(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('unsupported_format');
    expect(await code(await garmentPng('#000', 120, 120))).toBe('too_small');
    const huge = await sharp({ create: { width: 8000, height: 6000, channels: 3, background: '#fff' } }).png({ compressionLevel: 9 }).toBuffer();
    expect(await code(huge)).toBe('too_large');
  });

  it('applies EXIF orientation, strips metadata and resizes the try-on copy', async () => {
    // Landscape pixels tagged "rotate 90°": the upright image is portrait.
    const rotated = await sharp(await garmentPng('#123456', 2400, 1800)).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const out = await processor.prepare(rotated);
    expect(out.width).toBeLessThan(out.height);
    expect(Math.max(out.width, out.height)).toBe(1600);
    const meta = await sharp(out.original).metadata();
    expect(meta.width).toBe(1800);
    expect(meta.orientation).toBeUndefined();
    expect(meta.exif).toBeUndefined();
    expect(meta.format).toBe('webp');
  });

  it('detects re-encoded copies as duplicates but not different garments or colours', async () => {
    const a = await processor.prepare(await garmentPng('#1d4ed8'));
    const aJpeg = await processor.prepare(await sharp(await garmentPng('#1d4ed8')).resize(300).jpeg({ quality: 70 }).toBuffer());
    const different = await processor.prepare(
      await sharp({ create: { width: 400, height: 500, channels: 3, background: '#fff' } })
        .composite([{ input: await sharp({ create: { width: 120, height: 500, channels: 3, background: '#000' } }).png().toBuffer(), left: 0, top: 0 }])
        .png()
        .toBuffer(),
    );
    const otherColour = await processor.prepare(await garmentPng('#b91c1c'));
    expect(isNearDuplicate(a.hash, aJpeg.hash)).toBe(true);
    expect(isNearDuplicate(a.hash, different.hash)).toBe(false);
    // Same shape in another colour (common for colour variants) is not a duplicate.
    expect(isNearDuplicate(a.hash, otherColour.hash)).toBe(false);
  });
});
