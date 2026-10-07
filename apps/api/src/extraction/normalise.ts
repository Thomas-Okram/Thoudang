import { maskAadhaar, processAadhaarNumber, redactAadhaarInText } from '@thoudang/core';
import type { ExtractableType, ExtractedDocument, ExtractedValue } from './schemas.js';

interface WireField {
  value: string;
  status: 'present' | 'blank' | 'unreadable';
  confidence: 'high' | 'medium' | 'low';
  bbox: number[];
}

interface WireExtraction {
  legibility: 'good' | 'poor';
  notes: string;
  fields: Record<string, WireField>;
}

/** Account numbers are exempt from free-text redaction: a 12-digit account number is legitimate. */
const REDACTION_EXEMPT = new Set(['account_number', 'aadhaar_number']);
const PRINTED_MASK = /^[Xx*•]{4}[\s-]?[Xx*•]{4}[\s-]?(\d{4})$/;

function toBbox(raw: number[], width: number, height: number): ExtractedValue['bbox'] {
  if (raw.length !== 4 || raw.some((n) => !Number.isFinite(n))) return null;
  const clamp = (n: number, max: number) => Math.max(0, Math.min(max, Math.round(n)));
  const [x1, y1, x2, y2] = [
    clamp(raw[0]!, width),
    clamp(raw[1]!, height),
    clamp(raw[2]!, width),
    clamp(raw[3]!, height),
  ];
  return x2 > x1 && y2 > y1 ? [x1, y1, x2, y2] : null;
}

/**
 * Wire format → normalised document, with the Aadhaar number masked IMMEDIATELY.
 * The returned object never contains a full Aadhaar number (checked by tests).
 */
export function normaliseExtraction(
  type: ExtractableType,
  wire: WireExtraction,
  image: { width: number; height: number },
): ExtractedDocument {
  const fields: Record<string, ExtractedValue> = {};
  let aadhaar: ExtractedDocument['aadhaar'] = null;

  for (const [name, f] of Object.entries(wire.fields)) {
    const trimmed = f.value.trim();
    let value: string | null = f.status === 'present' && trimmed !== '' ? trimmed : null;
    const status = f.status === 'present' && value === null ? 'blank' : f.status;

    if (name === 'aadhaar_number') {
      if (value !== null) {
        const printedMask = PRINTED_MASK.exec(value);
        if (printedMask) {
          aadhaar = {
            masked: `XXXX XXXX ${printedMask[1]}`,
            last4: printedMask[1]!,
            checksumValid: null,
          };
        } else {
          const p = processAadhaarNumber(value);
          aadhaar = {
            masked: p.masked,
            last4: p.last4,
            checksumValid: p.masked ? p.checksumValid : false,
          };
        }
        value = aadhaar.masked ?? maskAadhaar(value) ?? '[unreadable Aadhaar number]';
      } else if (!aadhaar) {
        aadhaar = { masked: null, last4: null, checksumValid: null };
      }
    } else if (value !== null && !REDACTION_EXEMPT.has(name)) {
      value = redactAadhaarInText(value);
    }

    fields[name] = {
      value,
      status,
      confidence: f.confidence,
      bbox: toBbox(f.bbox, image.width, image.height),
    };
  }

  return {
    type,
    legibility: wire.legibility,
    notes: redactAadhaarInText(wire.notes.trim()),
    fields,
    aadhaar,
  };
}
