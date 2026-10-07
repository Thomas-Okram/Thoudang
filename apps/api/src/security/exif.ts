import zlib from 'node:zlib';
import { sniff } from './magic.js';

/**
 * Lossless GPS scrubbing for stored originals. The image data is NOT re-encoded and every other
 * metadata tag (notably Orientation, which preprocessing needs) is kept: only the EXIF GPS IFD is
 * emptied and XMP exif:GPS* values are blanked, in place, so no offsets move.
 *
 * JPEG (APP1 Exif/XMP), PNG (eXIf / iTXt XMP, CRCs recomputed), WebP (EXIF / XMP chunks) are
 * parsed structurally; HEIC is scanned for the "Exif\0\0" + TIFF header marker and XMP packets.
 * Anything malformed is left untouched rather than risk corrupting the image.
 */

const TAG_GPS_IFD = 0x8825;
/** Bytes per value for each TIFF field type (BYTE, ASCII, SHORT, LONG, RATIONAL, …). */
const TYPE_SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8] as const;

interface Tiff {
  buf: Buffer;
  start: number;
  end: number;
  le: boolean;
}

const u16 = (t: Tiff, off: number) =>
  t.le ? t.buf.readUInt16LE(t.start + off) : t.buf.readUInt16BE(t.start + off);
const u32 = (t: Tiff, off: number) =>
  t.le ? t.buf.readUInt32LE(t.start + off) : t.buf.readUInt32BE(t.start + off);
const inBounds = (t: Tiff, off: number, len: number) =>
  off >= 0 && len >= 0 && t.start + off + len <= t.end;

function openTiff(buf: Buffer, start: number, end: number): Tiff | null {
  if (start + 8 > end) return null;
  const order = buf.toString('latin1', start, start + 2);
  if (order !== 'II' && order !== 'MM') return null;
  const t: Tiff = { buf, start, end, le: order === 'II' };
  return u16(t, 2) === 42 ? t : null;
}

/** Offset of the GPS IFD (relative to the TIFF header) or null. */
function gpsIfdOffset(t: Tiff): number | null {
  const ifd0 = u32(t, 4);
  if (!inBounds(t, ifd0, 2)) return null;
  const n = u16(t, ifd0);
  if (n > 1000 || !inBounds(t, ifd0 + 2, n * 12)) return null;
  for (let i = 0; i < n; i++) {
    const e = ifd0 + 2 + i * 12;
    if (u16(t, e) === TAG_GPS_IFD) {
      const off = u32(t, e + 8);
      return inBounds(t, off, 2) ? off : null;
    }
  }
  return null;
}

/** Number of tags in the GPS IFD (0 when absent or already scrubbed). */
function gpsTagCount(t: Tiff): number {
  const off = gpsIfdOffset(t);
  return off === null ? 0 : u16(t, off);
}

/** Zeroes every GPS value (inline and out-of-line) and empties the GPS IFD. Returns tags removed. */
function scrubTiff(t: Tiff): number {
  const off = gpsIfdOffset(t);
  if (off === null) return 0;
  const n = u16(t, off);
  if (n === 0 || n > 200 || !inBounds(t, off + 2, n * 12 + 4)) return 0;
  for (let i = 0; i < n; i++) {
    const e = off + 2 + i * 12;
    const size = (TYPE_SIZE[u16(t, e + 2)] || 1) * u32(t, e + 4);
    if (size > 4) {
      const dataOff = u32(t, e + 8);
      if (inBounds(t, dataOff, size)) t.buf.fill(0, t.start + dataOff, t.start + dataOff + size);
    }
  }
  // Empty the IFD: count 0, entries and next-IFD pointer zeroed.
  t.buf.fill(0, t.start + off, t.start + off + 2 + n * 12 + 4);
  return n;
}

const XMP_ATTR = /(exif:GPS\w+\s*=\s*")([^"]*)(")/g;
const XMP_ELEM = /(<exif:GPS(\w+)>)([\s\S]*?)(<\/exif:GPS\2>)/g;

/** Blanks exif:GPS* values inside an XMP range with same-length spaces (byte offsets unchanged). */
function scrubXmp(buf: Buffer, start: number, end: number): number {
  const text = buf.toString('latin1', start, end);
  if (!text.includes('exif:GPS')) return 0;
  let hits = 0;
  const blank = (s: string) => ' '.repeat(s.length);
  const out = text
    .replace(XMP_ATTR, (_m, a: string, v: string, z: string) => {
      hits += 1;
      return a + blank(v) + z;
    })
    .replace(XMP_ELEM, (_m, open: string, _n: string, v: string, close: string) => {
      hits += 1;
      return open + blank(v) + close;
    });
  if (hits) buf.write(out, start, 'latin1');
  return hits;
}

const EXIF_HDR = Buffer.from('Exif\0\0', 'latin1');

interface Region {
  kind: 'tiff' | 'xmp';
  start: number;
  end: number;
  /** PNG only: chunk whose CRC must be recomputed. */
  pngChunk?: number;
}

function jpegRegions(buf: Buffer): Region[] {
  const out: Region[] = [];
  let p = 2;
  while (p + 4 <= buf.length && buf[p] === 0xff) {
    const marker = buf[p + 1]!;
    if (marker === 0xd9 || marker === 0xda) break; // EOI / start of scan
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      p += 2;
      continue;
    }
    const len = buf.readUInt16BE(p + 2);
    const data = p + 4;
    const end = Math.min(p + 2 + len, buf.length);
    if (marker === 0xe1) {
      if (buf.subarray(data, data + 6).equals(EXIF_HDR))
        out.push({ kind: 'tiff', start: data + 6, end });
      else if (buf.toString('latin1', data, data + 28).startsWith('http://ns.adobe.com/xap/1.0/'))
        out.push({ kind: 'xmp', start: data, end });
    }
    p += 2 + len;
  }
  return out;
}

function pngRegions(buf: Buffer): Region[] {
  const out: Region[] = [];
  let p = 8;
  while (p + 12 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    const data = p + 8;
    if (data + len + 4 > buf.length) break;
    if (type === 'eXIf') out.push({ kind: 'tiff', start: data, end: data + len, pngChunk: p });
    if (type === 'iTXt' && buf.toString('latin1', data, data + 17) === 'XML:com.adobe.xmp')
      out.push({ kind: 'xmp', start: data, end: data + len, pngChunk: p });
    if (type === 'IEND') break;
    p = data + len + 4;
  }
  return out;
}

function webpRegions(buf: Buffer): Region[] {
  const out: Region[] = [];
  let p = 12;
  while (p + 8 <= buf.length) {
    const type = buf.toString('latin1', p, p + 4);
    const len = buf.readUInt32LE(p + 4);
    const data = p + 8;
    const end = Math.min(data + len, buf.length);
    if (type === 'EXIF') {
      const s = buf.subarray(data, data + 6).equals(EXIF_HDR) ? data + 6 : data;
      out.push({ kind: 'tiff', start: s, end });
    }
    if (type === 'XMP ') out.push({ kind: 'xmp', start: data, end });
    p = data + len + (len % 2);
  }
  return out;
}

function heicRegions(buf: Buffer): Region[] {
  const out: Region[] = [];
  for (let i = buf.indexOf(EXIF_HDR); i >= 0; i = buf.indexOf(EXIF_HDR, i + 1)) {
    if (openTiff(buf, i + 6, buf.length)) out.push({ kind: 'tiff', start: i + 6, end: buf.length });
  }
  const open = Buffer.from('<x:xmpmeta', 'latin1');
  const close = Buffer.from('</x:xmpmeta>', 'latin1');
  for (let i = buf.indexOf(open); i >= 0; i = buf.indexOf(open, i + 1)) {
    const j = buf.indexOf(close, i);
    if (j > i) out.push({ kind: 'xmp', start: i, end: j + close.length });
  }
  return out;
}

function regionsOf(buf: Buffer): Region[] {
  switch (sniff(buf.subarray(0, 32))) {
    case 'jpeg':
      return jpegRegions(buf);
    case 'png':
      return pngRegions(buf);
    case 'webp':
      return webpRegions(buf);
    case 'heic':
      return heicRegions(buf);
    default:
      return [];
  }
}

/** Returns a copy of the image with GPS removed, and how many GPS tags/values were blanked. */
export function stripGps(input: Buffer): { buffer: Buffer; removed: number } {
  const buf = Buffer.from(input);
  let removed = 0;
  const touchedChunks = new Set<number>();
  for (const r of regionsOf(buf)) {
    let n = 0;
    try {
      if (r.kind === 'tiff') {
        const t = openTiff(buf, r.start, r.end);
        n = t ? scrubTiff(t) : 0;
      } else {
        n = scrubXmp(buf, r.start, r.end);
      }
    } catch {
      n = 0; // malformed metadata — leave as is
    }
    if (n && r.pngChunk !== undefined) touchedChunks.add(r.pngChunk);
    removed += n;
  }
  for (const p of touchedChunks) {
    const len = buf.readUInt32BE(p);
    buf.writeUInt32BE(zlib.crc32(buf.subarray(p + 4, p + 8 + len)) >>> 0, p + 8 + len);
  }
  return { buffer: buf, removed };
}

/** GPS tags + XMP GPS values still present (0 = clean). Used by tests and the upload guard. */
export function countGps(buf: Buffer): number {
  let n = 0;
  for (const r of regionsOf(buf)) {
    try {
      if (r.kind === 'tiff') {
        const t = openTiff(buf, r.start, r.end);
        n += t ? gpsTagCount(t) : 0;
      } else {
        const text = buf.toString('latin1', r.start, r.end);
        for (const m of text.matchAll(XMP_ATTR)) if (m[2]!.trim()) n += 1;
        for (const m of text.matchAll(XMP_ELEM)) if (m[3]!.trim()) n += 1;
      }
    } catch {
      // malformed — counted as nothing readable
    }
  }
  return n;
}
