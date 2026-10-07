import crypto from 'node:crypto';
import sharp from 'sharp';

/** Claude vision limit we design for: long edge ≤ 2576px. */
export const MAX_LONG_EDGE = 2576;
export const JPEG_QUALITY = 85;

export interface ProcessedImage {
  buffer: Buffer;
  width: number;
  height: number;
  /** SHA-256 hex of the processed JPEG — the extraction cache key. */
  sha256: string;
  mediaType: 'image/jpeg';
}

/** EXIF auto-rotate → fit inside 2576×2576 (never enlarge) → JPEG q85. Deterministic. */
export async function preprocessImage(input: Buffer): Promise<ProcessedImage> {
  const { data, info } = await sharp(input, { failOn: 'error' })
    .rotate()
    .resize({
      width: MAX_LONG_EDGE,
      height: MAX_LONG_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: false })
    .toBuffer({ resolveWithObject: true });
  return {
    buffer: data,
    width: info.width,
    height: info.height,
    sha256: crypto.createHash('sha256').update(data).digest('hex'),
    mediaType: 'image/jpeg',
  };
}
