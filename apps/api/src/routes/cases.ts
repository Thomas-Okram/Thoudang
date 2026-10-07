import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { CaseStatusSchema } from '@thoudang/core';
import type { Db } from '../db/client.js';
import { documents, extractions, officers } from '../db/schema.js';
import { caseDetail, caseStats, listCases } from '../read-model.js';
import { redactionFor, renderRedacted } from '../services/redact.js';
import type { Pipeline } from '../pipeline/pipeline.js';
import {
  EXTRACTABLE_TYPES,
  type ExtractableType,
  type ExtractedDocument,
} from '../extraction/schemas.js';
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
    const paths = listField((req.body as Record<string, unknown> | undefined)?.paths);
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
    const status = CaseStatusSchema.safeParse(req.query.status);
    res.json({
      cases: listCases(db, {
        status: status.success ? status.data : undefined,
        batchId: typeof req.query.batchId === 'string' ? req.query.batchId : undefined,
        q: typeof req.query.q === 'string' ? req.query.q : undefined,
      }),
    });
  });

  router.get('/stats', (_req, res) => {
    res.json(caseStats(db));
  });

  router.get('/cases/:id', (req, res) => {
    const viewerId = req.header('x-officer-id');
    const viewer = viewerId
      ? (db.select().from(officers).where(eq(officers.id, viewerId)).get() ?? null)
      : null;
    const detail = caseDetail(db, req.params.id, viewer);
    if (!detail) {
      res.status(404).json({ error: 'Case not found' });
      return;
    }
    res.json(detail);
  });

  /**
   * Images are served REDACTED: the Aadhaar number is boxed out (or the card blurred when its
   * location is unknown). The unredacted file never leaves the server — not even ?variant=original.
   */
  router.get('/documents/:id/image', async (req, res) => {
    const doc = db.select().from(documents).where(eq(documents.id, req.params.id)).get();
    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    if (!doc.processedPath) {
      res.status(404).json({ error: 'No preview available — the image could not be opened' });
      return;
    }
    const ext = db
      .select()
      .from(extractions)
      .where(
        and(
          eq(extractions.documentId, doc.id),
          eq(extractions.stage, 'extract'),
          eq(extractions.status, 'OK'),
        ),
      )
      .orderBy(desc(extractions.createdAt))
      .get();
    const size = { width: doc.widthPx, height: doc.heightPx };
    const redaction = redactionFor(
      doc.detectedType,
      (ext?.result as unknown as ExtractedDocument) ?? null,
      size,
    );
    const thumb = req.query.variant === 'thumb' ? 360 : undefined;
    const body = await renderRedacted(doc.processedPath, redaction, size, thumb);
    res
      .set({ 'X-Redaction': redaction.mode, 'Cache-Control': 'no-store' })
      .type('image/jpeg')
      .send(body);
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
