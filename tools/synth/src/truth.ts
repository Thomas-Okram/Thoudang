/**
 * Ground truth (truth.json) and the EXPECTED screening outcome for a packet spec.
 *
 * The expected outcome is computed by the real pipeline code — the API's own wire → normalised →
 * rules-engine mapping (`normaliseExtraction`, `toExtractedCase`) and core's `screenCase` — fed
 * with a perfect reading of each document. So truth.json says what the system should conclude
 * if extraction were flawless; any eval mismatch is an extraction (or engine) error.
 */
import {
  matchNames,
  maskAadhaar,
  screenCase,
  type DuplicateCandidate,
  type NameVerdict,
} from '@thoudang/core';
import { normaliseExtraction } from '../../../apps/api/src/extraction/normalise.js';
import { DOC_FIELDS, type ExtractableType } from '../../../apps/api/src/extraction/schemas.js';
import { toExtractedCase, type DocOutcome } from '../../../apps/api/src/pipeline/mapping.js';
import type { ExpectedStatus, NameIntent, PacketSpec } from './spec.js';

export const DOC_FILES = {
  form: 'form.jpg',
  aadhaar: 'aadhaar.jpg',
  passbook: 'passbook.jpg',
  epic: 'epic.jpg',
} as const;
export type DocKey = keyof typeof DOC_FILES;

export const DOC_TYPE: Record<DocKey, ExtractableType> = {
  form: 'application_form',
  aadhaar: 'aadhaar',
  passbook: 'bank_passbook',
  epic: 'epic',
};

/** Field values exactly as they appear on each document. Aadhaar numbers are FULL here. */
export function documentFields(
  spec: PacketSpec,
): Partial<Record<DocKey, Record<string, string | null>>> {
  const out: Partial<Record<DocKey, Record<string, string | null>>> = {};
  if (spec.form) out.form = { ...spec.form.fields };
  if (spec.aadhaar) {
    out.aadhaar = {
      name: spec.aadhaar.name,
      dob_or_yob: spec.aadhaar.dob,
      gender: spec.aadhaar.gender,
      aadhaar_number: spec.aadhaar.number,
      address: spec.aadhaar.address,
    };
  }
  if (spec.passbook) {
    out.passbook = {
      account_holder_name: spec.passbook.holder,
      account_number: spec.passbook.account,
      ifsc: spec.passbook.ifsc,
      bank_name: spec.passbook.bank,
      branch: spec.passbook.branch,
    };
  }
  if (spec.epic) {
    out.epic = {
      name: spec.epic.name,
      relative_name: spec.epic.relative,
      epic_number: spec.epic.number,
      dob_or_age: spec.epic.dobOrAge,
    };
  }
  return out;
}

const maskField = (field: string, v: string | null) =>
  field === 'aadhaar_number' && v !== null ? (maskAadhaar(v) ?? v) : v;

export interface ExpectedFlag {
  code: string;
  severity: string;
  action: string;
}

export interface Expectation {
  status: ExpectedStatus;
  flags: ExpectedFlag[];
  facts: { applicantName: string | null; dob: string | null; aadhaarLast4: string | null };
  checksumValid: boolean | null;
}

/** Runs the real mapping + rules engine on a perfect reading of the packet. */
export function expectScreening(
  spec: PacketSpec,
  opts: { caseId: string; today: string; existingCases: DuplicateCandidate[] },
): Expectation {
  const fields = documentFields(spec);
  const outcomes: DocOutcome[] = [];
  let checksumValid: boolean | null = null;
  for (const key of Object.keys(DOC_FILES) as DocKey[]) {
    const values = fields[key];
    if (!values) continue;
    const type = DOC_TYPE[key];
    const wire = {
      legibility: 'good' as const,
      notes: '',
      fields: Object.fromEntries(
        DOC_FIELDS[type].map((f) => {
          const v = values[f];
          return [
            f,
            v === undefined || v === null
              ? { value: '', status: 'blank' as const, confidence: 'high' as const, bbox: [] }
              : { value: v, status: 'present' as const, confidence: 'high' as const, bbox: [] },
          ];
        }),
      ),
    };
    const doc = normaliseExtraction(type, wire, { width: 1000, height: 1000 });
    if (key === 'aadhaar') checksumValid = doc.aadhaar?.checksumValid ?? null;
    outcomes.push({ kind: 'extracted', type, doc });
  }
  const extracted = toExtractedCase(opts.caseId, new Date(`${opts.today}T09:00:00Z`), outcomes);
  const result = screenCase(extracted, { today: opts.today, existingCases: opts.existingCases });
  return {
    status: result.status,
    flags: result.flags
      .map((f) => ({ code: f.code, severity: f.severity, action: f.action }))
      .sort((a, b) => a.code.localeCompare(b.code) || a.action.localeCompare(b.action)),
    facts: {
      applicantName: result.facts.applicantName,
      dob: result.facts.dob,
      aadhaarLast4: result.facts.aadhaarLast4,
    },
    checksumValid,
  };
}

export interface NameCheck {
  a: string;
  b: string;
  expected: NameVerdict;
  /** Ground truth: are these the same person? (expected is what the engine should say.) */
  same_person: boolean;
}

/**
 * Name checks in the eval harness format. `expected` = the name engine's verdict on the two
 * strings with no packet context — exactly how `score.ts` recomputes it from extracted values.
 */
export function nameChecks(spec: PacketSpec): NameCheck[] {
  const fields = documentFields(spec);
  const anchor = fields.form?.applicant_name;
  if (!anchor) return [];
  const pairs: [DocKey, string, NameIntent | undefined][] = [
    ['aadhaar', 'name', spec.nameIntent.aadhaar],
    ['passbook', 'account_holder_name', spec.nameIntent.passbook],
    ['epic', 'name', spec.nameIntent.epic],
  ];
  const out: NameCheck[] = [];
  for (const [doc, field, intent] of pairs) {
    const other = fields[doc]?.[field];
    if (!other) continue;
    out.push({
      a: `${DOC_FILES.form}:applicant_name`,
      b: `${DOC_FILES[doc]}:${field}`,
      expected: matchNames(anchor, other).verdict,
      same_person: intent !== 'different',
    });
  }
  return out;
}

/** Is the engine's verdict consistent with the planted ground truth? */
export function verdictFits(intent: NameIntent | undefined, verdict: NameVerdict): boolean {
  if (intent === 'different') return verdict === 'DIFFERENT';
  if (intent === 'ambiguous') return verdict === 'AMBIGUOUS';
  return verdict === 'SAME' || verdict === 'LIKELY_SAME';
}

export interface TruthJson {
  _note: string;
  expected_status: ExpectedStatus;
  documents: Record<string, { type: ExtractableType; fields: Record<string, string | null> }>;
  name_checks: NameCheck[];
  expected_flags: ExpectedFlag[];
  synthetic: Record<string, unknown>;
}

export function buildTruth(
  spec: PacketSpec,
  expectation: Expectation,
  meta: Record<string, unknown>,
): TruthJson {
  const fields = documentFields(spec);
  const documents: TruthJson['documents'] = {};
  for (const key of Object.keys(DOC_FILES) as DocKey[]) {
    const values = fields[key];
    if (!values) continue;
    documents[DOC_FILES[key]] = {
      type: DOC_TYPE[key],
      fields: Object.fromEntries(Object.entries(values).map(([f, v]) => [f, maskField(f, v)])),
    };
  }
  return {
    _note: `${spec.description} SYNTHETIC SPECIMEN DATA generated by tools/synth — fictional people, mock documents. Field values are the exact transcription expected; null = blank on the document. Aadhaar numbers are stored masked only.`,
    expected_status: expectation.status,
    documents,
    name_checks: nameChecks(spec),
    expected_flags: expectation.flags,
    synthetic: {
      generator: 'tools/synth',
      scenario: spec.scenario,
      plants: spec.plants,
      community: spec.person.community,
      gender: spec.person.gender,
      marital: spec.person.marital,
      district: spec.person.reliefCamp?.district ?? spec.person.district,
      displaced: spec.person.reliefCamp !== null,
      epic_included: spec.epic !== null,
      aadhaar_checksum_valid: expectation.checksumValid,
      writer: { font: spec.writer.font, ink: spec.writer.ink, caps: spec.writer.caps },
      ...meta,
    },
  };
}
