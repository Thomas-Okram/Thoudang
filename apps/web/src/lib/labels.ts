import type { CaseStatus, DetectedType } from './api';
import type { IconName } from '../components/ui/Icon';

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

/**
 * One colour per status, used everywhere (queue columns, badges, banners, charts):
 * green = ready, warm marigold = citizen must act, navy-blue = officer must look, teal = approved.
 */
export const STATUS_STYLE: Record<CaseStatus, string> = {
  READY: 'bg-emerald-50 text-emerald-800 ring-emerald-600/30',
  NEEDS_CITIZEN_CORRECTION: 'bg-warm-50 text-warm-900 ring-warm-500/40',
  OFFICER_ATTENTION: 'bg-indigo-50 text-indigo-900 ring-indigo-500/30',
  APPROVED_BY_OFFICER: 'bg-teal-wash text-teal-darker ring-teal-accent/40',
};

export const STATUS_ICON: Record<CaseStatus, IconName> = {
  READY: 'check',
  NEEDS_CITIZEN_CORRECTION: 'user',
  OFFICER_ATTENTION: 'eye',
  APPROVED_BY_OFFICER: 'star',
};

/** Solid accent (dots, column rules, banners). */
export const STATUS_ACCENT: Record<CaseStatus, string> = {
  READY: 'bg-emerald-600',
  NEEDS_CITIZEN_CORRECTION: 'bg-warm-500',
  OFFICER_ATTENTION: 'bg-indigo-600',
  APPROVED_BY_OFFICER: 'bg-teal-deep',
};

export const prettyField = (name: string) =>
  name
    .replace(/_if_stated$/, '')
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
