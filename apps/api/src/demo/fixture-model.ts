import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { extractionCache } from '../db/schema.js';

/** Model id stored on cache rows seeded by `npm run dev:fixtures` (never real AI output). */
export const FIXTURE_MODEL = 'fixture-truth';

/** Removes fixture rows for one image so real Claude results can replace them. */
export function purgeFixtures(db: Db, sha256: string): number {
  return db
    .delete(extractionCache)
    .where(and(eq(extractionCache.sha256, sha256), eq(extractionCache.model, FIXTURE_MODEL)))
    .run().changes;
}
