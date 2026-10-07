import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import AdmZip from 'adm-zip';
import type { IncomingFile } from './pipeline/pipeline.js';

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.tif', '.tiff']);
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const isImageName = (name: string) => IMAGE_EXT.has(path.extname(name).toLowerCase());
const isZip = (f: { originalname: string; mimetype: string }) =>
  path.extname(f.originalname).toLowerCase() === '.zip' || f.mimetype.includes('zip');

/** Multer writes into <uploads>/tmp so files can later be renamed (same filesystem). */
export function createUploader(uploadsDir: string, opts: { allowZip?: boolean; maxFiles: number }) {
  const tmp = path.join(uploadsDir, 'tmp');
  fs.mkdirSync(tmp, { recursive: true });
  return multer({
    storage: multer.diskStorage({
      destination: tmp,
      filename: (_req, file, cb) =>
        cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
    }),
    preservePath: true,
    limits: { fileSize: MAX_UPLOAD_BYTES, files: opts.maxFiles },
    fileFilter: (_req, file, cb) => {
      const ok =
        file.mimetype.startsWith('image/') ||
        isImageName(file.originalname) ||
        (opts.allowZip === true && isZip(file));
      cb(null, ok);
    },
  });
}

export function toIncoming(f: Express.Multer.File): IncomingFile {
  return {
    path: f.path,
    originalName: path.basename(f.originalname),
    mimeType: f.mimetype,
    size: f.size,
  };
}

export interface RelativeFile extends IncomingFile {
  /** e.g. "batch/packet-01/aadhaar.jpg" */
  relPath: string;
}

export interface Packet {
  name: string;
  files: RelativeFile[];
}

/** One packet per folder: files are grouped by their parent directory. Non-images are ignored. */
export function groupIntoPackets(files: RelativeFile[]): Packet[] {
  const groups = new Map<string, RelativeFile[]>();
  for (const f of files) {
    const rel = f.relPath.replace(/\\/g, '/');
    if (!isImageName(rel) || rel.split('/').some((p) => p.startsWith('.') || p === '__MACOSX')) {
      continue;
    }
    const dir = path.posix.dirname(rel);
    const key = dir === '.' ? '(loose files)' : dir;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([key, list]) => ({
      name: key === '(loose files)' ? key : path.posix.basename(key),
      files: list.sort((a, b) => a.relPath.localeCompare(b.relPath, undefined, { numeric: true })),
    }));
}

/** Expands a zip into temp files (same filesystem as uploads) with their in-zip relative paths. */
export function expandZip(zipPath: string, tmpDir: string): RelativeFile[] {
  const zip = new AdmZip(zipPath);
  const out: RelativeFile[] = [];
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !isImageName(entry.entryName)) continue;
    const data = entry.getData();
    const dest = path.join(
      tmpDir,
      `${crypto.randomUUID()}${path.extname(entry.entryName).toLowerCase()}`,
    );
    fs.writeFileSync(dest, data);
    out.push({
      path: dest,
      relPath: entry.entryName,
      originalName: path.posix.basename(entry.entryName),
      mimeType: 'application/octet-stream',
      size: data.length,
    });
  }
  return out;
}
