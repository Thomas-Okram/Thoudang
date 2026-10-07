/** Short human titles for flag codes — shared by the API (audit summaries) and the web UI. */
export const FLAG_TITLES: Record<string, string> = {
  MISSING_DOCUMENT: 'Document missing',
  OPTIONAL_DOCUMENT_NOT_PROVIDED: 'Optional document not provided',
  EXTRACTION_FAILED: 'Could not read document',
  MISSING_FIELD: 'Field left blank',
  MISSING_SIGNATURE: 'Form not signed',
  LOW_CONFIDENCE: 'Unclear reading',
  AADHAAR_CHECKSUM_INVALID: 'Aadhaar number fails checksum',
  AADHAAR_FORM_CARD_MISMATCH: 'Aadhaar on form ≠ card',
  IFSC_INVALID: 'Invalid IFSC code',
  EPIC_FORMAT_INVALID: 'Unusual voter ID number',
  BANK_DETAILS_MISMATCH: 'Bank details differ',
  NAME_MISMATCH: 'Name mismatch',
  BANK_HOLDER_NAME_MISMATCH: 'Account holder ≠ applicant',
  NAME_AMBIGUOUS: 'Name needs confirmation',
  NAME_VARIANT: 'Name variant',
  DOB_MISMATCH: 'Date of birth differs',
  DOB_YEAR_ONLY: 'Only year of birth',
  AGE_BELOW_MINIMUM: 'Below minimum age',
  INCOME_ABOVE_CEILING: 'Income above ceiling',
  DUPLICATE_SUSPECTED: 'Possible duplicate',
};

export const flagTitle = (code: string): string =>
  FLAG_TITLES[code] ??
  code
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
