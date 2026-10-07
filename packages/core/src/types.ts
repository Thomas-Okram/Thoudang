import { z } from 'zod';

/** The ONLY case statuses. There is deliberately no "reject" status. */
export const CaseStatusSchema = z.enum([
  'READY',
  'NEEDS_CITIZEN_CORRECTION',
  'OFFICER_ATTENTION',
  'APPROVED_BY_OFFICER',
]);
export type CaseStatus = z.infer<typeof CaseStatusSchema>;

export const DocTypeSchema = z.enum(['form', 'aadhaar', 'passbook', 'epic']);
export type DocType = z.infer<typeof DocTypeSchema>;

export const SeveritySchema = z.enum(['info', 'warn', 'critical']);
export type Severity = z.infer<typeof SeveritySchema>;

/** Who must act on a flag: the citizen (deficiency notice), the officer, or nobody (informational). */
export const FlagActionSchema = z.enum(['citizen', 'officer', 'none']);
export type FlagAction = z.infer<typeof FlagActionSchema>;

export const FlagEvidenceSchema = z.object({
  document: DocTypeSchema,
  field: z.string(),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  confidence: z.number().min(0).max(1).optional(),
});
export type FlagEvidence = z.infer<typeof FlagEvidenceSchema>;

export const FlagSchema = z.object({
  code: z.string(),
  severity: SeveritySchema,
  action: FlagActionSchema,
  reason: z.string(),
  evidence: z.array(FlagEvidenceSchema),
});
export type Flag = z.infer<typeof FlagSchema>;

/** One extracted value plus the extractor's confidence (0–1). `value: null` means "not present / unreadable". */
const field = <T extends z.ZodType>(value: T) =>
  z.object({ value: value.nullable(), confidence: z.number().min(0).max(1) });

export type ExtractedField<T> = { value: T | null; confidence: number };

/**
 * Dates are ISO `YYYY-MM-DD`, or `YYYY` when a document only carries a year of birth
 * (common on older Aadhaar cards).
 */
const isoDate = z.string().regex(/^\d{4}(-\d{2}-\d{2})?$/, 'Expected YYYY-MM-DD or YYYY');

export const FormFieldsSchema = z.object({
  applicantName: field(z.string()),
  fatherOrHusbandName: field(z.string()),
  dob: field(isoDate),
  gender: field(z.enum(['male', 'female', 'other'])),
  maritalStatus: field(z.enum(['married', 'widowed', 'unmarried', 'divorced', 'separated'])),
  annualIncome: field(z.number()),
  address: field(z.string()),
  district: field(z.string()),
  disability: field(z.boolean()),
  internallyDisplaced: field(z.boolean()),
  bankAccountNumber: field(z.string()),
  ifsc: field(z.string()),
  /** Last 4 digits of the Aadhaar number written on the form (the full number is never kept). */
  aadhaarLast4: field(z.string().regex(/^\d{4}$/)).optional(),
  /** Signature or thumb impression present on the form. */
  signaturePresent: field(z.boolean()).optional(),
  applicationDate: field(isoDate),
});
export type FormFields = z.infer<typeof FormFieldsSchema>;

/** Masked Aadhaar, e.g. "XXXX XXXX 1234". A full 12-digit number can never satisfy this schema. */
export const MaskedAadhaarSchema = z.string().regex(/^XXXX XXXX \d{4}$/);

export const AadhaarFieldsSchema = z.object({
  name: field(z.string()),
  dob: field(isoDate),
  gender: field(z.enum(['male', 'female', 'other'])),
  maskedNumber: field(MaskedAadhaarSchema),
  last4: field(z.string().regex(/^\d{4}$/)),
  /** Verhoeff checksum computed in memory on the full number before it was discarded. */
  checksumValid: z.boolean().nullable(),
});
export type AadhaarFields = z.infer<typeof AadhaarFieldsSchema>;

export const PassbookFieldsSchema = z.object({
  accountHolderName: field(z.string()),
  accountNumber: field(z.string()),
  ifsc: field(z.string()),
  bankName: field(z.string()),
  branch: field(z.string()),
});
export type PassbookFields = z.infer<typeof PassbookFieldsSchema>;

export const EpicFieldsSchema = z.object({
  name: field(z.string()),
  epicNumber: field(z.string()),
  relativeName: field(z.string()),
  dob: field(isoDate),
  gender: field(z.enum(['male', 'female', 'other'])),
});
export type EpicFields = z.infer<typeof EpicFieldsSchema>;

const docResult = <T extends z.ZodType>(fields: T) =>
  z.discriminatedUnion('status', [
    z.object({ status: z.literal('ok'), fields }),
    z.object({ status: z.literal('failed'), error: z.string() }),
  ]);

export const ExtractedCaseSchema = z.object({
  caseId: z.string(),
  /** ISO timestamp when the packet was received — drives "days pending". */
  receivedAt: z.string(),
  documents: z.object({
    form: docResult(FormFieldsSchema).optional(),
    aadhaar: docResult(AadhaarFieldsSchema).optional(),
    passbook: docResult(PassbookFieldsSchema).optional(),
    epic: docResult(EpicFieldsSchema).optional(),
  }),
});
export type ExtractedCase = z.infer<typeof ExtractedCaseSchema>;

export type DocResult<T> = { status: 'ok'; fields: T } | { status: 'failed'; error: string };
