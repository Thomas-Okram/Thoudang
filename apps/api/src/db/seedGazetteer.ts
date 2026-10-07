import { sql } from 'drizzle-orm';
import { gazetteerEntries, type GazetteerEntry } from '@thoudang/core';
import type { Db } from './client.js';
import { nameGazetteer } from './schema.js';

/** Idempotent upsert of the gazetteer into name_gazetteer. Returns the number of rows written. */
export function seedGazetteer(
  db: Db,
  entries: readonly GazetteerEntry[] = gazetteerEntries,
): number {
  if (!entries.length) return 0;
  db.transaction((tx) => {
    for (const e of entries) {
      tx.insert(nameGazetteer)
        .values({
          surname: e.surname,
          community: e.community,
          abbreviations: e.abbreviations,
          source: e.source ?? 'starter',
          confidence: e.confidence ?? null,
          tribe: e.tribe ?? null,
        })
        .onConflictDoUpdate({
          target: nameGazetteer.surname,
          set: {
            community: sql`excluded.community`,
            abbreviations: sql`excluded.abbreviations_json`,
            source: sql`excluded.source`,
            confidence: sql`excluded.confidence`,
            tribe: sql`excluded.tribe`,
          },
        })
        .run();
    }
  });
  return entries.length;
}
