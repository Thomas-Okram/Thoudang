import { flagTitle } from '@thoudang/core';
import type { auditLog, DetectedType } from './db/schema.js';

type AuditRow = typeof auditLog.$inferSelect;

export const DOC_TITLE: Record<DetectedType, string> = {
  application_form: 'Application form',
  aadhaar: 'Aadhaar card',
  bank_passbook: 'Bank passbook',
  epic: 'Voter ID',
  other: 'Other document',
};

const FIELD_TITLE: Record<string, string> = {
  applicant_name: 'Applicant name',
  father_or_husband_name: "Father's/husband's name",
  date_of_birth: 'Date of birth',
  dob_or_yob: 'Date of birth',
  dob_or_age: 'Date of birth / age',
  account_holder_name: 'Account holder',
  account_number: 'Account number',
  annual_income: 'Annual income',
  application_date: 'Application date',
  marital_status_if_stated: 'Marital status',
  disability_if_stated: 'Disability',
  epic_number: 'EPIC number',
  relative_name: "Relative's name",
  signature_present: 'Signature',
  ifsc: 'IFSC',
};
export const fieldTitle = (f: string) =>
  FIELD_TITLE[f] ?? f.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** "claude-sonnet-5-5" → "Sonnet 5.5" */
export function modelLabel(model: unknown): string {
  if (typeof model !== 'string') return 'AI';
  const m = /claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(model);
  if (!m) return model;
  const family = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1);
  return `${family} ${m[2]}${m[3] ? `.${m[3]}` : ''}`;
}

const secs = (ms: unknown) => (typeof ms === 'number' ? `${(ms / 1000).toFixed(1)}s` : '');
const quote = (v: unknown) =>
  v === null || v === undefined || v === '' ? '(blank)' : `“${String(v)}”`;

export interface AuditContext {
  officerName: (actor: string) => string | null;
  document: (
    id: string | null,
  ) => { originalName: string; detectedType: DetectedType | null } | undefined;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});

/** One plain-English line per audit entry, as shown in the Case audit drawer. */
export function describeAudit(a: AuditRow, ctx: AuditContext): string {
  const after = obj(a.after);
  const before = obj(a.before);
  const who = ctx.officerName(a.actor) ?? 'Officer';
  const doc = ctx.document(a.entityId);
  const docName = doc?.detectedType
    ? DOC_TITLE[doc.detectedType]
    : (doc?.originalName ?? 'document');
  const reason = a.reason ? ` — reason: ${a.reason}` : '';

  switch (a.action) {
    case 'CASE_CREATED':
      return `Packet received (${String(after.images ?? '?')} image${after.images === 1 ? '' : 's'}, via ${String(after.source ?? 'desk')})`;
    case 'DOCUMENT_UPLOADED':
      return `Uploaded ${String(after.originalName ?? 'image')}${after.decoded === false ? ' — image could not be opened' : ''}`;
    case 'TYPE_SET_BY_OFFICER':
      return `Officer placed ${doc?.originalName ?? 'image'} in the ${DOC_TITLE[(after.detectedType as DetectedType) ?? 'other']} slot (AI classification skipped)`;
    case 'AI_CLASSIFICATION': {
      if (after.ok === false)
        return `AI could not identify ${doc?.originalName ?? 'an image'}: ${String(after.error ?? 'error')}`;
      const type = DOC_TITLE[(after.detectedType as DetectedType) ?? 'other'];
      return `AI identified ${doc?.originalName ?? 'image'} as ${type} (${modelLabel(after.model)}${after.cacheHit ? ', cached' : `, ${secs(after.latencyMs)}`})`;
    }
    case 'AI_EXTRACTION': {
      if (after.ok === false)
        return `AI could not read the ${docName}: ${String(after.error ?? 'error')}`;
      const n = typeof after.fieldsRead === 'number' ? `${after.fieldsRead} fields` : 'fields';
      return `AI extracted ${n} from ${docName} (${modelLabel(after.model)}${after.cacheHit ? ', cached' : `, ${secs(after.latencyMs)}`})`;
    }
    case 'RULE_RESULT': {
      const flags = Array.isArray(after.flags) ? (after.flags as Obj[]) : [];
      const serious = flags.filter((f) => f.severity !== 'info').length;
      const trigger = after.trigger ? ` after ${String(after.trigger)}` : '';
      return `Rules checked${trigger}: ${serious} issue${serious === 1 ? '' : 's'} → ${statusLabel(after.status)}`;
    }
    case 'FIELD_EDITED':
      return `${who} changed ${String(after.document ?? docName)} · ${fieldTitle(String(after.field ?? ''))} from ${quote(before.value)} to ${quote(after.value)}${reason}`;
    case 'OFFICER_ACCEPT':
      return `${who} accepted “${flagTitle(String(after.code ?? ''))}”${reason}`;
    case 'OFFICER_OVERRIDE':
      return `${who} overrode “${flagTitle(String(after.code ?? ''))}”${reason}`;
    case 'OFFICER_APPROVE':
      return `${who} approved for sanction${reason}`;
    case 'SENT_FOR_CORRECTION':
      return `${who} sent the case for citizen correction${reason}`;
    case 'FORWARDED_FOR_APPROVAL':
      return `${who} forwarded the case to the DSWO for approval`;
    case 'OFFICER_NOTE':
      return `${who} added a note: ${String(after.text ?? '')}`;
    case 'STATUS_CHANGE':
      return `Status changed to ${statusLabel(after.status)}`;
    case 'PIPELINE_ERROR':
      return `Processing error — case sent for manual review`;
    case 'NOTICE_GENERATED':
      return `${who} generated a deficiency notice`;
    default:
      return a.action;
  }
}

export function statusLabel(s: unknown): string {
  switch (s) {
    case 'READY':
      return 'Ready';
    case 'NEEDS_CITIZEN_CORRECTION':
      return 'Needs citizen correction';
    case 'OFFICER_ATTENTION':
      return 'Officer attention';
    case 'APPROVED_BY_OFFICER':
      return 'Approved by officer';
    default:
      return String(s ?? '');
  }
}
