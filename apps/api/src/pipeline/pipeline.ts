import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { redactAadhaarInText, type Flag } from '@thoudang/core';
import type { Db } from '../db/client.js';
import {
  auditLog,
  cases,
  documents,
  extractions,
  flags as flagsTable,
  type CASE_SOURCES,
} from '../db/schema.js';
import type { CaseStage, EventBus } from '../events.js';
import type { Logger } from '../logger.js';
import { preprocessImage, type ProcessedImage } from '../services/images.js';
import { EXTRACTABLE_TYPES, type ExtractableType } from '../extraction/schemas.js';
import type { ExtractionService, StageOutcome } from '../extraction/service.js';
import type { DocOutcome } from './mapping.js';
import { rescreenCase } from './screening.js';

export interface IncomingFile {
  /** Temporary path on the same filesystem as uploadsDir (moved, not copied). */
  path: string;
  originalName: string;
  mimeType: string;
  size: number;
  /** Set when the officer put the image in a labelled slot — classification is skipped. */
  docType?: ExtractableType | null;
}

export interface CreateCaseInput {
  files: IncomingFile[];
  source: (typeof CASE_SOURCES)[number];
  batchId?: string | null;
  packetName?: string | null;
}

export interface CreatedCase {
  caseId: string;
  reference: string;
  documents: number;
}

export interface PipelineDeps {
  db: Db;
  extraction: ExtractionService;
  bus: EventBus;
  logger: Logger;
  uploadsDir: string;
  /** Screening date (YYYY-MM-DD). Defaults to today in India Standard Time. */
  today?: () => string;
}

export const MAX_IMAGES_PER_PACKET = 6;
const SYSTEM_ACTOR = 'system:pipeline';
const AI_ACTOR = 'system:claude';
const RULES_ACTOR = 'system:rules';

const istToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

type DocRow = typeof documents.$inferSelect;

export class Pipeline {
  private readonly inflight = new Set<Promise<void>>();

  constructor(private readonly deps: PipelineDeps) {}

  /** Resolves when every running case has finished (tests, eval, graceful shutdown). */
  async whenIdle(): Promise<void> {
    while (this.inflight.size) await Promise.allSettled([...this.inflight]);
  }

  /** Stores the packet and starts processing in the background. Returns immediately. */
  async createCase(input: CreateCaseInput): Promise<CreatedCase> {
    const { db, bus } = this.deps;
    if (input.files.length < 1 || input.files.length > MAX_IMAGES_PER_PACKET) {
      throw new PacketError(`A packet must have 1–${MAX_IMAGES_PER_PACKET} images`);
    }
    const caseId = crypto.randomUUID();
    const reference = this.nextReference();
    db.insert(cases)
      .values({
        id: caseId,
        reference,
        source: input.source,
        batchId: input.batchId ?? null,
        packetName: input.packetName ?? null,
      })
      .run();
    this.audit(caseId, SYSTEM_ACTOR, 'CASE_CREATED', 'case', caseId, null, {
      reference,
      source: input.source,
      images: input.files.length,
    });

    const caseDir = path.join(this.deps.uploadsDir, caseId);
    fs.mkdirSync(caseDir, { recursive: true });
    for (const [position, file] of input.files.entries()) {
      await this.storeDocument(caseId, caseDir, file, position);
    }

    bus.publish({
      type: 'case',
      caseId,
      reference,
      batchId: input.batchId ?? null,
      stage: 'uploaded',
    });
    const run = this.process(caseId).finally(() => this.inflight.delete(run));
    this.inflight.add(run);
    return { caseId, reference, documents: input.files.length };
  }

  private nextReference(): string {
    const year = new Date().getFullYear();
    const row = this.deps.db
      .select({ n: sql<number>`count(*)` })
      .from(cases)
      .get();
    let n = (row?.n ?? 0) + 1;
    for (;;) {
      const reference = `THD-${year}-${String(n).padStart(4, '0')}`;
      const exists = this.deps.db
        .select({ id: cases.id })
        .from(cases)
        .where(eq(cases.reference, reference))
        .get();
      if (!exists) return reference;
      n += 1;
    }
  }

  private async storeDocument(
    caseId: string,
    caseDir: string,
    file: IncomingFile,
    position: number,
  ) {
    const docId = crypto.randomUUID();
    const ext = path.extname(file.originalName).toLowerCase() || '.bin';
    const originalPath = path.join(caseDir, `${docId}-original${ext}`);
    fs.renameSync(file.path, originalPath);

    let processed: ProcessedImage | null = null;
    let processedPath = '';
    try {
      processed = await preprocessImage(fs.readFileSync(originalPath));
      processedPath = path.join(caseDir, `${docId}-processed.jpg`);
      fs.writeFileSync(processedPath, processed.buffer);
    } catch (err) {
      this.deps.logger.warn('Image could not be decoded', {
        caseId,
        file: file.originalName,
        reason: err instanceof Error ? err.message : 'unknown',
      });
    }

    this.deps.db
      .insert(documents)
      .values({
        id: docId,
        caseId,
        originalName: path.basename(file.originalName),
        storedPath: originalPath,
        processedPath,
        mimeType: file.mimeType,
        sizeBytes: file.size,
        widthPx: processed?.width ?? 0,
        heightPx: processed?.height ?? 0,
        sha256: processed?.sha256 ?? '',
        position,
        state: processed ? (file.docType ? 'CLASSIFIED' : 'UPLOADED') : 'FAILED',
        detectedType: file.docType ?? null,
        typeConfidence: file.docType ? 'high' : null,
        typeSource: file.docType ? 'officer' : null,
      })
      .run();
    this.audit(caseId, SYSTEM_ACTOR, 'DOCUMENT_UPLOADED', 'document', docId, null, {
      originalName: path.basename(file.originalName),
      sizeBytes: file.size,
      sha256: processed?.sha256 ?? null,
      width: processed?.width ?? null,
      height: processed?.height ?? null,
      decoded: Boolean(processed),
    });
    if (file.docType) {
      this.audit(caseId, SYSTEM_ACTOR, 'TYPE_SET_BY_OFFICER', 'document', docId, null, {
        detectedType: file.docType,
        note: 'Type set by officer (labelled intake slot) — AI classification skipped',
      });
    }
  }

  /** Never throws: any unexpected error lands the case in OFFICER_ATTENTION. */
  private async process(caseId: string): Promise<void> {
    const { db } = this.deps;
    const row = db.select().from(cases).where(eq(cases.id, caseId)).get();
    if (!row) return;
    const ctx = { caseId, reference: row.reference, batchId: row.batchId };
    try {
      db.update(cases)
        .set({ processingState: 'EXTRACTING', updatedAt: new Date() })
        .where(eq(cases.id, caseId))
        .run();
      const docs = db
        .select()
        .from(documents)
        .where(eq(documents.caseId, caseId))
        .orderBy(documents.position)
        .all();

      this.emitCase(ctx, 'classifying');
      const classified = await Promise.all(docs.map((d) => this.classifyDocument(ctx, d)));

      this.emitCase(ctx, 'extracting');
      await Promise.all(docs.map((d, i) => this.extractDocument(ctx, d, classified[i]!)));

      this.emitCase(ctx, 'screening');
      this.screen(ctx);
    } catch (err) {
      this.fail(ctx, err);
    }
  }

  private async classifyDocument(
    ctx: CaseCtx,
    doc: DocRow,
  ): Promise<{ type: ExtractableType | 'other' } | { error: string }> {
    if (!doc.processedPath) return { error: 'The image could not be opened (unsupported format?)' };
    if (doc.typeSource === 'officer' && doc.detectedType) {
      this.emitDoc(ctx, doc, 'classified', {
        detectedType: doc.detectedType,
        message: 'Type set by officer',
      });
      return { type: doc.detectedType };
    }
    this.emitDoc(ctx, doc, 'classifying');
    const image = this.loadImage(doc);
    const out = await this.deps.extraction.classify(image, doc.originalName);
    this.recordCall(ctx.caseId, doc.id, 'classify', out, out.ok ? out.value.type : null);
    if (!out.ok) {
      this.deps.db.update(documents).set({ state: 'FAILED' }).where(eq(documents.id, doc.id)).run();
      this.emitDoc(ctx, doc, 'failed', { message: out.error, cacheHit: out.cacheHit });
      return { error: out.error };
    }
    this.deps.db
      .update(documents)
      .set({
        detectedType: out.value.type,
        typeConfidence: out.value.confidence,
        typeSource: 'ai',
        state: 'CLASSIFIED',
      })
      .where(eq(documents.id, doc.id))
      .run();
    this.emitDoc(ctx, doc, 'classified', { detectedType: out.value.type, cacheHit: out.cacheHit });
    return { type: out.value.type };
  }

  private async extractDocument(
    ctx: CaseCtx,
    doc: DocRow,
    classified: { type: ExtractableType | 'other' } | { error: string },
  ): Promise<DocOutcome> {
    if ('error' in classified) return { kind: 'unidentified', error: classified.error };
    if (classified.type === 'other' || !EXTRACTABLE_TYPES.includes(classified.type)) {
      this.deps.db
        .update(documents)
        .set({ state: 'SKIPPED' })
        .where(eq(documents.id, doc.id))
        .run();
      this.emitDoc(ctx, doc, 'skipped', {
        detectedType: 'other',
        message: 'Not part of the application packet',
      });
      return { kind: 'other' };
    }
    const type = classified.type;
    this.emitDoc(ctx, doc, 'extracting', { detectedType: type });
    const out = await this.deps.extraction.extract(type, this.loadImage(doc), doc.originalName);
    this.recordCall(ctx.caseId, doc.id, 'extract', out, type);
    this.deps.db
      .update(documents)
      .set({ state: out.ok ? 'EXTRACTED' : 'FAILED' })
      .where(eq(documents.id, doc.id))
      .run();
    this.emitDoc(ctx, doc, out.ok ? 'extracted' : 'failed', {
      detectedType: type,
      cacheHit: out.cacheHit,
      message: out.ok ? undefined : out.error,
    });
    return out.ok
      ? { kind: 'extracted', type, doc: out.value }
      : { kind: 'extraction_failed', type, error: out.error };
  }

  private screen(ctx: CaseCtx): void {
    const { result, status } = rescreenCase(this.deps.db, ctx.caseId, {
      today: (this.deps.today ?? istToday)(),
    });
    this.audit(ctx.caseId, RULES_ACTOR, 'RULE_RESULT', 'case', ctx.caseId, null, {
      status,
      priorityScore: result.priorityScore,
      priorityReasons: result.priorityReasons,
      flags: result.flags.map((f: Flag) => ({
        code: f.code,
        severity: f.severity,
        action: f.action,
      })),
    });
    this.emitCase(ctx, 'done', { status });
    this.deps.logger.info('Case screened', {
      reference: ctx.reference,
      status,
      flags: result.flags.length,
    });
  }

  private fail(ctx: CaseCtx, err: unknown): void {
    const message = redactAadhaarInText(err instanceof Error ? err.message : 'unknown error');
    this.deps.logger.error('Pipeline failed', { reference: ctx.reference, message });
    try {
      const { db } = this.deps;
      db.insert(flagsTable)
        .values({
          id: crypto.randomUUID(),
          caseId: ctx.caseId,
          code: 'EXTRACTION_FAILED',
          severity: 'warn',
          action: 'officer',
          reason:
            'Extraction failed — manual review needed. The system hit an unexpected error while processing this packet.',
          evidence: [{ document: 'form', field: 'document', value: message }],
        })
        .run();
      db.update(cases)
        .set({
          status: 'OFFICER_ATTENTION',
          processingState: 'EXTRACTION_FAILED',
          updatedAt: new Date(),
        })
        .where(eq(cases.id, ctx.caseId))
        .run();
      this.audit(ctx.caseId, SYSTEM_ACTOR, 'PIPELINE_ERROR', 'case', ctx.caseId, null, { message });
    } finally {
      this.emitCase(ctx, 'error', { message: 'Extraction failed — manual review' });
      this.emitCase(ctx, 'done', { status: 'OFFICER_ATTENTION' });
    }
  }

  private loadImage(doc: DocRow): ProcessedImage {
    return {
      buffer: fs.readFileSync(doc.processedPath),
      width: doc.widthPx,
      height: doc.heightPx,
      sha256: doc.sha256,
      mediaType: 'image/jpeg',
    };
  }

  private recordCall<T>(
    caseId: string,
    documentId: string,
    stage: 'classify' | 'extract',
    out: StageOutcome<T>,
    detectedType: DocRow['detectedType'],
  ): void {
    const result = out.ok ? (out.value as unknown as Record<string, unknown>) : null;
    const id = crypto.randomUUID();
    this.deps.db
      .insert(extractions)
      .values({
        id,
        caseId,
        documentId,
        stage,
        detectedType,
        status: out.ok ? 'OK' : 'FAILED',
        model: out.model,
        result,
        errorMessage: out.ok ? null : out.error,
        cacheHit: out.cacheHit,
        latencyMs: out.latencyMs,
        inputTokens: out.inputTokens,
        outputTokens: out.outputTokens,
      })
      .run();
    this.audit(
      caseId,
      AI_ACTOR,
      stage === 'classify' ? 'AI_CLASSIFICATION' : 'AI_EXTRACTION',
      'document',
      documentId,
      null,
      {
        extractionId: id,
        ok: out.ok,
        model: out.model,
        cacheHit: out.cacheHit,
        latencyMs: out.latencyMs,
        inputTokens: out.inputTokens,
        outputTokens: out.outputTokens,
        detectedType,
        ...(out.ok && stage === 'extract'
          ? {
              fieldsRead: countRead(
                out.value as unknown as { fields?: Record<string, { value: unknown }> },
              ),
            }
          : {}),
        ...(out.ok ? {} : { error: out.error }),
      },
    );
  }

  private audit(
    caseId: string,
    actor: string,
    action: (typeof auditLog.$inferInsert)['action'],
    entityType: string,
    entityId: string,
    before: unknown,
    after: unknown,
  ): void {
    this.deps.db
      .insert(auditLog)
      .values({ caseId, actor, action, entityType, entityId, before, after })
      .run();
  }

  private emitCase(
    ctx: CaseCtx,
    stage: CaseStage,
    extra: { status?: string; message?: string } = {},
  ) {
    this.deps.bus.publish({
      type: 'case',
      caseId: ctx.caseId,
      reference: ctx.reference,
      batchId: ctx.batchId,
      stage,
      ...extra,
    });
  }

  private emitDoc(
    ctx: CaseCtx,
    doc: DocRow,
    stage: 'classifying' | 'classified' | 'extracting' | 'extracted' | 'failed' | 'skipped',
    extra: { detectedType?: DocRow['detectedType']; cacheHit?: boolean; message?: string } = {},
  ) {
    this.deps.bus.publish({
      type: 'document',
      caseId: ctx.caseId,
      batchId: ctx.batchId,
      documentId: doc.id,
      originalName: doc.originalName,
      stage,
      ...extra,
    });
  }
}

interface CaseCtx {
  caseId: string;
  reference: string;
  batchId: string | null;
}

const countRead = (doc: { fields?: Record<string, { value: unknown }> }) =>
  Object.values(doc.fields ?? {}).filter((f) => f.value !== null).length;

export class PacketError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PacketError';
  }
}
