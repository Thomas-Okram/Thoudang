import fs from 'node:fs';

/** The ONLY image formats accepted at intake (checked by file content, never by name/MIME). */
export type ImageKind = 'jpeg' | 'png' | 'webp' | 'heic';
export type SniffedKind = ImageKind | 'zip';

export const KIND_MIME: Record<ImageKind, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
};
export const KIND_EXTS: Record<ImageKind, readonly string[]> = {
  jpeg: ['.jpg', '.jpeg'],
  png: ['.png'],
  webp: ['.webp'],
  heic: ['.heic', '.heif'],
};

/** ISO-BMFF major brands for HEIC/HEIF still images (not AVIF, not video). */
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

export function sniff(head: Buffer): SniffedKind | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  if (
    head.length >= 8 &&
    head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'png';
  if (
    head.length >= 12 &&
    head.toString('latin1', 0, 4) === 'RIFF' &&
    head.toString('latin1', 8, 12) === 'WEBP'
  )
    return 'webp';
  if (
    head.length >= 12 &&
    head.toString('latin1', 4, 8) === 'ftyp' &&
    HEIF_BRANDS.has(head.toString('latin1', 8, 12))
  )
    return 'heic';
  if (head.length >= 4 && head.readUInt32BE(0) === 0x504b0304) return 'zip';
  return null;
}

export function sniffFile(file: string): SniffedKind | null {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(32);
    const n = fs.readSync(fd, head, 0, 32, 0);
    return sniff(head.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
}
