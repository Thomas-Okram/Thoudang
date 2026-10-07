import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Db } from './db/client.js';
import { sessionFiles, uploadSessions, type DetectedType } from './db/schema.js';

export interface SessionFile {
  id: string;
  originalName: string;
  path: string;
  mimeType: string;
  size: number;
  from: 'desk' | 'phone';
  /** Officer-chosen slot; null = unsorted (the AI classifies it). */
  docType: DetectedType | null;
  addedAt: Date;
}

export interface UploadSession {
  id: string;
  createdAt: Date;
  files: SessionFile[];
}

export const MAX_FILES_PER_PACKET = 6;

/**
 * Staging area for one packet. The desk (drag-drop into labelled slots) and a phone (QR link)
 * both add images to the same session; "Screen application" turns it into a case.
 * Persisted in SQLite so an API restart does not invalidate the QR code on screen.
 */
export class SessionStore {
  constructor(
    private readonly db: Db,
    private readonly dir: string,
  ) {}

  create(): UploadSession {
    const id = crypto.randomBytes(9).toString('base64url');
    const createdAt = new Date();
    this.db.insert(uploadSessions).values({ id, createdAt }).run();
    fs.mkdirSync(path.join(this.dir, id), { recursive: true });
    return { id, createdAt, files: [] };
  }

  /** Open (not yet submitted) session, or undefined. */
  get(id: string): UploadSession | undefined {
    const row = this.db
      .select()
      .from(uploadSessions)
      .where(and(eq(uploadSessions.id, id), isNull(uploadSessions.submittedAt)))
      .get();
    if (!row) return undefined;
    const files = this.db
      .select()
      .from(sessionFiles)
      .where(eq(sessionFiles.sessionId, id))
      .orderBy(asc(sessionFiles.addedAt))
      .all()
      .map((f) => ({
        id: f.id,
        originalName: f.originalName,
        path: f.path,
        mimeType: f.mimeType,
        size: f.size,
        from: f.from,
        docType: f.docType,
        addedAt: f.addedAt,
      }));
    return { id: row.id, createdAt: row.createdAt, files };
  }

  addFile(
    id: string,
    file: { tempPath: string; originalName: string; mimeType: string; size: number },
    from: SessionFile['from'],
    docType: DetectedType | null = null,
  ): SessionFile {
    const session = this.get(id);
    if (!session) throw new Error('Unknown upload session');
    if (session.files.length >= MAX_FILES_PER_PACKET) {
      throw new Error(`A packet can have at most ${MAX_FILES_PER_PACKET} images`);
    }
    const fileId = crypto.randomUUID();
    fs.mkdirSync(path.join(this.dir, id), { recursive: true });
    const dest = path.join(
      this.dir,
      id,
      `${fileId}${path.extname(file.originalName).toLowerCase()}`,
    );
    fs.renameSync(file.tempPath, dest);
    const entry: SessionFile = {
      id: fileId,
      originalName: path.basename(file.originalName),
      path: dest,
      mimeType: file.mimeType,
      size: file.size,
      from,
      docType,
      // Strictly increasing so ordering is stable even within one millisecond.
      addedAt: new Date(Math.max(Date.now(), (session.files.at(-1)?.addedAt.getTime() ?? 0) + 1)),
    };
    this.db
      .insert(sessionFiles)
      .values({ ...entry, sessionId: id })
      .run();
    return entry;
  }

  setFileType(id: string, fileId: string, docType: DetectedType | null): boolean {
    if (!this.get(id)) return false;
    const r = this.db
      .update(sessionFiles)
      .set({ docType })
      .where(and(eq(sessionFiles.sessionId, id), eq(sessionFiles.id, fileId)))
      .run();
    return r.changes > 0;
  }

  removeFile(id: string, fileId: string): boolean {
    const session = this.get(id);
    const file = session?.files.find((f) => f.id === fileId);
    if (!session || !file) return false;
    this.db.delete(sessionFiles).where(eq(sessionFiles.id, fileId)).run();
    fs.rmSync(file.path, { force: true });
    return true;
  }

  linkCase(id: string, caseId: string): void {
    this.db.update(uploadSessions).set({ caseId }).where(eq(uploadSessions.id, id)).run();
  }

  /** Marks the session submitted and returns its files (the caller moves them into the case). */
  take(id: string, caseId?: string): UploadSession | undefined {
    const session = this.get(id);
    if (!session) return undefined;
    this.db
      .update(uploadSessions)
      .set({ submittedAt: new Date(), caseId: caseId ?? null })
      .where(eq(uploadSessions.id, id))
      .run();
    return session;
  }
}
