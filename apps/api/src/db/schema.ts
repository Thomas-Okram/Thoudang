import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';
import type { CaseStatus, DocType, FlagAction, FlagEvidence, Severity } from '@thoudang/core';

/** The ONLY case statuses. There is deliberately no "rejected" status anywhere in Thoudang. */
export const CASE_STATUSES = [
  'READY',
  'NEEDS_CITIZEN_CORRECTION',
  'OFFICER_ATTENTION',
  'APPROVED_BY_OFFICER',
] as const satisfies readonly CaseStatus[];

/** Pipeline progress — separate from the officer-facing status. */
export const PROCESSING_STATES = [
  'RECEIVED',
  'EXTRACTING',
  'SCREENED',
  'EXTRACTION_FAILED',
] as const;

export const DOC_TYPES = [
  'form',
  'aadhaar',
  'passbook',
  'epic',
] as const satisfies readonly DocType[];

const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date());

export const cases = sqliteTable(
  'cases',
  {
    id: text('id').primaryKey(),
    reference: text('reference').notNull().unique(),
    applicantName: text('applicant_name'),
    district: text('district'),
    status: text('status', { enum: CASE_STATUSES }).notNull().default('OFFICER_ATTENTION'),
    processingState: text('processing_state', { enum: PROCESSING_STATES })
      .notNull()
      .default('RECEIVED'),
    priorityScore: integer('priority_score').notNull().default(0),
    priorityReasons: text('priority_reasons', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default([]),
    /** Masked only — last 4 digits of Aadhaar. Full numbers are never stored. */
    aadhaarLast4: text('aadhaar_last4'),
    applicantDob: text('applicant_dob'),
    receivedAt: integer('received_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    decidedBy: text('decided_by'),
    decidedAt: integer('decided_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('cases_status_priority_idx').on(t.status, t.priorityScore)],
);

export const documents = sqliteTable(
  'documents',
  {
    id: text('id').primaryKey(),
    caseId: text('case_id')
      .notNull()
      .references(() => cases.id, { onDelete: 'cascade' }),
    docType: text('doc_type', { enum: DOC_TYPES }).notNull(),
    originalName: text('original_name').notNull(),
    storedPath: text('stored_path').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    widthPx: integer('width_px'),
    heightPx: integer('height_px'),
    sha256: text('sha256').notNull(),
    uploadedAt: createdAt(),
  },
  (t) => [index('documents_case_idx').on(t.caseId)],
);

export const extractions = sqliteTable(
  'extractions',
  {
    id: text('id').primaryKey(),
    caseId: text('case_id')
      .notNull()
      .references(() => cases.id, { onDelete: 'cascade' }),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    docType: text('doc_type', { enum: DOC_TYPES }).notNull(),
    status: text('status', { enum: ['OK', 'FAILED'] }).notNull(),
    model: text('model').notNull(),
    /** Extracted fields AFTER Aadhaar masking. Shape is validated by @thoudang/core schemas. */
    fields: text('fields_json', { mode: 'json' }).$type<Record<string, unknown>>(),
    errorMessage: text('error_message'),
    latencyMs: integer('latency_ms'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    meanConfidence: real('mean_confidence'),
    createdAt: createdAt(),
  },
  (t) => [index('extractions_case_idx').on(t.caseId)],
);

export const flags = sqliteTable(
  'flags',
  {
    id: text('id').primaryKey(),
    caseId: text('case_id')
      .notNull()
      .references(() => cases.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    severity: text('severity', { enum: ['info', 'warn', 'critical'] })
      .$type<Severity>()
      .notNull(),
    action: text('action', { enum: ['citizen', 'officer', 'none'] })
      .$type<FlagAction>()
      .notNull(),
    reason: text('reason').notNull(),
    evidence: text('evidence_json', { mode: 'json' }).$type<FlagEvidence[]>().notNull(),
    resolution: text('resolution', { enum: ['OPEN', 'ACCEPTED', 'OVERRIDDEN'] })
      .notNull()
      .default('OPEN'),
    resolvedBy: text('resolved_by'),
    resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }),
    resolutionReason: text('resolution_reason'),
    createdAt: createdAt(),
  },
  (t) => [index('flags_case_idx').on(t.caseId)],
);

/**
 * Append-only audit trail. UPDATE and DELETE are blocked by SQLite triggers
 * (see drizzle/0001_audit_log_append_only.sql).
 */
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    caseId: text('case_id'),
    actor: text('actor').notNull(),
    action: text('action', {
      enum: [
        'CASE_CREATED',
        'DOCUMENT_UPLOADED',
        'AI_EXTRACTION',
        'RULE_RESULT',
        'STATUS_CHANGE',
        'OFFICER_ACCEPT',
        'OFFICER_OVERRIDE',
        'OFFICER_APPROVE',
        'NOTICE_GENERATED',
      ],
    }).notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    before: text('before_json', { mode: 'json' }).$type<unknown>(),
    after: text('after_json', { mode: 'json' }).$type<unknown>(),
    reason: text('reason'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_case_idx').on(t.caseId)],
);

export const nameGazetteer = sqliteTable('name_gazetteer', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  surname: text('surname').notNull().unique(),
  community: text('community').notNull(),
  abbreviations: text('abbreviations_json', { mode: 'json' }).$type<string[]>().notNull(),
  source: text('source').notNull().default('starter'),
});
