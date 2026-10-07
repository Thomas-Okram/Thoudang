import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import type { CaseStatus, FlagAction, FlagEvidence, Severity } from '@thoudang/core';

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

/** Document labels produced by the classifier (Claude). "other" = not part of the packet. */
export const DETECTED_TYPES = [
  'application_form',
  'aadhaar',
  'bank_passbook',
  'epic',
  'other',
] as const;
export type DetectedType = (typeof DETECTED_TYPES)[number];

/** Per-document pipeline progress. */
export const DOCUMENT_STATES = [
  'UPLOADED',
  'CLASSIFIED',
  'EXTRACTED',
  'FAILED',
  'SKIPPED',
] as const;

export const CASE_SOURCES = ['desk', 'phone', 'batch', 'api', 'eval'] as const;

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
    source: text('source', { enum: CASE_SOURCES }).notNull().default('desk'),
    batchId: text('batch_id'),
    packetName: text('packet_name'),
    receivedAt: integer('received_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    decidedBy: text('decided_by'),
    decidedAt: integer('decided_at', { mode: 'timestamp_ms' }),
    /** When rules screening finished — for "avg screening time". */
    screenedAt: integer('screened_at', { mode: 'timestamp_ms' }),
    forwardedBy: text('forwarded_by'),
    forwardedAt: integer('forwarded_at', { mode: 'timestamp_ms' }),
    correctionRequestedAt: integer('correction_requested_at', { mode: 'timestamp_ms' }),
    noticeSentAt: integer('notice_sent_at', { mode: 'timestamp_ms' }),
    noticeSentBy: text('notice_sent_by'),
    /** Status at the FIRST screening — for "% first-time-right". */
    firstScreenStatus: text('first_screen_status', { enum: CASE_STATUSES }),
    /** Synthetic historical record (npm run seed:dashboard) — hidden from the live queue. */
    historical: integer('historical', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index('cases_status_priority_idx').on(t.status, t.priorityScore),
    index('cases_batch_idx').on(t.batchId),
  ],
);

export const documents = sqliteTable(
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
    stage: text('stage', { enum: ['classify', 'extract'] }).notNull(),
    detectedType: text('detected_type', { enum: DETECTED_TYPES }),
    status: text('status', { enum: ['OK', 'FAILED'] }).notNull(),
    model: text('model').notNull(),
    /** Output AFTER Aadhaar masking. Never contains a full Aadhaar number. */
    result: text('result_json', { mode: 'json' }).$type<Record<string, unknown>>(),
    errorMessage: text('error_message'),
    cacheHit: integer('cache_hit', { mode: 'boolean' }).notNull().default(false),
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
export const extractionCache = sqliteTable('extraction_cache', {
  key: text('key').primaryKey(),
  sha256: text('sha256').notNull(),
  stage: text('stage').notNull(),
  model: text('model').notNull(),
  promptVersion: text('prompt_version').notNull(),
  result: text('result_json', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  latencyMs: integer('latency_ms').notNull(),
  inputTokens: integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  createdAt: createdAt(),
});

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

/** Desk/phone upload staging (persisted so an API restart does not invalidate the QR code). */
export const uploadSessions = sqliteTable('upload_sessions', {
  id: text('id').primaryKey(),
  createdAt: createdAt(),
  submittedAt: integer('submitted_at', { mode: 'timestamp_ms' }),
  caseId: text('case_id'),
});

export const sessionFiles = sqliteTable(
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

export const OFFICER_ROLES = ['DSWO', 'DEALING_ASSISTANT'] as const;
export type OfficerRole = (typeof OFFICER_ROLES)[number];

/** Demo officers (no passwords). Roles are enforced on the API. */
export const officers = sqliteTable('officers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  role: text('role', { enum: OFFICER_ROLES }).notNull(),
  district: text('district'),
});
