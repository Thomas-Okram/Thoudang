import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { flatDocuments, generate } from '../src/generate.js';
import { plan } from '../src/plan.js';
import { FORM_BANNER, ID_BANNER } from '../src/render/documents.js';
import { documentFields, DOC_FILES, type DocKey } from '../src/truth.js';

/** Official branding we must never imitate (logos are never drawn; these are the text tells). */
const BANNED = [
  /UIDAI/i,
  /Unique Identification/i,
  /Government of India/i,
  /Govt\.? of India/i,
  /Election Commission/i,
  /\bECI\b/,
  /Reserve Bank/i,
  /Mera Aadhaar/i,
  /Meri Pehchaan/i,
  /Satyameva/i,
  /emblem/i,
  /भारत|सरकार|आधार|निर्वाचन/,
];

const packets = plan({ count: 60, seed: 4242 });

describe('rendered documents ↔ truth', () => {
  it('every non-blank truth value is drawn on its document; blank values are not', () => {
    for (const p of packets) {
      const docs = flatDocuments(p, p.rng.fork('docs'));
      const fields = documentFields(p.spec);
      for (const key of Object.keys(DOC_FILES) as DocKey[]) {
        const values = fields[key];
        const doc = docs[key];
        expect(Boolean(doc), `${p.id} ${key}`).toBe(Boolean(values));
        if (!values || !doc) continue;
        for (const [field, value] of Object.entries(values)) {
          if (field === 'signature_present') continue;
          if (value === null) {
            expect(doc.boxes[field], `${p.id} ${key}.${field} should be blank`).toBeUndefined();
            continue;
          }
          const shown =
            field === 'aadhaar_number'
              ? `${value.slice(0, 4)} ${value.slice(4, 8)} ${value.slice(8)}`
              : value;
          const drawn = field === 'aadhaar_number' && key === 'form' ? value : shown;
          const hit = doc.texts.some((t) => t === drawn || t.toUpperCase() === drawn.toUpperCase());
          expect(hit, `${p.id} ${key}.${field} = ${drawn}`).toBe(true);
          const b = doc.boxes[field];
          expect(b, `${p.id} ${key}.${field} box`).toBeDefined();
          expect(b![0]).toBeGreaterThanOrEqual(0);
          expect(b![2]).toBeLessThanOrEqual(doc.width);
          expect(b![3]).toBeLessThanOrEqual(doc.height);
        }
      }
      if (p.spec.form) {
        const signed = p.spec.form.fields.signature_present === 'yes';
        expect(p.spec.form.signature !== null).toBe(signed);
      }
    }
  });

  it('every document is labelled SPECIMEN and carries no official branding text', () => {
    for (const p of packets) {
      const docs = flatDocuments(p, p.rng.fork('docs'));
      for (const [key, doc] of Object.entries(docs)) {
        const all = doc.texts.join('\n');
        expect(all).toContain('SPECIMEN');
        expect(all).toContain(key === 'form' ? FORM_BANNER : ID_BANNER);
        for (const re of BANNED) expect(re.test(doc.body), `${p.id} ${key} ${re}`).toBe(false);
        expect(/<image\b/.test(doc.body)).toBe(false); // no embedded logos/photos
      }
    }
  });
});

describe('generate() writes packets in the eval-harness layout', () => {
  it('writes images + truth.json + layout.json, deterministically', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'synth-'));
    const a = path.join(tmp, 'a');
    const b = path.join(tmp, 'b');
    try {
      const run = (out: string) => generate({ out, count: 3, seed: 5 });
      const ra = await run(a);
      await run(b);
      for (const w of ra.written) {
        const truth = JSON.parse(fs.readFileSync(path.join(w.dir, 'truth.json'), 'utf8')) as {
          documents: Record<string, unknown>;
        };
        const layout = JSON.parse(
          fs.readFileSync(path.join(w.dir, 'layout.json'), 'utf8'),
        ) as Record<string, Record<string, number[]>>;
        for (const file of Object.keys(truth.documents)) {
          const img = fs.readFileSync(path.join(w.dir, file));
          const meta = await sharp(img).metadata();
          expect(meta.format).toBe('jpeg');
          for (const box of Object.values(layout[file] ?? {})) {
            expect(box[2]!).toBeLessThanOrEqual(meta.width!);
            expect(box[3]!).toBeLessThanOrEqual(meta.height!);
            expect(box[2]! > box[0]! && box[3]! > box[1]!).toBe(true);
          }
          expect(
            img.equals(fs.readFileSync(path.join(b, w.id, file))),
            `${w.id}/${file} identical`,
          ).toBe(true);
        }
        expect(fs.readFileSync(path.join(w.dir, 'truth.json'), 'utf8')).toBe(
          fs.readFileSync(path.join(b, w.id, 'truth.json'), 'utf8'),
        );
      }
      expect(fs.existsSync(path.join(a, 'manifest.json'))).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
