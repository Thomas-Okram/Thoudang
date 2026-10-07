import type { CaseDocument, CaseFlag, Identity } from '../lib/api';

export const doc = (
  over: Partial<CaseDocument> & Pick<CaseDocument, 'id' | 'detectedType'>,
): CaseDocument => ({
  originalName: `${over.detectedType}.jpg`,
  typeConfidence: 'high',
  typeSource: 'ai',
  state: 'EXTRACTED',
  width: 1000,
  height: 800,
  imageUrl: `/api/documents/${over.id}/image`,
  thumbUrl: `/api/documents/${over.id}/image?variant=thumb`,
  redaction: 'none',
  classification: null,
  extraction: null,
  error: null,
  cacheHit: false,
  latencyMs: 0,
  model: 'claude-sonnet-5-5',
  ...over,
});

export const FORM = doc({
  id: 'd-form',
  detectedType: 'application_form',
  extraction: {
    legibility: 'good',
    notes: '',
    aadhaar: null,
    fields: {
      applicant_name: {
        value: 'Kh. Loken Singh',
        status: 'present',
        confidence: 'high',
        bbox: [100, 200, 400, 240],
      },
      date_of_birth: { value: '15-03-1958', status: 'present', confidence: 'medium', bbox: null },
    },
  },
});

export const AADHAAR = doc({
  id: 'd-aadhaar',
  detectedType: 'aadhaar',
  redaction: 'bbox',
  extraction: {
    legibility: 'good',
    notes: '',
    aadhaar: { masked: 'XXXX XXXX 1238', checksumValid: true },
    fields: {
      name: {
        value: 'Khuraijam Loken Singh',
        status: 'present',
        confidence: 'high',
        bbox: [300, 150, 700, 190],
      },
      dob_or_yob: {
        value: '1958',
        status: 'present',
        confidence: 'high',
        bbox: [300, 210, 420, 240],
      },
    },
  },
});

export const IDENTITY: Identity = {
  entries: [
    {
      key: 'd-form',
      documentId: 'd-form',
      docType: 'application_form',
      label: 'Application form',
      field: 'applicant_name',
      value: 'Kh. Loken Singh',
    },
    {
      key: 'd-aadhaar',
      documentId: 'd-aadhaar',
      docType: 'aadhaar',
      label: 'Aadhaar card',
      field: 'name',
      value: 'Khuraijam Loken Singh',
    },
    {
      key: 'd-pass',
      documentId: 'd-pass',
      docType: 'bank_passbook',
      label: 'Bank passbook',
      field: 'account_holder_name',
      value: 'KHURAIJAM LOKEN SINGH',
    },
  ],
  pairs: [
    {
      a: 'd-form',
      b: 'd-aadhaar',
      verdict: 'AMBIGUOUS',
      score: 74,
      reasons: [
        'Kh. could stand for Khuraijam, Khwairakpam — the documents do not show which. Officer to confirm the yumnak.',
      ],
      candidates: ['Khuraijam', 'Khwairakpam'],
    },
    {
      a: 'd-form',
      b: 'd-pass',
      verdict: 'AMBIGUOUS',
      score: 74,
      reasons: ['…'],
      candidates: ['Khuraijam', 'Khwairakpam'],
    },
    {
      a: 'd-aadhaar',
      b: 'd-pass',
      verdict: 'SAME',
      score: 100,
      reasons: ['All name parts match.'],
      candidates: [],
    },
  ],
  knownYumnaks: [],
  relatives: [],
};

export const DOB_FLAG: CaseFlag = {
  id: 'f-dob',
  code: 'DOB_MISMATCH',
  title: 'Date of birth differs',
  severity: 'critical',
  action: 'citizen',
  reason: 'The date of birth differs between documents.',
  evidence: [
    { document: 'form', field: 'dob', value: '15-03-1958', confidence: 0.8 },
    { document: 'aadhaar', field: 'dob', value: '1958', confidence: 0.95 },
  ],
  resolution: 'OPEN',
  resolvedBy: null,
  resolvedByName: null,
  resolvedAt: null,
  resolutionReason: null,
};
