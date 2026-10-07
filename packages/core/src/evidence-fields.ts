/**
 * Rules-engine evidence fields (core names, e.g. form.dob) → extraction field names
 * (what the document reader returns and what carries a bounding box, e.g. date_of_birth).
 * Shared by the Case view (highlight on image) and notices (values "as written").
 */
export type EvidenceDocument = 'form' | 'aadhaar' | 'passbook' | 'epic';

const MAP: Record<EvidenceDocument, Record<string, string | null>> = {
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
    signaturePresent: 'signature_present',
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

export const EVIDENCE_DOC_TYPE: Record<
  EvidenceDocument,
  'application_form' | 'aadhaar' | 'bank_passbook' | 'epic'
> = {
  form: 'application_form',
  aadhaar: 'aadhaar',
  passbook: 'bank_passbook',
  epic: 'epic',
};

export function extractionFieldFor(e: { document: string; field: string }): string | null {
  return MAP[e.document as EvidenceDocument]?.[e.field] ?? null;
}
