import fs from 'node:fs';
import path from 'node:path';
import { openDb, type DbHandle } from '../db/client.js';
import { extractionCache } from '../db/schema.js';

/**
 * Each eval run starts from an EMPTY eval database: cases left over from an earlier run would
 * otherwise make every packet a DUPLICATE_SUSPECTED of itself. The extraction cache is carried
 * over (it is keyed by image hash + model + prompt version, so it is still valid) — that keeps
 * `--mode cache_only` / `dev:fixtures` runs working and avoids paying for the same Claude calls.
 */
export function openFreshEvalDb(
  dbPath: string,
  uploadsDir: string,
): { handle: DbHandle; carriedCacheRows: number } {
  let rows: (typeof extractionCache.$inferSelect)[] = [];
  if (fs.existsSync(dbPath)) {
    const old = openDb(dbPath);
    try {
      rows = old.db.select().from(extractionCache).all();
    } finally {
      old.close();
    }
  }
  const dir = path.dirname(dbPath);
  const base = path.basename(dbPath);
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      // eval.db, eval.db-wal, eval.db-shm, eval.db.audit-anchor.json
      if (f === base || f.startsWith(`${base}-`) || f.startsWith(`${base}.`)) {
        fs.rmSync(path.join(dir, f), { force: true });
      }
    }
  }
  fs.rmSync(uploadsDir, { recursive: true, force: true });

  const handle = openDb(dbPath);
  if (rows.length) {
    handle.sqlite.transaction(() => {
      for (const r of rows) handle.db.insert(extractionCache).values(r).run();
    })();
  }
  return { handle, carriedCacheRows: rows.length };
}
