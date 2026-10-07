import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface SessionFile {
  id: string;
  originalName: string;
  path: string;
  mimeType: string;
  size: number;
  from: 'desk' | 'phone';
  addedAt: Date;
}

export interface UploadSession {
  id: string;
  createdAt: Date;
  files: SessionFile[];
}

export const MAX_FILES_PER_PACKET = 6;

/**
 * Staging area for one packet. The desk (drag-drop) and a phone (QR link) both add images to
 * the same session; "Screen application" turns it into a case. In-memory: a server restart
 * simply starts a new session.
 */
export class SessionStore {
  private readonly sessions = new Map<string, UploadSession>();
  constructor(private readonly dir: string) {}

  create(): UploadSession {
    const id = crypto.randomBytes(9).toString('base64url');
    const session = { id, createdAt: new Date(), files: [] };
    this.sessions.set(id, session);
    fs.mkdirSync(path.join(this.dir, id), { recursive: true });
    return session;
  }

  get(id: string): UploadSession | undefined {
    return this.sessions.get(id);
  }

  addFile(
    id: string,
    file: { tempPath: string; originalName: string; mimeType: string; size: number },
    from: SessionFile['from'],
  ): SessionFile {
    const session = this.sessions.get(id);
    if (!session) throw new Error('Unknown upload session');
    if (session.files.length >= MAX_FILES_PER_PACKET) {
      throw new Error(`A packet can have at most ${MAX_FILES_PER_PACKET} images`);
    }
    const fileId = crypto.randomUUID();
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
      addedAt: new Date(),
    };
    session.files.push(entry);
    return entry;
  }

  removeFile(id: string, fileId: string): boolean {
    const session = this.sessions.get(id);
    const idx = session?.files.findIndex((f) => f.id === fileId) ?? -1;
    if (!session || idx < 0) return false;
    const [removed] = session.files.splice(idx, 1);
    if (removed) fs.rmSync(removed.path, { force: true });
    return true;
  }

  /** Hands the files over (caller moves them) and forgets the session. */
  take(id: string): UploadSession | undefined {
    const session = this.sessions.get(id);
    this.sessions.delete(id);
    return session;
  }
}
