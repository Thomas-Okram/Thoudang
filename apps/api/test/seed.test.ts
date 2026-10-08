import { afterAll, describe, expect, it } from 'vitest';
import { gazetteerEntries } from '@thoudang/core';
import { openDb } from '../src/db/client.js';
import { nameGazetteer } from '../src/db/schema.js';
import { seedGazetteer } from '../src/db/seedGazetteer.js';

const handle = await openDb(':memory:');
afterAll(() => handle.close());

describe('seedGazetteer', () => {
  it('loads every starter entry and is idempotent', async () => {
    await seedGazetteer(handle.db);
    await seedGazetteer(handle.db);
    const rows = await handle.db.select().from(nameGazetteer);
    expect(rows).toHaveLength(gazetteerEntries.length);
    expect(rows.find((r) => r.surname === 'Khuraijam')).toMatchObject({
      community: 'Meitei',
      abbreviations: ['kh'],
    });
  });

  it('stores source, confidence and tribe from the gazetteer metadata', async () => {
    await seedGazetteer(handle.db);
    const rows = await handle.db.select().from(nameGazetteer);
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

  it('updates existing rows on re-seed', async () => {
    await seedGazetteer(handle.db, [
      { surname: 'Okram', community: 'Meitei', abbreviations: ['o', 'ok'] },
    ]);
    const row = (await handle.db.select().from(nameGazetteer)).find((r) => r.surname === 'Okram');
    expect(row?.abbreviations).toEqual(['o', 'ok']);
  });
});
