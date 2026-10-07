import crypto from 'node:crypto';
import sharp from 'sharp';
import heicConvert from 'heic-convert';

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

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

/** ISO-BMFF "ftyp" box with a HEIF/HEIC brand (iPhone photos). */
export function isHeic(buf: Buffer): boolean {
  if (buf.length < 12 || buf.toString('ascii', 4, 8) !== 'ftyp') return false;
  return HEIC_BRANDS.has(buf.toString('ascii', 8, 12));
}

/**
 * Returns something sharp can decode. The prebuilt sharp binary has no HEVC decoder, so HEIC
 * is converted to JPEG first (pure-JS libheif via heic-convert).
 */
export async function toDecodable(input: Buffer): Promise<Buffer> {
  if (!isHeic(input)) return input;
  const jpeg = await heicConvert({ buffer: input, format: 'JPEG', quality: 0.92 });
  return Buffer.from(jpeg);
}

/** EXIF auto-rotate → fit inside 2576×2576 (never enlarge) → JPEG q85. Deterministic. */
export async function preprocessImage(input: Buffer): Promise<ProcessedImage> {
  const { data, info } = await sharp(await toDecodable(input), { failOn: 'error' })
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
