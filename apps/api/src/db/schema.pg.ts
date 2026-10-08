/**
 * PostgreSQL mirror of schema.sqlite.ts — same tables, columns, defaults and indexes. Keep the two in
 * lock-step: change one, change the other, then `npm run db:generate -w @thoudang/api`.
 */
import {
  pgTable,
  text,
  integer,
  boolean,
  jsonb,
  serial,
  index,
  customType,
} from 'drizzle-orm/pg-core';
import type { FlagAction, FlagEvidence, Severity } from '@thoudang/core';

import {
  CASE_SOURCES,
  CASE_STATUSES,
  DETECTED_TYPES,
  DOCUMENT_STATES,
  OFFICER_ROLES,
  PROCESSING_STATES,
} from './schema.sqlite.js';

/**
 * Epoch milliseconds in a BIGINT, surfaced as a Date — the exact equivalent of SQLite's
 * integer({ mode: 'timestamp_ms' }), so raw SQL (audit chain, retention) sees the same numbers.
 * (The pool parses int8 to Number; see db/pg.ts.)
 */
const timestampMs = customType<{ data: Date; driverData: number | string }>({
  dataType: () => 'bigint',
  toDriver: (d) => d.getTime(),
  fromDriver: (v) => new Date(Number(v)),
});

const createdAt = () =>
  timestampMs('created_at')
    .notNull()
    .$defaultFn(() => new Date());

export const cases = pgTable(
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
    priorityReasons: jsonb('priority_reasons').$type<string[]>().notNull().default([]),
    /** Masked only — last 4 digits of Aadhaar. Full numbers are never stored. */
    aadhaarLast4: text('aadhaar_last4'),
    applicantDob: text('applicant_dob'),
    source: text('source', { enum: CASE_SOURCES }).notNull().default('desk'),
    batchId: text('batch_id'),
    packetName: text('packet_name'),
    receivedAt: timestampMs('received_at')
      .notNull()
      .$defaultFn(() => new Date()),
    decidedBy: text('decided_by'),
    decidedAt: timestampMs('decided_at'),
    /** When rules screening finished — for "avg screening time". */
    screenedAt: timestampMs('screened_at'),
    forwardedBy: text('forwarded_by'),
    forwardedAt: timestampMs('forwarded_at'),
    correctionRequestedAt: timestampMs('correction_requested_at'),
    noticeSentAt: timestampMs('notice_sent_at'),
    noticeSentBy: text('notice_sent_by'),
    /** Status at the FIRST screening — for "% first-time-right". */
    firstScreenStatus: text('first_screen_status', { enum: CASE_STATUSES }),
    /** Synthetic historical record (npm run seed:dashboard) — hidden from the live queue. */
    historical: boolean('historical').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: timestampMs('updated_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index('cases_status_priority_idx').on(t.status, t.priorityScore),
    index('cases_batch_idx').on(t.batchId),
  ],
);

export const documents = pgTable(
  'documents',
  {
    id: text('id').primaryKey(),
    caseId: text('case_id')
      .notNull()
      .references(() => cases.id, { onDelete: 'cascade' }),
    /** Set by the classifier; null until classified. */
    detectedType: text('detected_type', { enum: DETECTED_TYPES }),
    typeConfidence: text('type_confidence', { enum: ['high', 'medium', 'low'] }),
    /** 'officer' when dropped into a labelled intake slot (classification skipped), else 'ai'. */
    typeSource: text('type_source', { enum: ['ai', 'officer'] }),
    state: text('state', { enum: DOCUMENT_STATES }).notNull().default('UPLOADED'),
    originalName: text('original_name').notNull(),
    storedPath: text('stored_path').notNull(),
    processedPath: text('processed_path').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    /** Dimensions of the processed image — bbox coordinates refer to these. */
    widthPx: integer('width_px').notNull(),
    heightPx: integer('height_px').notNull(),
    /** SHA-256 of the processed image (cache key). */
    sha256: text('sha256').notNull(),
    position: integer('position').notNull().default(0),
    uploadedAt: createdAt(),
  },
  (t) => [index('documents_case_idx').on(t.caseId)],
);

export const extractions = pgTable(
  'extractions',
  {
    id: text('id').primaryKey(),
    caseId: text('case_id')
      .notNull()
      .references(() => cases.id, { onDelete: 'cascade' }),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    stage: text('stage', { enum: ['classify', 'extract'] }).notNull(),
    detectedType: text('detected_type', { enum: DETECTED_TYPES }),
    status: text('status', { enum: ['OK', 'FAILED'] }).notNull(),
    model: text('model').notNull(),
    /** Output AFTER Aadhaar masking. Never contains a full Aadhaar number. */
    result: jsonb('result_json').$type<Record<string, unknown>>(),
    errorMessage: text('error_message'),
    cacheHit: boolean('cache_hit').notNull().default(false),
    latencyMs: integer('latency_ms'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    createdAt: createdAt(),
  },
  (t) => [index('extractions_case_idx').on(t.caseId)],
);

/**
 * Local cache of (masked) Claude results keyed by processed-image SHA-256 + stage + prompt version.
 * Lets the live demo run without the network (DEMO_MODE=cache_first / cache_only).
 */
export const extractionCache = pgTable('extraction_cache', {
  key: text('key').primaryKey(),
  sha256: text('sha256').notNull(),
  stage: text('stage').notNull(),
  model: text('model').notNull(),
  promptVersion: text('prompt_version').notNull(),
  result: jsonb('result_json').$type<Record<string, unknown>>().notNull(),
  latencyMs: integer('latency_ms').notNull(),
  inputTokens: integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  createdAt: createdAt(),
});

export const flags = pgTable(
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
    evidence: jsonb('evidence_json').$type<FlagEvidence[]>().notNull(),
    resolution: text('resolution', { enum: ['OPEN', 'ACCEPTED', 'OVERRIDDEN'] })
      .notNull()
      .default('OPEN'),
    resolvedBy: text('resolved_by'),
    resolvedAt: timestampMs('resolved_at'),
    resolutionReason: text('resolution_reason'),
    createdAt: createdAt(),
  },
  (t) => [index('flags_case_idx').on(t.caseId)],
);

/**
 * Append-only audit trail. UPDATE and DELETE are blocked by PostgreSQL triggers
 * (see drizzle/pg/0001_audit_log_append_only.sql).
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: serial('id').primaryKey(),
    caseId: text('case_id'),
    actor: text('actor').notNull(),
    action: text('action', {
      enum: [
        'CASE_CREATED',
        'DOCUMENT_UPLOADED',
        'AI_CLASSIFICATION',
        'AI_EXTRACTION',
        'RULE_RESULT',
        'STATUS_CHANGE',
        'OFFICER_ACCEPT',
        'OFFICER_OVERRIDE',
        'OFFICER_APPROVE',
        'NOTICE_GENERATED',
        'PIPELINE_ERROR',
        'TYPE_SET_BY_OFFICER',
        'FIELD_EDITED',
        'OFFICER_NOTE',
        'SENT_FOR_CORRECTION',
        'FORWARDED_FOR_APPROVAL',
        'NOTICE_SENT',
        'TEMPLATE_EDITED',
        'DEMO_RESET',
      ],
    }).notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    before: jsonb('before_json').$type<unknown>(),
    after: jsonb('after_json').$type<unknown>(),
    reason: text('reason'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_case_idx').on(t.caseId)],
);

export const nameGazetteer = pgTable('name_gazetteer', {
  id: serial('id').primaryKey(),
  surname: text('surname').notNull().unique(),
  community: text('community').notNull(),
  abbreviations: jsonb('abbreviations_json').$type<string[]>().notNull(),
  source: text('source').notNull().default('starter'),
  /** high | medium | low — how sure the starter list is (department review pending). */
  confidence: text('confidence'),
  /** Naga / Kuki-Zo tribe, e.g. "Tangkhul", "Thadou". */
  tribe: text('tribe'),
});

/** Desk/phone upload staging (persisted so an API restart does not invalidate the QR code). */
export const uploadSessions = pgTable('upload_sessions', {
  id: text('id').primaryKey(),
  createdAt: createdAt(),
  submittedAt: timestampMs('submitted_at'),
  caseId: text('case_id'),
});

export const sessionFiles = pgTable(
  'session_files',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => uploadSessions.id, { onDelete: 'cascade' }),
    originalName: text('original_name').notNull(),
    path: text('path').notNull(),
    mimeType: text('mime_type').notNull(),
    size: integer('size').notNull(),
    from: text('from_device', { enum: ['desk', 'phone'] }).notNull(),
    /** Set when the officer chose a labelled slot / tapped a type on the phone. */
    docType: text('doc_type', { enum: DETECTED_TYPES }),
    addedAt: createdAt(),
  },
  (t) => [index('session_files_session_idx').on(t.sessionId)],
);

/** Demo officers (no passwords). Roles are enforced on the API. */
export const officers = pgTable('officers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  role: text('role', { enum: OFFICER_ROLES }).notNull(),
  district: text('district'),
});
