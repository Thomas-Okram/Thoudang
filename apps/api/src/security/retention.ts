import fs from 'node:fs';
import path from 'node:path';
import { and, eq, inArray, lte } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { cases, documents } from '../db/schema.js';
import { sqliteOf } from './audit-chain.js';

export interface RetentionResult {
  cases: string[];
  filesDeleted: number;
  bytesFreed: number;
  dryRun: boolean;
}

const DAY_MS = 86_400_000;

/**
 * Deletes the uploaded IMAGES of closed cases `days` after closure. Closed = approved by the
 * officer (the only terminal status; there is no reject). Keeps everything else: the case, the
 * masked extracted fields, flags, decisions and the audit log. Each purge is itself audited.
 *
 * Paths are cleared on the document rows so the image endpoint answers 404 ("no preview") instead
 * of failing. Synthetic historical cases have no images and are skipped. days <= 0 disables.
 */
export function runRetention(opts: {
  db: Db;
  uploadsDir: string;
  days: number;
  now?: Date;
  dryRun?: boolean;
}): RetentionResult {
  const { db, uploadsDir, days } = opts;
  const dryRun = opts.dryRun ?? false;
  const result: RetentionResult = { cases: [], filesDeleted: 0, bytesFreed: 0, dryRun };
  if (!(days > 0)) return result;
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - days * DAY_MS);

  const due = db
    .select({ id: cases.id, decidedAt: cases.decidedAt })
    .from(cases)
    .where(
      and(
        eq(cases.status, 'APPROVED_BY_OFFICER'),
        eq(cases.historical, false),
        lte(cases.decidedAt, cutoff),
      ),
    )
    .all();
  if (!due.length) return result;

  const root = path.resolve(uploadsDir);
  const insideUploads = (p: string) => {
    const abs = path.resolve(p);
    return abs.startsWith(root + path.sep);
  };
  const docs = db
    .select({
      id: documents.id,
      caseId: documents.caseId,
      storedPath: documents.storedPath,
      processedPath: documents.processedPath,
    })
    .from(documents)
    .where(
      inArray(
        documents.caseId,
        due.map((c) => c.id),
      ),
    )
    .all();

  const audit = sqliteOf(db).prepare(
    `INSERT INTO audit_log (case_id, actor, action, entity_type, entity_id, after_json, reason, created_at)
     VALUES (?, 'system:retention', 'IMAGES_PURGED', 'case', ?, ?, ?, ?)`,
  );

  for (const c of due) {
    const caseDir = path.join(root, c.id);
    const files = new Set<string>();
    for (const d of docs.filter((x) => x.caseId === c.id))
      for (const p of [d.storedPath, d.processedPath]) if (p && insideUploads(p)) files.add(p);
    if (fs.existsSync(caseDir))
      for (const f of fs.readdirSync(caseDir)) files.add(path.join(caseDir, f));
    const present = [...files].filter((f) => fs.existsSync(f));
    const hasPaths = docs.some((d) => d.caseId === c.id && (d.storedPath || d.processedPath));
    if (!present.length && !hasPaths) continue; // already purged

    let bytes = 0;
    for (const f of present) bytes += fs.statSync(f).size;
    result.cases.push(c.id);
    result.filesDeleted += present.length;
    result.bytesFreed += bytes;
    if (dryRun) continue;

    for (const f of present) fs.rmSync(f, { force: true });
    if (fs.existsSync(caseDir)) fs.rmSync(caseDir, { recursive: true, force: true });
    db.transaction((tx) => {
      tx.update(documents)
        .set({ storedPath: '', processedPath: '' })
        .where(eq(documents.caseId, c.id))
        .run();
    });
    audit.run(
      c.id,
      c.id,
      JSON.stringify({ filesDeleted: present.length, bytesFreed: bytes, retentionDays: days }),
      `Retention: images deleted ${days} days after the case was closed (approved ${c.decidedAt?.toISOString() ?? '?'}); extracted masked data and audit trail kept`,
      now.getTime(),
    );
  }
  return result;
}
