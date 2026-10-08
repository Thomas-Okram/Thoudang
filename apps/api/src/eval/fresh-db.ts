import fs from 'node:fs';
import { dbExists, dropDb, openDb, transaction, type DbHandle } from '../db/client.js';
import { extractionCache } from '../db/schema.js';

/**
 * Each eval run starts from an EMPTY eval database: cases left over from an earlier run would
 * otherwise make every packet a DUPLICATE_SUSPECTED of itself. The extraction cache is carried
 * over (it is keyed by image hash + model + prompt version, so it is still valid) — that keeps
 * `--mode cache_only` / `dev:fixtures` runs working and avoids paying for the same Claude calls.
 */
export async function openFreshEvalDb(
  dbPath: string,
  uploadsDir: string,
): Promise<{ handle: DbHandle; carriedCacheRows: number }> {
  let rows: (typeof extractionCache.$inferSelect)[] = [];
  if (await dbExists(dbPath)) {
    const old = await openDb(dbPath);
    try {
      rows = await old.db.select().from(extractionCache);
    } finally {
      await old.close();
    }
  }
  // eval.db (+ -wal, -shm, .audit-anchor.json) — or, on Postgres, the eval database.
  await dropDb(dbPath);
  fs.rmSync(uploadsDir, { recursive: true, force: true });

  const handle = await openDb(dbPath);
  if (rows.length) {
    await transaction(handle.db, async (tx) => {
      for (const r of rows) await tx.insert(extractionCache).values(r);
    });
  }
  return { handle, carriedCacheRows: rows.length };
}
