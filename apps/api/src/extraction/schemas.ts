import { z } from 'zod';
import type { DetectedType } from '../db/schema.js';

/** Bump when prompts/schemas change — part of the cache key, so stale results are not reused. */
export const PROMPT_VERSION = 'v1';

export type ExtractableType = Exclude<DetectedType, 'other'>;
export const EXTRACTABLE_TYPES: readonly ExtractableType[] = [
  'application_form',
  'aadhaar',
  'bank_passbook',
  'epic',
];

export const DOC_FIELDS: Record<ExtractableType, readonly string[]> = {
  application_form: [
    'applicant_name',
    'father_or_husband_name',
    'address',
    'district',
    'category',
    'aadhaar_number',
    'mobile',
    'bank_name',
    'branch',
    'ifsc',
    'account_number',
    'date_of_birth',
    'age',
    'annual_income',
    'signature_present',
    'application_date',
    'marital_status_if_stated',
    'disability_if_stated',
  ],
  aadhaar: ['name', 'dob_or_yob', 'gender', 'aadhaar_number', 'address'],
  bank_passbook: ['account_holder_name', 'account_number', 'ifsc', 'bank_name', 'branch'],
  epic: ['name', 'relative_name', 'epic_number', 'dob_or_age'],
};

const CONFIDENCE = ['high', 'medium', 'low'] as const;
const FIELD_STATUS = ['present', 'blank', 'unreadable'] as const;
const LEGIBILITY = ['good', 'poor'] as const;

/*
 * Wire schemas for output_config.format. Structured outputs allow at most 16 union-typed
 * parameters, so the wire format uses NO unions: value is always a string (empty when not
 * present) with an explicit status, and bbox is an array (empty when unknown). Code converts
 * both to null afterwards. The field object is shared via $defs to keep the grammar small.
 */
const FIELD_DEF = {
  type: 'object',
  properties: {
    value: { type: 'string' },
    status: { type: 'string', enum: [...FIELD_STATUS] },
    confidence: { type: 'string', enum: [...CONFIDENCE] },
    bbox: { type: 'array', items: { type: 'number' } },
  },
  required: ['value', 'status', 'confidence', 'bbox'],
  additionalProperties: false,
} as const;

export const CLASSIFY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    document_type: {
      type: 'string',
      enum: ['application_form', 'aadhaar', 'bank_passbook', 'epic', 'other'],
    },
    confidence: { type: 'string', enum: [...CONFIDENCE] },
    legibility: { type: 'string', enum: [...LEGIBILITY] },
    reason: { type: 'string' },
  },
  required: ['document_type', 'confidence', 'legibility', 'reason'],
  additionalProperties: false,
};

export function extractionSchema(type: ExtractableType): Record<string, unknown> {
  const fields = DOC_FIELDS[type];
  return {
    type: 'object',
    $defs: { field: FIELD_DEF },
    properties: {
      legibility: { type: 'string', enum: [...LEGIBILITY] },
      notes: { type: 'string' },
      fields: {
        type: 'object',
        properties: Object.fromEntries(fields.map((f) => [f, { $ref: '#/$defs/field' }])),
        required: [...fields],
        additionalProperties: false,
      },
    },
    required: ['legibility', 'notes', 'fields'],
    additionalProperties: false,
  };
}

// ---- Runtime validation of what Claude returned ------------------------------------------------

export const ClassifyResponseSchema = z.object({
  document_type: z.enum(['application_form', 'aadhaar', 'bank_passbook', 'epic', 'other']),
  confidence: z.enum(CONFIDENCE),
  legibility: z.enum(LEGIBILITY),
  reason: z.string(),
});
export type ClassifyResponse = z.infer<typeof ClassifyResponseSchema>;

const WireFieldSchema = z.object({
  value: z.string(),
  status: z.enum(FIELD_STATUS),
  confidence: z.enum(CONFIDENCE),
  bbox: z.array(z.number()),
});

export function extractResponseSchema(type: ExtractableType) {
  const shape = Object.fromEntries(DOC_FIELDS[type].map((f) => [f, WireFieldSchema]));
  return z.object({
    legibility: z.enum(LEGIBILITY),
    notes: z.string(),
    fields: z.object(shape),
  });
}

// ---- Normalised, masked shapes used everywhere after the API boundary ---------------------------

export type Confidence = (typeof CONFIDENCE)[number];
export type FieldStatus = (typeof FIELD_STATUS)[number];

export interface ExtractedValue {
  /** null when blank or unreadable. Aadhaar numbers are already masked here. */
  value: string | null;
  status: FieldStatus;
  confidence: Confidence;
  /** [x1, y1, x2, y2] in processed-image pixels, or null. */
  bbox: [number, number, number, number] | null;
}

export interface ExtractedDocument {
  type: ExtractableType;
  legibility: 'good' | 'poor';
  notes: string;
  fields: Record<string, ExtractedValue>;
  /** Present when the document carried an Aadhaar number. The full number is never kept. */
  aadhaar: { masked: string | null; last4: string | null; checksumValid: boolean | null } | null;
}

export interface Classification {
  type: DetectedType;
  confidence: Confidence;
  legibility: 'good' | 'poor';
  reason: string;
}
