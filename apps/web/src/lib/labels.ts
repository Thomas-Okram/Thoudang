import type { CaseStatus, DetectedType } from './api';

export const DOC_LABEL: Record<DetectedType, string> = {
  application_form: 'Application form',
  aadhaar: 'Aadhaar',
  bank_passbook: 'Bank passbook',
  epic: 'Voter ID (EPIC)',
  other: 'Not part of packet',
};

export const STATUS_LABEL: Record<CaseStatus, string> = {
  READY: 'Ready for approval',
  NEEDS_CITIZEN_CORRECTION: 'Needs citizen correction',
  OFFICER_ATTENTION: 'Officer attention',
  APPROVED_BY_OFFICER: 'Approved by officer',
};

export const STATUS_STYLE: Record<CaseStatus, string> = {
  READY: 'bg-emerald-50 text-emerald-800 ring-emerald-600/30',
  NEEDS_CITIZEN_CORRECTION: 'bg-amber-50 text-amber-900 ring-amber-600/30',
  OFFICER_ATTENTION: 'bg-sky-50 text-sky-900 ring-sky-600/30',
  APPROVED_BY_OFFICER: 'bg-teal-soft text-navy-900 ring-teal-accent/40',
};

export const prettyField = (name: string) =>
  name
    .replace(/_if_stated$/, '')
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
