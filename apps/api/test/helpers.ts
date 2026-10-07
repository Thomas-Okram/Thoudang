import sharp from 'sharp';
import { verhoeffCheckDigit } from '@thoudang/core';
import type { VisionClient, VisionRequest, VisionResponse } from '../src/services/claude.js';
import { DOC_FIELDS, type ExtractableType } from '../src/extraction/schemas.js';

/** A structurally valid synthetic Aadhaar number (passes Verhoeff). Test data only. */
export const FULL_AADHAAR = (() => {
  const body = '23456789012';
  return body + verhoeffCheckDigit(body);
})();
export const AADHAAR_LAST4 = FULL_AADHAAR.slice(8);

/** Solid-colour JPEG with optional text — distinct colours give distinct SHA-256s. */
export async function makeImage(
  color: string,
  width = 800,
  height = 600,
  text = 'SPECIMEN',
): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="${color}"/>
    <text x="40" y="80" font-size="48" font-family="sans-serif" fill="#000">${text}</text></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}

export interface WireField {
  value: string;
  status: 'present' | 'blank' | 'unreadable';
  confidence: 'high' | 'medium' | 'low';
  bbox: number[];
}

export function wireField(
  value: string | null,
  confidence: 'high' | 'medium' | 'low' = 'high',
): WireField {
  return value === null
    ? { value: '', status: 'blank', confidence, bbox: [] }
    : { value, status: 'present', confidence, bbox: [10, 10, 200, 40] };
}

export function wireDoc(
  type: ExtractableType,
  values: Record<string, string | null>,
  opts: { notes?: string; confidence?: 'high' | 'medium' | 'low' } = {},
) {
  return {
    legibility: 'good' as const,
    notes: opts.notes ?? '',
    fields: Object.fromEntries(
      DOC_FIELDS[type].map((f) => [f, wireField(values[f] ?? null, opts.confidence ?? 'high')]),
    ) as Record<string, WireField>,
  };
}

export function classifyJson(type: string) {
  return { document_type: type, confidence: 'high', legibility: 'good', reason: 'test' };
}

/** Synthetic packet (SPECIMEN data) — includes the FULL Aadhaar number, as Claude would return it. */
export const PACKET: Record<ExtractableType, Record<string, string | null>> = {
  application_form: {
    applicant_name: 'Thokchom Ibemcha Devi',
    father_or_husband_name: 'Thokchom Tomba Singh',
    address: 'Wangkhei Ayangpalli, Imphal East',
    district: 'Imphal East',
    category: 'General',
    aadhaar_number: FULL_AADHAAR,
    mobile: '9876543210',
    bank_name: 'State Bank of India',
    branch: 'Imphal Main',
    ifsc: 'SBIN0001234',
    account_number: '30123456789',
    date_of_birth: '12/05/1948',
    age: '78',
    annual_income: 'Rs. 24,000/-',
    signature_present: 'yes',
    application_date: '20/09/2026',
    marital_status_if_stated: 'Widow',
    disability_if_stated: 'No',
  },
  aadhaar: {
    name: 'Thokchom Ibemcha Devi',
    dob_or_yob: '12/05/1948',
    gender: 'Female',
    aadhaar_number: `${FULL_AADHAAR.slice(0, 4)} ${FULL_AADHAAR.slice(4, 8)} ${FULL_AADHAAR.slice(8)}`,
    address: 'Wangkhei, Imphal East, Manipur',
  },
  bank_passbook: {
    account_holder_name: 'THOKCHOM IBEMCHA DEVI',
    account_number: '30123456789',
    ifsc: 'SBIN0001234',
    bank_name: 'State Bank of India',
    branch: 'Imphal Main',
  },
  epic: {
    name: 'Thokchom Ibemcha Devi',
    relative_name: 'Thokchom Tomba Singh',
    epic_number: 'MNP1234567',
    dob_or_age: 'Age as on 01.01.2024: 75',
  },
};

type Handler = (req: VisionRequest) => unknown | Promise<unknown>;

/** In-memory VisionClient. `handler` returns the JSON Claude would; throw to simulate failure. */
export class FakeVision implements VisionClient {
  readonly model = 'claude-sonnet-5-5';
  calls: VisionRequest[] = [];
  inFlight = 0;
  maxInFlight = 0;
  constructor(
    private handler: Handler,
    private delayMs = 0,
  ) {}
  async call(req: VisionRequest): Promise<VisionResponse> {
    this.calls.push(req);
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
      const json = await this.handler(req);
      return { json, model: this.model, latencyMs: 1234, inputTokens: 1500, outputTokens: 400 };
    } finally {
      this.inFlight -= 1;
    }
  }
}

/** Routes by the request label (original file name): "aadhaar.jpg" → aadhaar, etc. */
export function packetVision(
  overrides: Partial<Record<ExtractableType, Record<string, string | null>>> = {},
  delayMs = 0,
) {
  const typeOf = (label = ''): ExtractableType | 'other' => {
    if (label.includes('form')) return 'application_form';
    if (label.includes('aadhaar')) return 'aadhaar';
    if (label.includes('passbook')) return 'bank_passbook';
    if (label.includes('epic')) return 'epic';
    return 'other';
  };
  return new FakeVision((req) => {
    const type = typeOf(req.label);
    if (req.stage === 'classify') return classifyJson(type);
    if (type === 'other') throw new Error('should not extract "other"');
    return wireDoc(
      type,
      { ...PACKET[type], ...(overrides[type] ?? {}) },
      {
        notes: type === 'aadhaar' ? `Number read: ${FULL_AADHAAR}` : '',
      },
    );
  }, delayMs);
}
