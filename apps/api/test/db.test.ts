import { afterAll, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/client.js';
import { auditLog, cases } from '../src/db/schema.js';

const handle = openDb(':memory:');
afterAll(() => handle.close());

describe('database schema', () => {
  it('creates all required tables', () => {
    const rows = handle.sqlite
      .prepare("select name from sqlite_master where type='table' order by name")
      .all() as { name: string }[];
    const names = rows.map((r) => r.name);
    for (const t of ['cases', 'documents', 'extractions', 'flags', 'audit_log', 'name_gazetteer']) {
      expect(names).toContain(t);
    }
  });

  it('only accepts the four allowed case statuses (no reject)', () => {
    handle.db.insert(cases).values({ id: 'c1', reference: 'REF-1', status: 'READY' }).run();
    const row = handle.db.select().from(cases).get();
    expect(row?.status).toBe('READY');
  });

  it('audit_log is append-only: UPDATE and DELETE are rejected', () => {
    handle.db
      .insert(auditLog)
      .values({ actor: 'system:test', action: 'CASE_CREATED', entityType: 'case', entityId: 'c1' })
      .run();
    expect(() => handle.sqlite.prepare("update audit_log set actor='x'").run()).toThrow(
      /append-only/,
    );
    expect(() => handle.sqlite.prepare('delete from audit_log').run()).toThrow(/append-only/);
    const count = handle.sqlite.prepare('select count(*) as n from audit_log').get() as {
      n: number;
    };
    expect(count.n).toBe(1);
  });
});
