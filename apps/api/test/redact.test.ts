import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { redactionFor, renderRedacted } from '../src/services/redact.js';

const size = { width: 400, height: 200 };
const v = (value: string | null, bbox: [number, number, number, number] | null) => ({
  fields: {
    aadhaar_number: { value, status: 'present' as const, confidence: 'high' as const, bbox },
  },
});

describe('Aadhaar image redaction', () => {
  it('boxes the number when its location is known (padded, clamped)', () => {
    expect(redactionFor('aadhaar', v('XXXX XXXX 1234', [100, 120, 300, 160]), size)).toEqual({
      mode: 'bbox',
      bbox: [90, 110, 310, 170],
    });
    expect(redactionFor('aadhaar', v('XXXX XXXX 1234', [0, 0, 400, 200]), size).bbox).toEqual([
      0, 0, 400, 200,
    ]);
  });

  it('blurs the whole card when the location is unknown or extraction failed', () => {
    expect(redactionFor('aadhaar', v('XXXX XXXX 1234', null), size)).toEqual({ mode: 'blur' });
    expect(redactionFor('aadhaar', null, size)).toEqual({ mode: 'blur' });
  });

  it('forms are redacted only when they carry a number; other documents never', () => {
    expect(redactionFor('application_form', v(null, null), size)).toEqual({ mode: 'none' });
    expect(redactionFor('application_form', v('XXXX XXXX 1234', [1, 1, 50, 20]), size).mode).toBe(
      'bbox',
    );
    expect(redactionFor('application_form', null, size)).toEqual({ mode: 'blur' });
    expect(redactionFor('bank_passbook', null, size)).toEqual({ mode: 'none' });
  });

  it('paints the box black on the served image', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'redact-')), 'p.jpg');
    await sharp({ create: { width: 400, height: 200, channels: 3, background: '#ffffff' } })
      .jpeg()
      .toFile(file);
    const out = await renderRedacted(file, { mode: 'bbox', bbox: [100, 50, 300, 150] }, size);
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => data[(y * info.width + x) * info.channels]!;
    expect(px(200, 100)).toBeLessThan(20); // inside the box: black
    expect(px(20, 20)).toBeGreaterThan(235); // outside: untouched white
  });
});
