import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DbHandle } from '../src/db/client.js';
import { auditLog } from '../src/db/schema.js';
import { AuditChain, anchorPathFor } from '../src/security/audit-chain.js';
import { verifyAuditCli } from '../src/security/audit-verify.js';

const KEY = 'test-chain-key';
let dir: string;
let dbPath: string;
let h: DbHandle;

function write(n: number, action: 'OFFICER_NOTE' | 'RULE_RESULT' = 'OFFICER_NOTE') {
  for (let i = 0; i < n; i++)
    h.db
      .insert(auditLog)
      .values({
        caseId: 'case-1',
        actor: 'officer:da-imphal-west',
        action,
        entityType: 'case',
        entityId: 'case-1',
        after: { text: `note ${i}` },
      })
      .run();
}
/** What an attacker with raw DB access would have to do first. */
const dropGuards = () =>
  h.sqlite.exec(
    'DROP TRIGGER audit_log_no_update; DROP TRIGGER audit_log_no_delete; DROP TRIGGER audit_chain_no_update; DROP TRIGGER audit_chain_no_delete;',
  );

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thoudang-chain-'));
  dbPath = path.join(dir, 'chain.db');
  h = openDb(dbPath);
});
afterEach(() => {
  h.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('audit hash chain', () => {
  it('seals new entries incrementally and verifies clean', () => {
    const chain = new AuditChain(h.sqlite, KEY, anchorPathFor(dbPath));
    write(3);
    expect(chain.seal().sealed).toBe(3);
    write(2);
    expect(chain.verify()).toMatchObject({ ok: true, verified: 3, unsealed: 2 });
    expect(chain.seal().sealed).toBe(2);
    expect(chain.seal().sealed).toBe(0);
    const v = chain.verify();
    expect(v).toMatchObject({ ok: true, verified: 5, unsealed: 0, lastSealedId: 5 });
    expect(v.head).not.toMatch(/\d{12}/); // never Aadhaar-like
  });

  it('the chain itself is append-only', () => {
    const chain = new AuditChain(h.sqlite, KEY);
    write(1);
    chain.seal();
    expect(() => h.sqlite.exec("UPDATE audit_chain SET hash = 'x'")).toThrow(/append-only/);
    expect(() => h.sqlite.exec('DELETE FROM audit_chain')).toThrow(/append-only/);
  });

  it('editing a row breaks verification (even with the append-only triggers dropped)', () => {
    const chain = new AuditChain(h.sqlite, KEY, anchorPathFor(dbPath));
    write(4);
    chain.seal();
    dropGuards();
    h.sqlite
      .prepare('UPDATE audit_log SET reason = ? WHERE id = 2')
      .run('back-dated approval reason');
    const v = chain.verify();
    expect(v.ok).toBe(false);
    expect(v.problems).toEqual([{ auditId: 2, problem: 'audit entry modified' }]);
  });

  it('detects deleted rows, rows slipped into the sealed range, and the wrong key', () => {
    const chain = new AuditChain(h.sqlite, KEY);
    write(5);
    chain.seal();
    dropGuards();
    h.sqlite.prepare('DELETE FROM audit_log WHERE id = 3').run();
    expect(chain.verify().problems).toContainEqual({ auditId: 3, problem: 'audit entry deleted' });

    h.sqlite.prepare('DELETE FROM audit_chain WHERE audit_id = 3').run();
    h.sqlite
      .prepare(
        "INSERT INTO audit_log (id, actor, action, entity_type, created_at) VALUES (3, 'officer:x', 'OFFICER_APPROVE', 'case', 0)",
      )
      .run();
    const problems = chain.verify().problems.map((p) => p.problem);
    expect(problems).toContain('entry inserted inside the sealed range');
    expect(problems).toContain('chain link broken (entry removed or reordered)');

    expect(new AuditChain(h.sqlite, 'other-key').verify().ok).toBe(false);
  });

  it('wiping the chain table is caught by the anchor, and a wiped chain cannot re-anchor', () => {
    const anchor = anchorPathFor(dbPath);
    const chain = new AuditChain(h.sqlite, KEY, anchor);
    write(3);
    chain.seal();
    dropGuards();
    h.sqlite.exec('DROP TABLE audit_chain; DROP TABLE audit_chain_meta;');
    const fresh = new AuditChain(h.sqlite, KEY, anchor); // re-creates an empty chain
    expect(fresh.seal()).toEqual({ sealed: 3, anchorMismatch: true });
    const v = fresh.verify();
    expect(v.ok).toBe(false);
    expect(v.problems[0]?.problem).toMatch(/different audit chain/);
  });

  it('audit:verify CLI exits 0 when clean and 1 after tampering', () => {
    const chain = new AuditChain(h.sqlite, KEY, anchorPathFor(dbPath));
    write(2);
    chain.seal();
    const out: string[] = [];
    expect(verifyAuditCli({ dbPath, key: KEY, print: (l) => out.push(l) })).toBe(0);
    expect(out.join('\n')).toMatch(/OK/);
    dropGuards();
    h.sqlite.prepare("UPDATE audit_log SET actor = 'officer:someone-else' WHERE id = 1").run();
    out.length = 0;
    expect(verifyAuditCli({ dbPath, key: KEY, print: (l) => out.push(l) })).toBe(1);
    expect(out.join('\n')).toMatch(/TAMPERING DETECTED[\s\S]*#1: audit entry modified/);
  });
});
