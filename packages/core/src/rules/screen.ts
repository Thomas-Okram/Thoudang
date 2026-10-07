import { getSchemeRules, schemeConfig, type PriorityConfig, type SchemeRules } from '../config.js';
import type {
  AadhaarFields,
  CaseStatus,
  DocType,
  EpicFields,
  ExtractedCase,
  ExtractedField,
  Flag,
  FlagEvidence,
  FormFields,
  PassbookFields,
} from '../types.js';
import { isValidIfsc, validateEpic } from '../validators/ids.js';
import { checkAge, checkIncome, parseDate } from '../validators/eligibility.js';
import { matchNames, type NameMatchResult } from '../names/match.js';
import { knownYumnaksFrom } from '../names/identity.js';
import { defaultGazetteer, type Gazetteer } from '../names/gazetteer.js';
import { computePriority } from './priority.js';

/** A previously screened case, used for duplicate detection. Masked data only. */
export interface DuplicateCandidate {
  caseId: string;
  aadhaarLast4: string | null;
  dob: string | null;
  applicantName: string | null;
}

export interface ScreenOptions {
  rules?: SchemeRules;
  /** Reference date `YYYY-MM-DD` for "days pending" and fallback age. Defaults to today (UTC). */
  today?: string;
  existingCases?: DuplicateCandidate[];
  minFieldConfidence?: number;
  priority?: PriorityConfig;
  gazetteer?: Gazetteer;
}

/** Officer-facing statuses produced by screening. APPROVED_BY_OFFICER is only ever set by an officer. */
export type ScreeningStatus = Exclude<CaseStatus, 'APPROVED_BY_OFFICER'>;

export interface ScreeningResult {
  status: ScreeningStatus;
  flags: Flag[];
  priorityScore: number;
  priorityReasons: string[];
  /** Normalised facts the API stores on the case row. */
  facts: {
    applicantName: string | null;
    dob: string | null;
    age: number | null;
    aadhaarLast4: string | null;
  };
}

const DOC_LABEL: Record<DocType, string> = {
  form: 'application form',
  aadhaar: 'Aadhaar card',
  passbook: 'bank passbook',
  epic: 'voter ID (EPIC)',
};

const FIELD_LABEL: Record<string, string> = {
  applicantName: 'applicant name',
  fatherOrHusbandName: "father's/husband's name",
  dob: 'date of birth',
  gender: 'gender',
  maritalStatus: 'marital status',
  annualIncome: 'annual income',
  address: 'address',
  district: 'district',
  disability: 'disability',
  internallyDisplaced: 'displacement status',
  bankAccountNumber: 'bank account number',
  ifsc: 'IFSC code',
  applicationDate: 'application date',
  name: 'name',
  maskedNumber: 'Aadhaar number',
  last4: 'Aadhaar number',
  accountHolderName: 'account holder name',
  accountNumber: 'account number',
  bankName: 'bank name',
  branch: 'branch',
  epicNumber: 'EPIC number',
  relativeName: "relative's name",
};

/** Fields that must be present for a complete application. Structural, not scheme policy. */
const REQUIRED_FIELDS: { [D in DocType]: string[] } = {
  form: ['applicantName', 'dob', 'address', 'annualIncome', 'bankAccountNumber', 'ifsc'],
  aadhaar: ['name', 'dob', 'last4'],
  passbook: ['accountHolderName', 'accountNumber', 'ifsc'],
  epic: ['name', 'epicNumber'],
};

type Scalar = string | number | boolean | null;
type AnyFields = Record<string, ExtractedField<Scalar> | Scalar>;

function isField(v: unknown): v is ExtractedField<Scalar> {
  return typeof v === 'object' && v !== null && 'confidence' in v && 'value' in v;
}

const ev = (document: DocType, field: string, f: ExtractedField<Scalar>): FlagEvidence => ({
  document,
  field,
  value: f.value,
  confidence: f.confidence,
});

const label = (field: string) => FIELD_LABEL[field] ?? field;
const digitsOnly = (s: string) => s.replace(/\D/g, '');
const todayIso = () => new Date().toISOString().slice(0, 10);

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

/**
 * Deterministic screening. AI extraction feeds in; code decides the queue;
 * the officer makes the final call. Never rejects.
 */
export function screenCase(extracted: ExtractedCase, opts: ScreenOptions = {}): ScreeningResult {
  const rules = opts.rules ?? getSchemeRules();
  const today = opts.today ?? todayIso();
  const minConf = opts.minFieldConfidence ?? schemeConfig.screening.minFieldConfidence;
  const gazetteer = opts.gazetteer ?? defaultGazetteer;
  const flags: Flag[] = [];
  const add = (flag: Flag) => flags.push(flag);

  const docs = extracted.documents;
  const okFields = {
    form: docs.form?.status === 'ok' ? docs.form.fields : null,
    aadhaar: docs.aadhaar?.status === 'ok' ? docs.aadhaar.fields : null,
    passbook: docs.passbook?.status === 'ok' ? docs.passbook.fields : null,
    epic: docs.epic?.status === 'ok' ? docs.epic.fields : null,
  } satisfies { [D in DocType]: unknown };
  const form: FormFields | null = okFields.form;
  const aadhaar: AadhaarFields | null = okFields.aadhaar;
  const passbook: PassbookFields | null = okFields.passbook;
  const epic: EpicFields | null = okFields.epic;

  // A value is usable for a decision only if it was read with enough confidence.
  const confident = <T>(f: ExtractedField<T> | undefined | null): T | null =>
    f && f.value !== null && f.confidence >= minConf ? f.value : null;
  const present = <T>(f: ExtractedField<T> | undefined | null): T | null => f?.value ?? null;

  // --- 1. Documents present / extracted --------------------------------------------------------
  for (const doc of rules.requiredDocuments) {
    if (!docs[doc]) {
      add({
        code: 'MISSING_DOCUMENT',
        severity: 'critical',
        action: 'citizen',
        reason: `The ${DOC_LABEL[doc]} was not submitted with the application.`,
        evidence: [{ document: doc, field: 'document', value: null }],
      });
    }
  }
  for (const doc of rules.optionalDocuments) {
    if (!docs[doc]) {
      add({
        code: 'OPTIONAL_DOCUMENT_NOT_PROVIDED',
        severity: 'info',
        action: 'none',
        reason: `The ${DOC_LABEL[doc]} was not provided. It is optional for this scheme.`,
        evidence: [{ document: doc, field: 'document', value: null }],
      });
    }
  }
  for (const doc of Object.keys(docs) as DocType[]) {
    const result = docs[doc];
    if (result?.status === 'failed') {
      add({
        code: 'EXTRACTION_FAILED',
        severity: 'warn',
        action: 'officer',
        reason: `Extraction failed — manual review needed for the ${DOC_LABEL[doc]} (${result.error}).`,
        evidence: [{ document: doc, field: 'document', value: result.error }],
      });
    }
  }

  // --- 2. Required fields and confidence -------------------------------------------------------
  for (const doc of Object.keys(okFields) as DocType[]) {
    const fields = okFields[doc] as AnyFields | null;
    if (!fields) continue;
    const lowConfidence: FlagEvidence[] = [];
    for (const [name, raw] of Object.entries(fields)) {
      if (!isField(raw)) continue;
      const required = REQUIRED_FIELDS[doc].includes(name);
      if (raw.value === null && required && raw.confidence >= minConf) {
        add({
          code: 'MISSING_FIELD',
          severity: 'critical',
          action: 'citizen',
          reason: `The ${label(name)} is blank on the ${DOC_LABEL[doc]}.`,
          evidence: [ev(doc, name, raw)],
        });
      } else if (raw.confidence < minConf && (required || raw.value !== null)) {
        lowConfidence.push(ev(doc, name, raw));
      }
    }
    if (lowConfidence.length) {
      add({
        code: 'LOW_CONFIDENCE',
        severity: 'warn',
        action: 'officer',
        reason: `Some fields on the ${DOC_LABEL[doc]} could not be read reliably (${lowConfidence
          .map((e) => label(e.field))
          .join(', ')}). Please verify against the image.`,
        evidence: lowConfidence,
      });
    }
  }

  // --- 3. Identity documents ------------------------------------------------------------------
  if (aadhaar && aadhaar.checksumValid === false) {
    add({
      code: 'AADHAAR_CHECKSUM_INVALID',
      severity: 'critical',
      action: 'officer',
      reason:
        'The Aadhaar number fails its checksum: it may be misread or invalid. Verify the number against the card.',
      evidence: [ev('aadhaar', 'maskedNumber', aadhaar.maskedNumber)],
    });
  }
  for (const [doc, f] of [
    ['form', form?.ifsc],
    ['passbook', passbook?.ifsc],
  ] as const) {
    const value = present(f);
    if (f && value !== null && !isValidIfsc(value)) {
      add({
        code: 'IFSC_INVALID',
        severity: 'critical',
        action: 'citizen',
        reason: `The IFSC code "${value}" on the ${DOC_LABEL[doc]} is not a valid IFSC (4 letters, 0, then 6 letters/digits).`,
        evidence: [ev(doc, 'ifsc', f)],
      });
    }
  }
  if (epic) {
    const value = present(epic.epicNumber);
    if (value !== null && !validateEpic(value).formatValid) {
      add({
        code: 'EPIC_FORMAT_INVALID',
        severity: 'warn',
        action: 'officer',
        reason: `The voter ID number "${value}" does not have the usual format (3 letters + 7 digits). Check the card.`,
        evidence: [ev('epic', 'epicNumber', epic.epicNumber)],
      });
    }
  }

  const formLast4 = present(form?.aadhaarLast4);
  const cardLast4 = present(aadhaar?.last4);
  if (form?.aadhaarLast4 && aadhaar && formLast4 && cardLast4 && formLast4 !== cardLast4) {
    add({
      code: 'AADHAAR_FORM_CARD_MISMATCH',
      severity: 'warn',
      action: 'officer',
      reason: `Aadhaar on form doesn't match card (last 4: ${formLast4} vs ${cardLast4}).`,
      evidence: [
        ev('form', 'aadhaarLast4', form.aadhaarLast4),
        ev('aadhaar', 'last4', aadhaar.last4),
      ],
    });
  }

  if (form?.signaturePresent && confident(form.signaturePresent) === false) {
    add({
      code: 'MISSING_SIGNATURE',
      severity: 'critical',
      action: 'citizen',
      reason: 'The application form is not signed (no signature or thumb impression).',
      evidence: [ev('form', 'signaturePresent', form.signaturePresent)],
    });
  }

  // --- 4. Bank details consistency ------------------------------------------------------------
  if (form && passbook) {
    const pairs = [
      [
        'bankAccountNumber',
        form.bankAccountNumber,
        'accountNumber',
        passbook.accountNumber,
        digitsOnly,
      ],
      ['ifsc', form.ifsc, 'ifsc', passbook.ifsc, (s: string) => s.replace(/\s/g, '').toUpperCase()],
    ] as const;
    for (const [formField, ff, pbField, pf, norm] of pairs) {
      const a = present(ff);
      const b = present(pf);
      if (a !== null && b !== null && norm(a) !== norm(b)) {
        add({
          code: 'BANK_DETAILS_MISMATCH',
          severity: 'critical',
          action: 'citizen',
          reason: `The ${label(formField)} on the application form ("${a}") does not match the bank passbook ("${b}").`,
          evidence: [ev('form', formField, ff), ev('passbook', pbField, pf)],
        });
      }
    }
  }

  // --- 5. Cross-document names ----------------------------------------------------------------
  const anchor: { doc: DocType; field: string; f: ExtractedField<string> } | null =
    form && present(form.applicantName) !== null
      ? { doc: 'form', field: 'applicantName', f: form.applicantName }
      : aadhaar && present(aadhaar.name) !== null
        ? { doc: 'aadhaar', field: 'name', f: aadhaar.name }
        : null;

  // Full yumnaks from relatives' names (same packet) may disambiguate an abbreviation like "Th.".
  const knownYumnaks = knownYumnaksFrom(
    [present(form?.fatherOrHusbandName), present(epic?.relativeName)],
    gazetteer,
  );

  if (anchor) {
    const others: { doc: DocType; field: string; f: ExtractedField<string> | undefined }[] = [
      { doc: 'aadhaar', field: 'name', f: aadhaar?.name },
      { doc: 'epic', field: 'name', f: epic?.name },
      { doc: 'passbook', field: 'accountHolderName', f: passbook?.accountHolderName },
    ];
    for (const other of others) {
      if (other.doc === anchor.doc || !other.f || other.f.value === null) continue;
      const result = matchNames(anchor.f.value!, other.f.value, { gazetteer, knownYumnaks });
      const flag = nameFlag(result, anchor, { ...other, f: other.f });
      if (flag) add(flag);
    }
  }

  // --- 6. Dates of birth & eligibility -------------------------------------------------------
  const dobSources = [
    { doc: 'form' as const, f: form?.dob },
    { doc: 'aadhaar' as const, f: aadhaar?.dob },
    { doc: 'epic' as const, f: epic?.dob },
  ].filter((s): s is { doc: 'form' | 'aadhaar' | 'epic'; f: ExtractedField<string> } =>
    Boolean(s.f && s.f.value),
  );

  const dobConflict = findDobConflict(dobSources.map((s) => s.f.value!));
  if (dobConflict) {
    add({
      code: 'DOB_MISMATCH',
      severity: 'critical',
      action: 'citizen',
      reason: `The date of birth differs between documents (${dobSources
        .map((s) => `${DOC_LABEL[s.doc]}: ${s.f.value}`)
        .join('; ')}).`,
      evidence: dobSources.map((s) => ev(s.doc, 'dob', s.f)),
    });
  }

  // Prefer a full date; form first, then Aadhaar, then EPIC.
  const bestDob =
    dobSources.find((s) => !parseDate(s.f.value!)?.yearOnly && s.f.confidence >= minConf) ??
    dobSources.find((s) => s.f.confidence >= minConf) ??
    null;
  const applicationDate = confident(form?.applicationDate) ?? today;
  let age: number | null = null;
  if (bestDob) {
    const ageCheck = checkAge(bestDob.f.value!, applicationDate, rules);
    age = ageCheck.age;
    if (ageCheck.eligible === false) {
      add({
        code: 'AGE_BELOW_MINIMUM',
        severity: 'critical',
        action: 'officer',
        reason: `Age on the application date is ${ageCheck.age}, below the scheme minimum of ${rules.minAge}. Officer to review the age proof.`,
        evidence: [ev(bestDob.doc, 'dob', bestDob.f)],
      });
    }
    if (ageCheck.approximate) {
      add({
        code: 'DOB_YEAR_ONLY',
        severity: 'info',
        action: 'none',
        reason: `Only the year of birth is available; age is taken as at least ${ageCheck.age}.`,
        evidence: [ev(bestDob.doc, 'dob', bestDob.f)],
      });
    }
  }

  if (form) {
    const income = confident(form.annualIncome);
    const incomeCheck = checkIncome(income, rules);
    if (incomeCheck.eligible === false) {
      add({
        code: 'INCOME_ABOVE_CEILING',
        severity: 'critical',
        action: 'officer',
        reason: `Declared annual income ₹${income} is above the configured ceiling of ₹${incomeCheck.ceiling}. Officer to review.`,
        evidence: [ev('form', 'annualIncome', form.annualIncome)],
      });
    }
  }

  // --- 7. Duplicates ----------------------------------------------------------------------------
  const last4 = present(aadhaar?.last4);
  const applicantName = anchor?.f.value ?? null;
  const dob = bestDob?.f.value ?? null;
  if (last4 && dob && applicantName) {
    for (const other of opts.existingCases ?? []) {
      if (other.caseId === extracted.caseId || other.aadhaarLast4 !== last4) continue;
      if (!other.dob || !other.applicantName || !sameDob(other.dob, dob)) continue;
      const nm = matchNames(applicantName, other.applicantName, { gazetteer });
      if (nm.verdict === 'SAME' || nm.verdict === 'LIKELY_SAME') {
        add({
          code: 'DUPLICATE_SUSPECTED',
          severity: 'critical',
          action: 'officer',
          reason: `Possible duplicate of case ${other.caseId}: same Aadhaar last 4 digits (${last4}), same date of birth and matching name ("${other.applicantName}").`,
          evidence: [
            ev('aadhaar', 'last4', aadhaar!.last4),
            { document: anchor!.doc, field: anchor!.field, value: applicantName },
          ],
        });
      }
    }
  }

  // --- 8. Never send a citizen notice built on an unreliable read ---------------------------------
  const routed = flags.map((flag) =>
    flag.action === 'citizen' &&
    flag.evidence.some((e) => e.confidence !== undefined && e.confidence < minConf)
      ? {
          ...flag,
          action: 'officer' as const,
          reason: `${flag.reason} (Based on a low-confidence read — officer to verify before notifying the citizen.)`,
        }
      : flag,
  );

  // --- 9. Priority & status -------------------------------------------------------------------
  const priority = computePriority(
    {
      age,
      widowed: confident(form?.maritalStatus) === 'widowed',
      disability: confident(form?.disability) === true,
      internallyDisplaced: confident(form?.internallyDisplaced) === true,
      daysPending: daysBetween(extracted.receivedAt, today),
    },
    opts.priority ?? schemeConfig.priority,
  );

  return {
    status: deriveStatus(routed),
    flags: routed,
    priorityScore: priority.score,
    priorityReasons: priority.reasons,
    facts: { applicantName, dob, age, aadhaarLast4: last4 },
  };
}

/** Flag codes that must be resolved by an officer before anything goes to the citizen. */
export const NOTICE_BLOCKING_CODES = ['DUPLICATE_SUSPECTED'] as const;

export function deriveStatus(flags: Flag[]): ScreeningStatus {
  const blocked = flags.some((f) => (NOTICE_BLOCKING_CODES as readonly string[]).includes(f.code));
  if (!blocked && flags.some((f) => f.action === 'citizen' && f.severity === 'critical')) {
    return 'NEEDS_CITIZEN_CORRECTION';
  }
  if (flags.some((f) => f.action === 'officer' || f.action === 'citizen'))
    return 'OFFICER_ATTENTION';
  return 'READY';
}

export interface NoticeEligibility {
  allowed: boolean;
  blockedBy: string[];
  reasons: string[];
}

/**
 * Whether a citizen deficiency notice may be generated from these flags.
 * A suspected duplicate blocks notices until an officer resolves it.
 */
export function noticeEligibility(flags: Flag[]): NoticeEligibility {
  const blockers = flags.filter((f) =>
    (NOTICE_BLOCKING_CODES as readonly string[]).includes(f.code),
  );
  if (blockers.length) {
    return {
      allowed: false,
      blockedBy: [...new Set(blockers.map((f) => f.code))],
      reasons: [
        'A possible duplicate application must be resolved by an officer before any notice is sent to the citizen.',
      ],
    };
  }
  if (!flags.some((f) => f.action === 'citizen')) {
    return {
      allowed: false,
      blockedBy: [],
      reasons: ['There are no citizen corrections to notify.'],
    };
  }
  return { allowed: true, blockedBy: [], reasons: [] };
}

function nameFlag(
  result: NameMatchResult,
  anchor: { doc: DocType; field: string; f: ExtractedField<string> },
  other: { doc: DocType; field: string; f: ExtractedField<string> },
): Flag | null {
  const evidence = [ev(anchor.doc, anchor.field, anchor.f), ev(other.doc, other.field, other.f)];
  const where = `the ${DOC_LABEL[other.doc]} ("${other.f.value}") vs the ${DOC_LABEL[anchor.doc]} ("${anchor.f.value}")`;
  const why = result.reasons.join(' ');
  switch (result.verdict) {
    case 'SAME':
      return null;
    case 'LIKELY_SAME':
      return {
        code: 'NAME_VARIANT',
        severity: 'info',
        action: 'none',
        reason: `Name on ${where} is a likely match (score ${result.score}). ${why}`,
        evidence,
      };
    case 'AMBIGUOUS':
      return {
        code: 'NAME_AMBIGUOUS',
        severity: 'warn',
        action: 'officer',
        reason: `Name on ${where} needs officer confirmation (score ${result.score}). ${why}`,
        evidence,
      };
    case 'DIFFERENT':
      return {
        code: other.doc === 'passbook' ? 'BANK_HOLDER_NAME_MISMATCH' : 'NAME_MISMATCH',
        severity: 'critical',
        action: 'citizen',
        reason:
          other.doc === 'passbook'
            ? `The bank account holder (${other.f.value}) does not match the applicant (${anchor.f.value}). ${why}`
            : `Name on ${where} does not match (score ${result.score}). ${why}`,
        evidence,
      };
  }
}

function sameDob(a: string, b: string): boolean {
  const pa = parseDate(a);
  const pb = parseDate(b);
  if (!pa || !pb) return false;
  if (pa.yearOnly || pb.yearOnly) return pa.iso.slice(0, 4) === pb.iso.slice(0, 4);
  return pa.iso === pb.iso;
}

/** True when any two DOBs disagree (year-only values are compared on the year). */
function findDobConflict(raw: string[]): boolean {
  const values = raw.filter((v) => parseDate(v) !== null);
  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) {
      if (!sameDob(values[i]!, values[j]!)) return true;
    }
  }
  return false;
}
