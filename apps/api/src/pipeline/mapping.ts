import {
  getSchemeRules,
  parseDate,
  type AadhaarFields,
  type DocResult,
  type DocType,
  type EpicFields,
  type ExtractedCase,
  type ExtractedField,
  type FormFields,
  type PassbookFields,
} from '@thoudang/core';
import type { DetectedType } from '../db/schema.js';
import type {
  Confidence,
  ExtractableType,
  ExtractedDocument,
  ExtractedValue,
} from '../extraction/schemas.js';

/** What the pipeline knows about one uploaded image after classification + extraction. */
export type DocOutcome =
  | { kind: 'extracted'; type: ExtractableType; doc: ExtractedDocument }
  | { kind: 'extraction_failed'; type: ExtractableType; error: string }
  /** Classification itself failed (or preprocessing failed) — we don't know what this image was. */
  | { kind: 'unidentified'; error: string }
  | { kind: 'other' };

export const CORE_DOC: Record<ExtractableType, DocType> = {
  application_form: 'form',
  aadhaar: 'aadhaar',
  bank_passbook: 'passbook',
  epic: 'epic',
};
export const DETECTED_FROM_CORE: Record<DocType, ExtractableType> = {
  form: 'application_form',
  aadhaar: 'aadhaar',
  passbook: 'bank_passbook',
  epic: 'epic',
};

/** Claude's verbal confidence → number for the rules engine (threshold 0.75 in config). */
export const CONFIDENCE_SCORE: Record<Confidence, number> = { high: 0.95, medium: 0.8, low: 0.4 };
const UNREADABLE_CONFIDENCE = 0.3;

const READABLE: Record<DocType, string> = {
  form: 'application form',
  aadhaar: 'Aadhaar card',
  passbook: 'bank passbook',
  epic: 'voter ID',
};

type Field<T> = ExtractedField<T>;

const missingField = <T>(): Field<T> => ({ value: null, confidence: 0 });

function conf(v: ExtractedValue): number {
  const c = CONFIDENCE_SCORE[v.confidence];
  return v.status === 'unreadable' ? Math.min(c, UNREADABLE_CONFIDENCE) : c;
}

/** Converts one extracted value. A present-but-unparseable value becomes an unreadable read. */
function convert<T>(v: ExtractedValue | undefined, parse: (s: string) => T | null): Field<T> {
  if (!v) return missingField<T>();
  if (v.value === null) return { value: null, confidence: conf(v) };
  const parsed = parse(v.value);
  return parsed === null
    ? { value: null, confidence: Math.min(conf(v), UNREADABLE_CONFIDENCE) }
    : { value: parsed, confidence: conf(v) };
}

const text = (s: string) => s.trim() || null;
const date = (s: string) => parseDate(s.replace(/^.*?(\d)/, '$1').trim())?.iso ?? null;

export function parseGender(s: string): 'male' | 'female' | 'other' | null {
  const t = s.trim().toLowerCase();
  if (/^(f|female|mahila|woman)\b/.test(t) || t.includes('/ female')) return 'female';
  if (/^(m|male|purush|man)\b/.test(t) || t.includes('/ male')) return 'male';
  if (/^(t|transgender|other)\b/.test(t)) return 'other';
  return null;
}

export function parseIncome(s: string): number | null {
  const t = s.trim().toLowerCase();
  if (/^(nil|none|no income|0+)\b/.test(t)) return 0;
  const digits = t.replace(/(rs\.?|inr|₹|\/-|,|\s)/g, '').match(/^\d+(\.\d+)?/);
  return digits ? Number(digits[0]) : null;
}

export function parseYesNo(s: string): boolean | null {
  const t = s.trim().toLowerCase();
  if (/^(no|nil|none|n\/a|na|not applicable|-)\b/.test(t) || t === 'no') return false;
  if (
    /^(yes|y|true)\b/.test(t) ||
    /\d+\s*%/.test(t) ||
    /(locomotor|blind|deaf|disab|pwd)/.test(t)
  ) {
    return true;
  }
  return null;
}

export function parseMaritalStatus(s: string): FormFields['maritalStatus']['value'] {
  const t = s.trim().toLowerCase();
  if (/widow/.test(t)) return 'widowed';
  if (/unmarried|single|spinster|bachelor/.test(t)) return 'unmarried';
  if (/divorc/.test(t)) return 'divorced';
  if (/separat/.test(t)) return 'separated';
  if (/married/.test(t)) return 'married';
  return null;
}

/**
 * Relief-camp addresses mark internally displaced persons (2023 Manipur violence) — used only
 * for queue priority, never for eligibility. The form has no explicit IDP field.
 */
export function inferDisplaced(address: ExtractedValue | undefined): Field<boolean> {
  if (!address || address.value === null) return { value: null, confidence: 1 };
  return { value: /relief\s*camp/i.test(address.value), confidence: conf(address) };
}

/** Several images of the same type (e.g. 2-page form, Aadhaar front+back) → best value per field. */
export function mergeDocuments(docs: ExtractedDocument[]): ExtractedDocument {
  const [first, ...rest] = docs;
  if (!first) throw new Error('mergeDocuments needs at least one document');
  const rank = (v: ExtractedValue) =>
    (v.value !== null ? 10 : 0) + { high: 3, medium: 2, low: 1 }[v.confidence];
  const fields = { ...first.fields };
  for (const d of rest) {
    for (const [k, v] of Object.entries(d.fields)) {
      const current = fields[k];
      if (!current || rank(v) > rank(current)) fields[k] = v;
    }
  }
  const aadhaar = docs.map((d) => d.aadhaar).find((a) => a?.last4) ?? first.aadhaar;
  return {
    ...first,
    fields,
    aadhaar,
    legibility: docs.some((d) => d.legibility === 'poor') ? 'poor' : 'good',
    notes: docs
      .map((d) => d.notes)
      .filter(Boolean)
      .join(' | '),
  };
}

function formFields(d: ExtractedDocument): FormFields {
  const f = d.fields;
  return {
    applicantName: convert(f.applicant_name, text),
    fatherOrHusbandName: convert(f.father_or_husband_name, text),
    dob: convert(f.date_of_birth, date),
    gender: missingField(), // the MOAPS form has no gender field
    maritalStatus: convert(f.marital_status_if_stated, parseMaritalStatus),
    annualIncome: convert(f.annual_income, parseIncome),
    address: convert(f.address, text),
    district: convert(f.district, text),
    disability: convert(f.disability_if_stated, parseYesNo),
    internallyDisplaced: inferDisplaced(f.address),
    bankAccountNumber: convert(f.account_number, text),
    ifsc: convert(f.ifsc, text),
    applicationDate: convert(f.application_date, date),
  };
}

function aadhaarFields(d: ExtractedDocument): AadhaarFields {
  const f = d.fields;
  const numberConf = f.aadhaar_number ? conf(f.aadhaar_number) : 0;
  return {
    name: convert(f.name, text),
    dob: convert(f.dob_or_yob, date),
    gender: convert(f.gender, parseGender),
    maskedNumber: { value: d.aadhaar?.masked ?? null, confidence: numberConf },
    last4: { value: d.aadhaar?.last4 ?? null, confidence: numberConf },
    checksumValid: d.aadhaar?.checksumValid ?? null,
  };
}

function passbookFields(d: ExtractedDocument): PassbookFields {
  const f = d.fields;
  return {
    accountHolderName: convert(f.account_holder_name, text),
    accountNumber: convert(f.account_number, text),
    ifsc: convert(f.ifsc, text),
    bankName: convert(f.bank_name, text),
    branch: convert(f.branch, text),
  };
}

function epicFields(d: ExtractedDocument): EpicFields {
  const f = d.fields;
  const dobRaw = f.dob_or_age;
  // "Age as on …: 72" is an age, not a date of birth — never converted into a DOB.
  const dob: Field<string> =
    dobRaw?.value && /age/i.test(dobRaw.value)
      ? { value: null, confidence: 1 }
      : convert(dobRaw, date);
  return {
    name: convert(f.name, text),
    epicNumber: convert(f.epic_number, text),
    relativeName: convert(f.relative_name, text),
    dob,
    gender: missingField(),
  };
}

const BUILDERS = {
  application_form: formFields,
  aadhaar: aadhaarFields,
  bank_passbook: passbookFields,
  epic: epicFields,
} as const;

/** Pipeline outcomes → rules-engine input. Pure; unit-tested. */
export function toExtractedCase(
  caseId: string,
  receivedAt: Date,
  outcomes: DocOutcome[],
): ExtractedCase {
  const documents: ExtractedCase['documents'] = {};
  const byType = new Map<ExtractableType, { docs: ExtractedDocument[]; errors: string[] }>();
  for (const o of outcomes) {
    if (o.kind !== 'extracted' && o.kind !== 'extraction_failed') continue;
    const entry = byType.get(o.type) ?? { docs: [], errors: [] };
    if (o.kind === 'extracted') entry.docs.push(o.doc);
    else entry.errors.push(o.error);
    byType.set(o.type, entry);
  }

  for (const [type, { docs, errors }] of byType) {
    const coreType = CORE_DOC[type];
    const result: DocResult<unknown> = docs.length
      ? { status: 'ok', fields: BUILDERS[type](mergeDocuments(docs)) }
      : { status: 'failed', error: errors[0] ?? 'extraction failed' };
    (documents as Record<DocType, DocResult<unknown>>)[coreType] = result;
  }

  // An image we could not identify might be the "missing" document — never tell the citizen a
  // document is missing in that case; route to the officer instead.
  const unidentified = outcomes.filter(
    (o): o is Extract<DocOutcome, { kind: 'unidentified' }> => o.kind === 'unidentified',
  );
  if (unidentified.length) {
    const rules = getSchemeRules();
    const why = unidentified[0]!.error;
    for (const coreType of rules.requiredDocuments) {
      if (!documents[coreType]) {
        (documents as Record<DocType, DocResult<unknown>>)[coreType] = {
          status: 'failed',
          error: `${unidentified.length} uploaded image(s) could not be read — ${why}; the ${READABLE[coreType]} may be among them`,
        };
      }
    }
  }

  return { caseId, receivedAt: receivedAt.toISOString(), documents };
}

export type { DetectedType };
