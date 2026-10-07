import fs from 'node:fs';
import sharp from 'sharp';
import type { DetectedType } from '../db/schema.js';
import type { ExtractedDocument } from '../extraction/schemas.js';

export type RedactionMode = 'bbox' | 'blur' | 'none';
export interface Redaction {
  mode: RedactionMode;
  bbox?: [number, number, number, number];
}

const PAD = 10;

/**
 * Decides how an image must be masked before it leaves the server.
 * - Aadhaar card: black box over the number; if its location is unknown, blur the whole card.
 * - Application form: same, when the form carries an Aadhaar number (or could not be read).
 * - Anything else: shown as is.
 */
export function redactionFor(
  detectedType: DetectedType | null,
  extraction: Pick<ExtractedDocument, 'fields'> | null,
  size: { width: number; height: number },
): Redaction {
  const field = extraction?.fields.aadhaar_number;
  const carriesNumber =
    detectedType === 'aadhaar' ||
    (detectedType === 'application_form' && (!extraction || (field?.value ?? null) !== null));
  if (!carriesNumber) return { mode: 'none' };
  if (field?.bbox) {
    const [x1, y1, x2, y2] = field.bbox;
    return {
      mode: 'bbox',
      bbox: [
        Math.max(0, x1 - PAD),
        Math.max(0, y1 - PAD),
        Math.min(size.width, x2 + PAD),
        Math.min(size.height, y2 + PAD),
      ],
    };
  }
  return { mode: 'blur' };
}

/** Applies the redaction to the processed JPEG. Optional width → thumbnail. */
export async function renderRedacted(
  processedPath: string,
  redaction: Redaction,
  size: { width: number; height: number },
  thumbWidth?: number,
): Promise<Buffer> {
  let img = sharp(fs.readFileSync(processedPath));
  if (redaction.mode === 'bbox' && redaction.bbox) {
    const [x1, y1, x2, y2] = redaction.bbox;
    const box = `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}">
      <rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" fill="#000"/></svg>`;
    img = sharp(await img.composite([{ input: Buffer.from(box), top: 0, left: 0 }]).toBuffer());
  } else if (redaction.mode === 'blur') {
    const fontSize = Math.round(size.width / 22);
    const label = `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}">
      <rect x="0" y="${size.height / 2 - fontSize}" width="${size.width}" height="${fontSize * 2}" fill="#0A1B33" fill-opacity="0.85"/>
      <text x="${size.width / 2}" y="${size.height / 2 + fontSize / 3}" font-family="Helvetica, Arial, sans-serif"
        font-size="${fontSize}" font-weight="700" fill="#fff" text-anchor="middle">SPECIMEN — Aadhaar masked</text></svg>`;
    img = sharp(
      await img
        .blur(Math.max(12, size.width / 60))
        .composite([{ input: Buffer.from(label), top: 0, left: 0 }])
        .toBuffer(),
    );
  }
  if (thumbWidth) img = img.resize({ width: thumbWidth, height: thumbWidth, fit: 'inside' });
  return img.jpeg({ quality: thumbWidth ? 75 : 88 }).toBuffer();
}
