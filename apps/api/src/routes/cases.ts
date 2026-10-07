import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import sharp from 'sharp';
import { and, asc, desc, eq, type SQL } from 'drizzle-orm';
import { CaseStatusSchema, noticeEligibility, type Flag } from '@thoudang/core';
import type { Db } from '../db/client.js';
import { auditLog, cases, documents, extractions, flags as flagsTable } from '../db/schema.js';
import type { Pipeline } from '../pipeline/pipeline.js';
import { EXTRACTABLE_TYPES, type ExtractableType } from '../extraction/schemas.js';
import { PacketError } from '../pipeline/pipeline.js';
import {
  createUploader,
  expandZip,
  groupIntoPackets,
  toIncoming,
  type RelativeFile,
} from '../upload.js';

export function casesRouter(deps: { db: Db; pipeline: Pipeline; uploadsDir: string }): Router {
  const { db, pipeline, uploadsDir } = deps;
  const router = Router();
  const packetUpload = createUploader(uploadsDir, { maxFiles: 6 });
  const batchUpload = createUploader(uploadsDir, { maxFiles: 400, allowZip: true });

  router.post('/cases', packetUpload.array('files', 6), async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) throw new PacketError('Upload 1–6 images (field name "files")');
    // Optional parallel "types" field: one per file ("" = let the AI classify).
    const types = listField((req.body as Record<string, unknown> | undefined)?.types);
    const created = await pipeline.createCase({
      files: files.map((f, i) => ({
        ...toIncoming(f),
        docType: types.length === files.length ? parseSlotType(types[i]) : null,
      })),
      source: 'api',
    });
    res.status(202).json(created);
  });

  router.post('/cases/batch', batchUpload.array('files', 400), async (req, res) => {
    const uploaded = (req.files as Express.Multer.File[] | undefined) ?? [];
    const tmp = path.join(uploadsDir, 'tmp');
    // Relative folder paths come in a parallel "paths" field (one per file, same order), because
    // multipart clients often strip directories from file names. Fallback: the file name itself.
    const rawPaths: unknown = (req.body as Record<string, unknown> | undefined)?.paths;
    const paths = Array.isArray(rawPaths)
      ? rawPaths.map(String)
      : typeof rawPaths === 'string'
        ? [rawPaths]
        : [];
    const relFiles: RelativeFile[] = [];
    for (const [i, f] of uploaded.entries()) {
      if (path.extname(f.originalname).toLowerCase() === '.zip') {
        relFiles.push(...expandZip(f.path, tmp));
        fs.rmSync(f.path, { force: true });
      } else {
        relFiles.push({
          ...toIncoming(f),
          relPath: paths.length === uploaded.length ? paths[i]! : f.originalname,
        });
      }
    }
    const packets = groupIntoPackets(relFiles);
    if (!packets.length) throw new PacketError('No images found. Use one sub-folder per packet.');
    const batchId = crypto.randomUUID();
    const created: { caseId: string; reference: string; packetName: string; documents: number }[] =
      [];
    const skipped: { packetName: string; reason: string }[] = [];
    for (const p of packets) {
      if (p.files.length > 6) {
        skipped.push({
          packetName: p.name,
          reason: `${p.files.length} images — a packet has at most 6`,
        });
        p.files.forEach((f) => fs.rmSync(f.path, { force: true }));
        continue;
      }
      const c = await pipeline.createCase({
        files: p.files,
        source: 'batch',
        batchId,
        packetName: p.name,
      });
      created.push({ ...c, packetName: p.name });
    }
    // Files that were not part of any packet (non-images inside folders) are cleaned up.
    const used = new Set(packets.flatMap((p) => p.files.map((f) => f.path)));
    relFiles.filter((f) => !used.has(f.path)).forEach((f) => fs.rmSync(f.path, { force: true }));
    res.status(202).json({ batchId, cases: created, skipped });
  });

  router.get('/cases', (req, res) => {
    const where: SQL[] = [];
    const status = CaseStatusSchema.safeParse(req.query.status);
    if (status.success) where.push(eq(cases.status, status.data));
    if (typeof req.query.batchId === 'string') where.push(eq(cases.batchId, req.query.batchId));
    const rows = db
      .select()
      .from(cases)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(cases.priorityScore), asc(cases.receivedAt))
      .all();
    res.json({ cases: rows.map(caseSummary) });
  });

  router.get('/cases/:id', (req, res) => {
    const detail = caseDetail(db, req.params.id);
    if (!detail) {
      res.status(404).json({ error: 'Case not found' });
      return;
    }
    res.json(detail);
  });

  router.get('/documents/:id/image', async (req, res) => {
    const doc = db.select().from(documents).where(eq(documents.id, req.params.id)).get();
    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    const variant =
      req.query.variant === 'original'
        ? 'original'
        : req.query.variant === 'thumb'
          ? 'thumb'
          : 'processed';
    const file = variant === 'original' || !doc.processedPath ? doc.storedPath : doc.processedPath;
    if (variant === 'thumb') {
      if (!doc.processedPath) {
        res.status(404).json({ error: 'No preview available' });
        return;
      }
      const thumb = await sharp(file)
        .resize({ width: 360, height: 360, fit: 'inside' })
        .jpeg({ quality: 75 })
        .toBuffer();
      res.type('image/jpeg').send(thumb);
      return;
    }
    res.sendFile(path.resolve(file));
  });

  return router;
}

const listField = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? [raw] : [];

/** Labelled slot value → extractable type, or null for "unsorted" / anything unknown. */
export function parseSlotType(raw: unknown): ExtractableType | null {
  return typeof raw === 'string' && (EXTRACTABLE_TYPES as readonly string[]).includes(raw)
    ? (raw as ExtractableType)
    : null;
}

export function caseSummary(row: typeof cases.$inferSelect) {
  return {
    id: row.id,
    reference: row.reference,
    applicantName: row.applicantName,
    district: row.district,
    status: row.status,
    processingState: row.processingState,
    priorityScore: row.priorityScore,
    priorityReasons: row.priorityReasons,
    aadhaarMasked: row.aadhaarLast4 ? `XXXX XXXX ${row.aadhaarLast4}` : null,
    applicantDob: row.applicantDob,
    source: row.source,
    batchId: row.batchId,
    packetName: row.packetName,
    receivedAt: row.receivedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function caseDetail(db: Db, id: string) {
  const row = db.select().from(cases).where(eq(cases.id, id)).get();
  if (!row) return null;
  const docs = db
    .select()
    .from(documents)
    .where(eq(documents.caseId, id))
    .orderBy(documents.position)
    .all();
  const calls = db
    .select()
    .from(extractions)
    .where(eq(extractions.caseId, id))
    .orderBy(asc(extractions.createdAt))
    .all();
  const flagRows = db.select().from(flagsTable).where(eq(flagsTable.caseId, id)).all();
  const audit = db
    .select()
    .from(auditLog)
    .where(eq(auditLog.caseId, id))
    .orderBy(asc(auditLog.id))
    .all();
  const flagList: Flag[] = flagRows.map((f) => ({
    code: f.code,
    severity: f.severity,
    action: f.action,
    reason: f.reason,
    evidence: f.evidence,
  }));
  const latest = (docId: string, stage: 'classify' | 'extract') =>
    calls.filter((c) => c.documentId === docId && c.stage === stage).at(-1) ?? null;

  return {
    case: caseSummary(row),
    documents: docs.map((d) => {
      const cls = latest(d.id, 'classify');
      const ext = latest(d.id, 'extract');
      return {
        id: d.id,
        originalName: d.originalName,
        detectedType: d.detectedType,
        typeConfidence: d.typeConfidence,
        typeSource: d.typeSource,
        state: d.state,
        width: d.widthPx,
        height: d.heightPx,
        imageUrl: `/api/documents/${d.id}/image`,
        thumbUrl: `/api/documents/${d.id}/image?variant=thumb`,
        classification: cls?.status === 'OK' ? cls.result : null,
        extraction: ext?.status === 'OK' ? ext.result : null,
        error: (ext ?? cls)?.status === 'FAILED' ? (ext ?? cls)?.errorMessage : null,
        cacheHit: Boolean(ext?.cacheHit ?? cls?.cacheHit),
        latencyMs: (cls?.latencyMs ?? 0) + (ext?.latencyMs ?? 0),
      };
    }),
    flags: flagRows.map((f) => ({
      ...f,
      createdAt: f.createdAt.toISOString(),
      resolvedAt: f.resolvedAt?.toISOString() ?? null,
    })),
    notice: noticeEligibility(flagList),
    audit: audit.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
  };
}
