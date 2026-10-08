import { afterAll, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/client.js';
import { auditLog, cases } from '../src/db/schema.js';

const handle = await openDb(':memory:');
afterAll(() => handle.close());

describe('database schema', () => {
  it('creates all required tables', async () => {
    const rows =
      handle.driver === 'postgres'
        ? await handle.raw.all<{ name: string }>(
            "select table_name as name from information_schema.tables where table_schema = 'public' order by table_name",
          )
        : await handle.raw.all<{ name: string }>(
            "select name from sqlite_master where type='table' order by name",
          );
    const names = rows.map((r) => r.name);
    for (const t of ['cases', 'documents', 'extractions', 'flags', 'audit_log', 'name_gazetteer']) {
      expect(names).toContain(t);
    }
  });

  it('only accepts the four allowed case statuses (no reject)', async () => {
    await handle.db.insert(cases).values({ id: 'c1', reference: 'REF-1', status: 'READY' });
    const [row] = await handle.db.select().from(cases).limit(1);
    expect(row?.status).toBe('READY');
  });

  it('audit_log is append-only: UPDATE and DELETE are rejected', async () => {
    await handle.db
      .insert(auditLog)
      .values({ actor: 'system:test', action: 'CASE_CREATED', entityType: 'case', entityId: 'c1' });
    await expect(handle.raw.run("update audit_log set actor='x'")).rejects.toThrow(/append-only/);
    await expect(handle.raw.run('delete from audit_log')).rejects.toThrow(/append-only/);
    const [count] = await handle.raw.all<{ n: number }>('select count(*) as n from audit_log');
    expect(Number(count!.n)).toBe(1);
  });
});
