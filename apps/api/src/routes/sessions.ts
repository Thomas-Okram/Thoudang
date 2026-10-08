import fs from 'node:fs';
import { Router } from 'express';
import sharp from 'sharp';
import type { EventBus } from '../events.js';
import { lanAddresses } from '../network.js';
import { PacketError, type Pipeline } from '../pipeline/pipeline.js';
import { MAX_FILES_PER_PACKET, type SessionStore, type UploadSession } from '../sessions.js';
import { toDecodable } from '../services/images.js';
import { createUploader } from '../upload.js';
import { parseSlotType } from './cases.js';
import { streamEvents } from './events.js';

export function sessionsRouter(deps: {
  sessions: SessionStore;
  pipeline: Pipeline;
  bus: EventBus;
  uploadsDir: string;
  webPort: number;
  publicBaseUrl: string | null;
}): Router {
  const { sessions, pipeline, bus } = deps;
  const router = Router();
  const upload = createUploader(deps.uploadsDir, { maxFiles: MAX_FILES_PER_PACKET });

  const baseUrl = () =>
    deps.publicBaseUrl ?? `http://${lanAddresses()[0] ?? 'localhost'}:${deps.webPort}`;
  const mobileUrl = (id: string) => `${baseUrl()}/m/upload/${id}`;
  const view = (s: UploadSession) => ({
    sessionId: s.id,
    mobileUrl: mobileUrl(s.id),
    maxFiles: MAX_FILES_PER_PACKET,
    files: s.files.map((f) => ({
      id: f.id,
      originalName: f.originalName,
      size: f.size,
      from: f.from,
      docType: f.docType,
      thumbUrl: `/api/sessions/${s.id}/files/${f.id}`,
    })),
  });
  const find = async (id: unknown) => {
    const s = await sessions.get(String(id));
    if (!s) throw new NotFound('Upload session not found or already submitted');
    return s;
  };

  router.get('/network', (_req, res) => {
    const ips = lanAddresses();
    res.json({
      lanIp: ips[0] ?? null,
      lanIps: ips,
      webPort: deps.webPort,
      publicBaseUrl: deps.publicBaseUrl,
    });
  });

  router.post('/sessions', async (_req, res) => {
    res.status(201).json(view(await sessions.create()));
  });

  router.get('/sessions/:id', async (req, res) => {
    res.json(view(await find(req.params.id)));
  });

  /**
   * Live updates for the phone page. Public like the rest of /sessions/:id (the id is the QR
   * capability) — so it streams ONLY this session's events, never case events.
   */
  router.get('/sessions/:id/events', async (req, res) => {
    const id = (await find(req.params.id)).id;
    streamEvents(req, res, bus, (e) => e.type === 'session' && e.sessionId === id);
  });

  /** ?from=phone|desk  ?type=application_form|aadhaar|bank_passbook|epic (omit = unsorted) */
  router.post(
    '/sessions/:id/files',
    upload.array('files', MAX_FILES_PER_PACKET),
    async (req, res) => {
      const session = await find(req.params.id);
      const from = req.query.from === 'phone' ? 'phone' : 'desk';
      const docType = parseSlotType(req.query.type);
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (!files.length) throw new PacketError('No images received');
      for (const f of files) {
        try {
          const entry = await sessions.addFile(
            session.id,
            { tempPath: f.path, originalName: f.originalname, mimeType: f.mimetype, size: f.size },
            from,
            docType,
          );
          bus.publish({
            type: 'session',
            sessionId: session.id,
            action: 'file-added',
            fileId: entry.id,
          });
        } catch (err) {
          files.forEach((x) => fs.rmSync(x.path, { force: true }));
          throw new PacketError(err instanceof Error ? err.message : 'Could not add file');
        }
      }
      res.status(201).json(view(await find(session.id)));
    },
  );

  /**
   * Preview thumbnail. Until the AI has located the Aadhaar number (after "Screen application"),
   * any image that may carry one — Aadhaar, form, or unsorted — is served BLURRED, so the full
   * number is never shown on a projector. Passbook and voter-ID previews stay sharp.
   */
  router.get('/sessions/:id/files/:fileId', async (req, res) => {
    const file = (await find(req.params.id)).files.find((f) => f.id === req.params.fileId);
    if (!file) throw new NotFound('File not found');
    const safe = file.docType === 'bank_passbook' || file.docType === 'epic';
    try {
      let img = sharp(await toDecodable(fs.readFileSync(file.path)))
        .rotate()
        .resize({ width: 360, height: 360, fit: 'inside' });
      if (!safe) img = sharp(await img.toBuffer()).blur(6);
      const thumb = await img.jpeg({ quality: 75 }).toBuffer();
      res
        .set({ 'X-Redaction': safe ? 'none' : 'blur', 'Cache-Control': 'no-store' })
        .type('image/jpeg')
        .send(thumb);
    } catch {
      res.status(415).json({ error: 'Preview not available for this file type' });
    }
  });

  /** Move a file to another slot: { docType: "aadhaar" } or { docType: null } for unsorted. */
  router.patch('/sessions/:id/files/:fileId', async (req, res) => {
    const session = await find(req.params.id);
    const body = (req.body ?? {}) as { docType?: unknown };
    if (!(await sessions.setFileType(session.id, req.params.fileId, parseSlotType(body.docType)))) {
      throw new NotFound('File not found');
    }
    bus.publish({
      type: 'session',
      sessionId: session.id,
      action: 'file-added',
      fileId: req.params.fileId,
    });
    res.json(view(await find(session.id)));
  });

  router.delete('/sessions/:id/files/:fileId', async (req, res) => {
    const session = await find(req.params.id);
    if (!(await sessions.removeFile(session.id, req.params.fileId)))
      throw new NotFound('File not found');
    bus.publish({
      type: 'session',
      sessionId: session.id,
      action: 'file-removed',
      fileId: req.params.fileId,
    });
    res.json(view(await find(session.id)));
  });

  router.post('/sessions/:id/submit', async (req, res) => {
    const session = await find(req.params.id);
    if (!session.files.length) throw new PacketError('Add at least one image first');
    await sessions.take(session.id);
    const created = await pipeline.createCase({
      files: session.files.map((f) => ({
        path: f.path,
        originalName: f.originalName,
        mimeType: f.mimeType,
        size: f.size,
        docType: parseSlotType(f.docType),
      })),
      source: session.files.some((f) => f.from === 'phone') ? 'phone' : 'desk',
    });
    await sessions.linkCase(session.id, created.caseId);
    bus.publish({
      type: 'session',
      sessionId: session.id,
      action: 'submitted',
      caseId: created.caseId,
    });
    res.status(202).json(created);
  });

  return router;
}

export class NotFound extends Error {
  readonly status = 404;
}
