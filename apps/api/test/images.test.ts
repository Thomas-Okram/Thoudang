import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { preprocessImage, MAX_LONG_EDGE } from '../src/services/images.js';
import { makeImage } from './helpers.js';

describe('preprocessImage', () => {
  it('fits the long edge to 2576px and outputs JPEG', async () => {
    const big = await makeImage('#eeeeee', 4000, 3000);
    const out = await preprocessImage(big);
    expect(out.width).toBe(MAX_LONG_EDGE);
    expect(out.height).toBe(Math.round((3000 * MAX_LONG_EDGE) / 4000));
    expect(out.mediaType).toBe('image/jpeg');
    expect((await sharp(out.buffer).metadata()).format).toBe('jpeg');
  });

  it('never enlarges small images', async () => {
    const out = await preprocessImage(await makeImage('#ffffff', 640, 480));
    expect([out.width, out.height]).toEqual([640, 480]);
  });

  it('applies EXIF orientation (phone photos)', async () => {
    const raw = await sharp({
      create: { width: 300, height: 100, channels: 3, background: '#fff' },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const out = await preprocessImage(raw);
    expect([out.width, out.height]).toEqual([100, 300]);
  });

  it('is deterministic (stable SHA-256 cache key)', async () => {
    const img = await makeImage('#abcdef');
    expect((await preprocessImage(img)).sha256).toBe((await preprocessImage(img)).sha256);
    expect((await preprocessImage(img)).sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects non-images', async () => {
    await expect(preprocessImage(Buffer.from('not an image'))).rejects.toThrow();
  });
});
