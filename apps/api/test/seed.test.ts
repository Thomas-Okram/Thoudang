import { afterAll, describe, expect, it } from 'vitest';
import { gazetteerEntries } from '@thoudang/core';
import { openDb } from '../src/db/client.js';
import { nameGazetteer } from '../src/db/schema.js';
import { seedGazetteer } from '../src/db/seedGazetteer.js';

const handle = openDb(':memory:');
afterAll(() => handle.close());

describe('seedGazetteer', () => {
  it('loads every starter entry and is idempotent', () => {
    seedGazetteer(handle.db);
    seedGazetteer(handle.db);
    const rows = handle.db.select().from(nameGazetteer).all();
    expect(rows).toHaveLength(gazetteerEntries.length);
    expect(rows.find((r) => r.surname === 'Khuraijam')).toMatchObject({
      community: 'Meitei',
      abbreviations: ['kh'],
    });
  });

  it('stores source, confidence and tribe from the gazetteer metadata', () => {
    seedGazetteer(handle.db);
    const rows = handle.db.select().from(nameGazetteer).all();
    const withTribe = gazetteerEntries.find((e) => e.tribe);
    expect(withTribe).toBeDefined();
    expect(rows.find((r) => r.surname === withTribe!.surname)).toMatchObject({
      tribe: withTribe!.tribe,
      source: withTribe!.source ?? 'starter',
      confidence: withTribe!.confidence ?? null,
    });
    const khuraijam = gazetteerEntries.find((e) => e.surname === 'Khuraijam')!;
    expect(rows.find((r) => r.surname === 'Khuraijam')).toMatchObject({
      source: khuraijam.source,
      confidence: khuraijam.confidence,
      tribe: null,
    });
  });

  it('updates existing rows on re-seed', () => {
    seedGazetteer(handle.db, [
      { surname: 'Okram', community: 'Meitei', abbreviations: ['o', 'ok'] },
    ]);
    const row = handle.db
      .select()
      .from(nameGazetteer)
      .all()
      .find((r) => r.surname === 'Okram');
    expect(row?.abbreviations).toEqual(['o', 'ok']);
  });
});
