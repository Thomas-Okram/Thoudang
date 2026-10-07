import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import multer from 'multer';
import type { Request, RequestHandler, Response } from 'express';
import { stripGps } from '../security/exif.js';
import { KIND_EXTS, KIND_MIME, sniff, sniffFile, type ImageKind } from '../security/magic.js';
import { isImageName } from '../upload.js';

/**
 * Front door for every upload route. Runs BEFORE the route's own multer and:
 *  1. refuses bodies over the size budget (413) before reading them;
 *  2. parses the multipart body itself into <uploads>/tmp with random names (no client-chosen
 *     names ever touch the filesystem), with per-file size, file-count and field limits;
 *  3. checks every file's MAGIC BYTES — only JPEG / PNG / WebP / HEIC (and ZIP on the batch
 *     route, whose entries are checked too). A file pretending to be an image is refused (415);
 *  4. strips EXIF/XMP GPS from every image in place (lossless) before anything stores it;
 *  5. fixes the extension/MIME to match the real content, then hands req.files to the route.
 *
 * The route's multer is skipped (the body is already consumed) by retagging the content type —
 * the routes and upload.ts stay unchanged. Temp files left behind by a failed request are removed
 * when the response ends.
 */
export interface UploadRoute {
  method: 'POST';
  pattern: RegExp;
  maxFiles: number;
  allowZip: boolean;
}

export const PREPARSED_CONTENT_TYPE = 'application/x-thoudang-checked-upload';

export function uploadRoutes(limits: { maxPacketFiles: number; maxBatchFiles: number }): UploadRoute[] {
  return [
    { method: 'POST', pattern: /^\/cases\/?$/, maxFiles: limits.maxPacketFiles, allowZip: false },
    { method: 'POST', pattern: /^\/cases\/batch\/?$/, maxFiles: limits.maxBatchFiles, allowZip: true },
    {
      method: 'POST',
      pattern: /^\/sessions\/[^/]+\/files\/?$/,
      maxFiles: limits.maxPacketFiles,
      allowZip: false,
    },
  ];
}

export class UploadRejected extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const isJunkPath = (p: string) =>
  p
    .replace(/\\/g, '/')
    .split('/')
    .some((seg) => seg.startsWith('.') || seg === '__MACOSX' || /^(thumbs\.db|desktop\.ini)$/i.test(seg));

/** Same name with the extension that matches the real content ("scan.php" → "scan.php.jpg"). */
export function withTrueExtension(name: string, kind: ImageKind): string {
  const ext = path.extname(name).toLowerCase();
  if ((KIND_EXTS[kind] as readonly string[]).includes(ext)) return name;
  return `${name}${KIND_EXTS[kind][0]}`;
}

/** Strips GPS in place; returns how many GPS tags/values were removed. */
function scrubFile(file: string): number {
  const { buffer, removed } = stripGps(fs.readFileSync(file));
  if (removed) fs.writeFileSync(file, buffer);
  return removed;
}

/** Validates every entry of a batch zip and rewrites it without junk entries and without GPS. */
function checkZip(
  file: string,
  limits: { maxEntries: number; maxUncompressed: number; maxFiles: number },
): void {
  let zip: AdmZip;
  try {
    zip = new AdmZip(file);
  } catch {
    throw new UploadRejected(415, 'The zip file could not be opened');
  }
  const entries = zip.getEntries();
  if (entries.length > limits.maxEntries)
    throw new UploadRejected(413, `The zip has ${entries.length} entries (limit ${limits.maxEntries})`);
  const total = entries.reduce((s, e) => s + (e.header.size || 0), 0);
  if (total > limits.maxUncompressed)
    throw new UploadRejected(413, 'The zip is too large when unpacked');
  let images = 0;
  let changed = false;
  for (const e of entries) {
    if (e.isDirectory) continue;
    if (isJunkPath(e.entryName)) {
      zip.deleteFile(e.entryName);
      changed = true;
      continue;
    }
    if (!isImageName(e.entryName)) continue; // ignored by the batch grouping anyway
    const data = e.getData();
    const kind = sniff(data.subarray(0, 32));
    if (!kind || kind === 'zip')
      throw new UploadRejected(
        415,
        `${path.posix.basename(e.entryName)} is not a JPEG, PNG, WebP or HEIC image`,
      );
    images += 1;
    const { buffer, removed } = stripGps(data);
    if (removed) {
      e.setData(buffer);
      changed = true;
    }
  }
  if (images > limits.maxFiles)
    throw new UploadRejected(413, `The zip has ${images} images (limit ${limits.maxFiles})`);
  if (changed) zip.writeZip(file);
}

function rmQuiet(file: string) {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // best effort
  }
}

export function uploadGuard(opts: {
  uploadsDir: string;
  maxFileBytes: number;
  maxPacketFiles: number;
  maxBatchFiles: number;
  maxBatchBytes: number;
  maxZipEntries: number;
  maxZipUncompressedBytes: number;
  /** Optional: called for every GPS-stripped / refused file (for logging). */
  onEvent?: (event: 'gps_stripped' | 'rejected', detail: Record<string, unknown>) => void;
}): RequestHandler {
  const tmp = path.join(opts.uploadsDir, 'tmp');
  const routes = uploadRoutes(opts);
  const parsers = new Map<UploadRoute, RequestHandler>();
  for (const r of routes) {
    parsers.set(
      r,
      multer({
        storage: multer.diskStorage({
          destination: (_req, _file, cb) => {
            fs.mkdirSync(tmp, { recursive: true });
            cb(null, tmp);
          },
          filename: (_req, _file, cb) => cb(null, `${crypto.randomUUID()}.upload`),
        }),
        preservePath: true,
        limits: {
          fileSize: opts.maxFileBytes,
          files: r.maxFiles,
          fields: r.maxFiles * 2 + 20,
          fieldSize: 64 * 1024,
          parts: r.maxFiles * 3 + 20,
        },
      }).array('files', r.maxFiles),
    );
  }

  const cleanupLater = (req: Request, res: Response) => {
    const done = () => {
      for (const f of (req.files as Express.Multer.File[] | undefined) ?? [])
        if (f.path.startsWith(tmp) && fs.existsSync(f.path)) rmQuiet(f.path);
    };
    res.once('finish', done);
    res.once('close', done);
  };

  return (req, res, next) => {
    const route = routes.find((r) => r.method === req.method && r.pattern.test(req.path));
    if (!route || !req.is('multipart/form-data')) {
      next();
      return;
    }
    const budget = route.allowZip
      ? opts.maxBatchBytes
      : route.maxFiles * opts.maxFileBytes + 1024 * 1024;
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > budget) {
      res.status(413).json({ error: 'Upload too large' });
      req.resume();
      return;
    }

    const parse = parsers.get(route)!;
    parse(req, res, (err?: unknown) => {
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      cleanupLater(req, res);
      if (err) {
        files.forEach((f) => rmQuiet(f.path));
        if (err instanceof multer.MulterError) {
          const tooBig = err.code === 'LIMIT_FILE_SIZE';
          const tooMany = err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE';
          res.status(tooBig ? 413 : 400).json({
            error: tooBig
              ? `A file is larger than ${Math.round(opts.maxFileBytes / 1024 / 1024)} MB`
              : tooMany
                ? `Too many files (at most ${route.maxFiles})`
                : err.message,
          });
          return;
        }
        next(err);
        return;
      }
      try {
        const relPaths = listField((req.body as Record<string, unknown> | undefined)?.paths);
        let zipBytes = 0;
        const kept: Express.Multer.File[] = [];
        for (const [i, f] of files.entries()) {
          const shownPath = relPaths.length === files.length ? relPaths[i]! : f.originalname;
          const kind = sniffFile(f.path);
          if (kind === 'zip' && route.allowZip) {
            checkZip(f.path, {
              maxEntries: opts.maxZipEntries,
              maxUncompressed: opts.maxZipUncompressedBytes - zipBytes,
              maxFiles: opts.maxBatchFiles,
            });
            zipBytes += f.size;
            f.originalname = path.extname(f.originalname).toLowerCase() === '.zip'
              ? f.originalname
              : `${f.originalname}.zip`;
            f.mimetype = 'application/zip';
            kept.push(f);
            continue;
          }
          if (kind && kind !== 'zip') {
            const removed = scrubFile(f.path);
            if (removed) opts.onEvent?.('gps_stripped', { tags: removed });
            f.originalname = withTrueExtension(f.originalname.replace(/[\0-\x1f]/g, ''), kind);
            f.mimetype = KIND_MIME[kind];
            kept.push(f);
            continue;
          }
          // Not an accepted image. Folder uploads routinely carry .DS_Store, truth.json, notes —
          // those are dropped quietly (the batch grouping ignores them anyway). A file that CLAIMS
          // to be an image, or anything on a single-packet route, refuses the whole request.
          const claimsImage = isImageName(shownPath) || f.mimetype.startsWith('image/');
          if (route.allowZip && (isJunkPath(shownPath) || !claimsImage)) {
            rmQuiet(f.path);
            continue;
          }
          throw new UploadRejected(
            415,
            `${path.basename(shownPath)} is not a JPEG, PNG, WebP or HEIC image (checked by file content)`,
          );
        }
        if (relPaths.length === files.length && kept.length !== files.length)
          (req.body as Record<string, unknown>).paths = files
            .map((f, i) => (kept.includes(f) ? relPaths[i] : null))
            .filter((p): p is string => p !== null);
        req.files = kept;
        req.headers['content-type'] = PREPARSED_CONTENT_TYPE;
        next();
      } catch (e) {
        files.forEach((f) => rmQuiet(f.path));
        if (e instanceof UploadRejected) {
          opts.onEvent?.('rejected', { status: e.status, reason: e.message });
          res.status(e.status).json({ error: e.message });
          return;
        }
        next(e);
      }
    });
  };
}

const listField = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? [raw] : [];
