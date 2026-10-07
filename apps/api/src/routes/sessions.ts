import fs from 'node:fs';
import { Router } from 'express';
import sharp from 'sharp';
import type { EventBus } from '../events.js';
import { lanAddresses } from '../network.js';
import { PacketError, type Pipeline } from '../pipeline/pipeline.js';
import { MAX_FILES_PER_PACKET, type SessionStore, type UploadSession } from '../sessions.js';
import { createUploader } from '../upload.js';

export function sessionsRouter(deps: {
  sessions: SessionStore;
  pipeline: Pipeline;
  bus: EventBus;
  uploadsDir: string;
  webPort: number;
}): Router {
  const { sessions, pipeline, bus } = deps;
  const router = Router();
  const upload = createUploader(deps.uploadsDir, { maxFiles: MAX_FILES_PER_PACKET });

  const mobileUrl = (id: string) => {
    const ip = lanAddresses()[0] ?? 'localhost';
    return `http://${ip}:${deps.webPort}/m/upload/${id}`;
  };
  const view = (s: UploadSession) => ({
    sessionId: s.id,
    mobileUrl: mobileUrl(s.id),
    maxFiles: MAX_FILES_PER_PACKET,
    files: s.files.map((f) => ({
      id: f.id,
      originalName: f.originalName,
      size: f.size,
      from: f.from,
      thumbUrl: `/api/sessions/${s.id}/files/${f.id}`,
    })),
  });
  const find = (id: unknown) => {
    const s = sessions.get(String(id));
    if (!s) throw new NotFound('Upload session not found or already submitted');
    return s;
  };

  router.get('/network', (_req, res) => {
    const ips = lanAddresses();
    res.json({ lanIp: ips[0] ?? null, lanIps: ips, webPort: deps.webPort });
  });

  router.post('/sessions', (_req, res) => {
    res.status(201).json(view(sessions.create()));
  });

  router.get('/sessions/:id', (req, res) => {
    res.json(view(find(req.params.id)));
  });

  router.post('/sessions/:id/files', upload.array('files', MAX_FILES_PER_PACKET), (req, res) => {
    const session = find(req.params.id);
    const from = req.query.from === 'phone' ? 'phone' : 'desk';
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) throw new PacketError('No images received');
    const added = [];
    for (const f of files) {
      try {
        const entry = sessions.addFile(
          session.id,
          { tempPath: f.path, originalName: f.originalname, mimeType: f.mimetype, size: f.size },
          from,
        );
        added.push(entry.id);
        bus.publish({
          type: 'session',
          sessionId: session.id,
          action: 'file-added',
          fileId: entry.id,
        });
      } catch (err) {
        fs.rmSync(f.path, { force: true });
        throw new PacketError(err instanceof Error ? err.message : 'Could not add file');
      }
    }
    res.status(201).json(view(session));
  });

  router.get('/sessions/:id/files/:fileId', async (req, res) => {
    const file = find(req.params.id).files.find((f) => f.id === req.params.fileId);
    if (!file) throw new NotFound('File not found');
    try {
      const thumb = await sharp(file.path)
        .rotate()
        .resize({ width: 360, height: 360, fit: 'inside' })
        .jpeg({ quality: 75 })
        .toBuffer();
      res.type('image/jpeg').send(thumb);
    } catch {
      res.status(415).json({ error: 'Preview not available for this file type' });
    }
  });

  router.delete('/sessions/:id/files/:fileId', (req, res) => {
    const session = find(req.params.id);
    if (!sessions.removeFile(session.id, req.params.fileId)) throw new NotFound('File not found');
    bus.publish({
      type: 'session',
      sessionId: session.id,
      action: 'file-removed',
      fileId: req.params.fileId,
    });
    res.json(view(session));
  });

  router.post('/sessions/:id/submit', async (req, res) => {
    const session = find(req.params.id);
    if (!session.files.length) throw new PacketError('Add at least one image first');
    sessions.take(session.id);
    const created = await pipeline.createCase({
      files: session.files.map((f) => ({
        path: f.path,
        originalName: f.originalName,
        mimeType: f.mimeType,
        size: f.size,
      })),
      source: session.files.some((f) => f.from === 'phone') ? 'phone' : 'desk',
    });
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
