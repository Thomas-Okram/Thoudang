import type { CaseDocument, DetectedType, FlagEvidence } from './api';

/** What the document viewer should outline. `field` is the extraction (wire) field name. */
export interface Highlight {
  documentId: string;
  field: string | null;
  /** 'click' also switches tab and zooms to the box; 'hover' only outlines. */
  mode: 'hover' | 'click';
}

const DOC_OF: Record<FlagEvidence['document'], DetectedType> = {
  form: 'application_form',
  aadhaar: 'aadhaar',
  passbook: 'bank_passbook',
  epic: 'epic',
};

/** Rules-engine field names (core) → extraction field names (what has a bbox). */
const FIELD_OF: Record<FlagEvidence['document'], Record<string, string | null>> = {
  form: {
    applicantName: 'applicant_name',
    fatherOrHusbandName: 'father_or_husband_name',
    dob: 'date_of_birth',
    maritalStatus: 'marital_status_if_stated',
    annualIncome: 'annual_income',
    address: 'address',
    district: 'district',
    disability: 'disability_if_stated',
    internallyDisplaced: 'address',
    bankAccountNumber: 'account_number',
    ifsc: 'ifsc',
    applicationDate: 'application_date',
    aadhaarLast4: 'aadhaar_number',
    gender: null,
    document: null,
  },
  aadhaar: {
    name: 'name',
    dob: 'dob_or_yob',
    gender: 'gender',
    maskedNumber: 'aadhaar_number',
    last4: 'aadhaar_number',
    document: null,
  },
  passbook: {
    accountHolderName: 'account_holder_name',
    accountNumber: 'account_number',
    ifsc: 'ifsc',
    bankName: 'bank_name',
    branch: 'branch',
    document: null,
  },
  epic: {
    name: 'name',
    epicNumber: 'epic_number',
    relativeName: 'relative_name',
    dob: 'dob_or_age',
    document: null,
  },
};

export function wireField(e: Pick<FlagEvidence, 'document' | 'field'>): string | null {
  return FIELD_OF[e.document]?.[e.field] ?? null;
}

/** The first document of the evidence's type (multi-image types: prefer one that has the field). */
export function documentFor(
  e: Pick<FlagEvidence, 'document' | 'field'>,
  docs: CaseDocument[],
): CaseDocument | null {
  const type = DOC_OF[e.document];
  const field = wireField(e);
  const ofType = docs.filter((d) => d.detectedType === type);
  return (
    ofType.find((d) => field && d.extraction?.fields[field]?.value != null) ?? ofType[0] ?? null
  );
}

/** Evidence → highlight target; prefers evidence that actually has a bounding box. */
export function highlightForEvidence(
  evidence: FlagEvidence[],
  docs: CaseDocument[],
): Highlight | null {
  const targets = evidence
    .map((e) => {
      const doc = documentFor(e, docs);
      const field = wireField(e);
      return doc
        ? {
            documentId: doc.id,
            field,
            hasBox: Boolean(field && doc.extraction?.fields[field]?.bbox),
          }
        : null;
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);
  const best = targets.find((t) => t.hasBox) ?? targets[0];
  return best ? { documentId: best.documentId, field: best.field, mode: 'click' } : null;
}

export const DOC_SHORT: Record<FlagEvidence['document'], string> = {
  form: 'Form',
  aadhaar: 'Aadhaar',
  passbook: 'Passbook',
  epic: 'Voter ID',
};
