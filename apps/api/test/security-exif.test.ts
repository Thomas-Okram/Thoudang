import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { countGps, stripGps } from '../src/security/exif.js';
import { sniff } from '../src/security/magic.js';

/** Distinctive GPS rational (12.34″ → 1234/100) so we can also look for its raw bytes. */
const GPS = {
  GPSLatitudeRef: 'N',
  GPSLatitude: '24/1 49/1 1234/100',
  GPSLongitudeRef: 'E',
  GPSLongitude: '93/1 56/1 0/1',
};

async function withGps(format: 'jpeg' | 'png' | 'webp') {
  return sharp({ create: { width: 64, height: 48, channels: 3, background: '#88aacc' } })
    .withExif({ IFD0: { Make: 'SpecimenCam' }, IFD3: GPS })
    .withMetadata({ orientation: 6 })
    [format]()
    .toBuffer();
}

describe('magic-byte sniffing', () => {
  it('recognises JPEG / PNG / WebP / HEIC / ZIP and nothing else', async () => {
    expect(sniff(await withGps('jpeg'))).toBe('jpeg');
    expect(sniff(await withGps('png'))).toBe('png');
    expect(sniff(await withGps('webp'))).toBe('webp');
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic', 'latin1')]);
    expect(sniff(Buffer.concat([heic, Buffer.alloc(16)]))).toBe('heic');
    expect(sniff(Buffer.from('PK\x03\x04rest', 'latin1'))).toBe('zip');
    expect(sniff(Buffer.from('<?php echo 1; ?>'))).toBeNull();
    expect(sniff(Buffer.from('GIF89a......'))).toBeNull();
    expect(sniff(Buffer.from('II*\0 tiff'))).toBeNull();
    const avif = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypavif', 'latin1')]);
    expect(sniff(Buffer.concat([avif, Buffer.alloc(16)]))).toBeNull();
  });
});

describe('stripGps', () => {
  for (const format of ['jpeg', 'png', 'webp'] as const) {
    it(`removes EXIF GPS from ${format} losslessly and keeps orientation`, async () => {
      const original = await withGps(format);
      expect(countGps(original)).toBeGreaterThan(0);
      const { buffer, removed } = stripGps(original);
      expect(removed).toBeGreaterThan(0);
      expect(countGps(buffer)).toBe(0);
      expect(buffer.length).toBe(original.length); // in-place, nothing re-encoded
      const meta = await sharp(buffer).metadata();
      expect(meta.orientation).toBe(6);
      // Pixels are identical and the image still decodes.
      const [a, b] = await Promise.all([
        sharp(original).raw().toBuffer(),
        sharp(buffer).raw().toBuffer(),
      ]);
      expect(b.equals(a)).toBe(true);
    });
  }

  it('blanks XMP exif:GPS values', () => {
    const xmp =
      '<x:xmpmeta><rdf:Description exif:GPSLatitude="24,49.2N" exif:GPSLongitude="93,56.0E">' +
      '<exif:GPSAltitude>790/1</exif:GPSAltitude></rdf:Description></x:xmpmeta>';
    const seg = Buffer.concat([Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1'), Buffer.from(xmp)]);
    const len = Buffer.alloc(2);
    len.writeUInt16BE(seg.length + 2);
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe1]),
      len,
      seg,
      Buffer.from([0xff, 0xd9]),
    ]);
    expect(countGps(jpeg)).toBe(3);
    const { buffer } = stripGps(jpeg);
    expect(countGps(buffer)).toBe(0);
    expect(buffer.toString('latin1')).not.toContain('24,49.2N');
    expect(buffer.toString('latin1')).not.toContain('790/1');
  });

  it('leaves images without GPS byte-identical', async () => {
    const plain = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#fff' },
    })
      .jpeg()
      .toBuffer();
    const { buffer, removed } = stripGps(plain);
    expect(removed).toBe(0);
    expect(buffer.equals(plain)).toBe(true);
  });
});
