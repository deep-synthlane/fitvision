import sharp from 'sharp';

const base = () => sharp({ create: { width: 60, height: 90, channels: 3, background: '#8a7f75' } });

/** Small real images for scan uploads (the API decodes and re-encodes every scan photo). */
export const SCAN_JPEG = await base().jpeg().toBuffer();
export const SCAN_PNG = await base().png().toBuffer();
/** A JPEG carrying EXIF metadata, to check it is stripped. */
export const SCAN_JPEG_WITH_EXIF = await base()
  .jpeg()
  .withExif({ IFD0: { Copyright: 'exif-marker-should-be-removed', Artist: 'exif-marker-should-be-removed' } })
  .toBuffer();
