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

async function write(n: number, action: 'OFFICER_NOTE' | 'RULE_RESULT' = 'OFFICER_NOTE') {
  for (let i = 0; i < n; i++)
    await h.db.insert(auditLog).values({
      caseId: 'case-1',
      actor: 'officer:da-imphal-west',
      action,
      entityType: 'case',
      entityId: 'case-1',
      after: { text: `note ${i}` },
    });
}
/** What an attacker with raw DB access would have to do first. */
const dropGuards = () =>
  h.raw.exec(
    h.driver === 'postgres'
      ? 'DROP TRIGGER audit_log_no_update ON audit_log; DROP TRIGGER audit_log_no_delete ON audit_log; DROP TRIGGER audit_log_no_truncate ON audit_log; DROP TRIGGER audit_chain_no_update ON audit_chain; DROP TRIGGER audit_chain_no_delete ON audit_chain;'
      : 'DROP TRIGGER audit_log_no_update; DROP TRIGGER audit_log_no_delete; DROP TRIGGER audit_chain_no_update; DROP TRIGGER audit_chain_no_delete;',
  );

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thoudang-chain-'));
  dbPath = path.join(dir, 'chain.db');
  h = await openDb(dbPath);
});
afterEach(async () => {
  await h.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('audit hash chain', () => {
  it('seals new entries incrementally and verifies clean', async () => {
    const chain = await AuditChain.open(h.raw, KEY, anchorPathFor(dbPath));
    await write(3);
    expect((await chain.seal()).sealed).toBe(3);
    await write(2);
    expect(await chain.verify()).toMatchObject({ ok: true, verified: 3, unsealed: 2 });
    expect((await chain.seal()).sealed).toBe(2);
    expect((await chain.seal()).sealed).toBe(0);
    const v = await chain.verify();
    expect(v).toMatchObject({ ok: true, verified: 5, unsealed: 0, lastSealedId: 5 });
    expect(v.head).not.toMatch(/\d{12}/); // never Aadhaar-like
  });

  it('the chain itself is append-only', async () => {
    const chain = await AuditChain.open(h.raw, KEY);
    await write(1);
    await chain.seal();
    await expect(h.raw.exec("UPDATE audit_chain SET hash = 'x'")).rejects.toThrow(/append-only/);
    await expect(h.raw.exec('DELETE FROM audit_chain')).rejects.toThrow(/append-only/);
  });

  it('editing a row breaks verification (even with the append-only triggers dropped)', async () => {
    const chain = await AuditChain.open(h.raw, KEY, anchorPathFor(dbPath));
    await write(4);
    await chain.seal();
    await dropGuards();
    await h.raw.run('UPDATE audit_log SET reason = ? WHERE id = 2', ['back-dated approval reason']);
    const v = await chain.verify();
    expect(v.ok).toBe(false);
    expect(v.problems).toEqual([{ auditId: 2, problem: 'audit entry modified' }]);
  });

  it('detects deleted rows, rows slipped into the sealed range, and the wrong key', async () => {
    const chain = await AuditChain.open(h.raw, KEY);
    await write(5);
    await chain.seal();
    await dropGuards();
    await h.raw.run('DELETE FROM audit_log WHERE id = 3');
    expect((await chain.verify()).problems).toContainEqual({
      auditId: 3,
      problem: 'audit entry deleted',
    });

    await h.raw.run('DELETE FROM audit_chain WHERE audit_id = 3');
    await h.raw.run(
      "INSERT INTO audit_log (id, actor, action, entity_type, created_at) VALUES (3, 'officer:x', 'OFFICER_APPROVE', 'case', 0)",
    );
    const problems = (await chain.verify()).problems.map((p) => p.problem);
    expect(problems).toContain('entry inserted inside the sealed range');
    expect(problems).toContain('chain link broken (entry removed or reordered)');

    expect((await (await AuditChain.open(h.raw, 'other-key')).verify()).ok).toBe(false);
  });

  it('wiping the chain table is caught by the anchor, and a wiped chain cannot re-anchor', async () => {
    const anchor = anchorPathFor(dbPath);
    const chain = await AuditChain.open(h.raw, KEY, anchor);
    await write(3);
    await chain.seal();
    await dropGuards();
    await h.raw.exec('DROP TABLE audit_chain; DROP TABLE audit_chain_meta;');
    const fresh = await AuditChain.open(h.raw, KEY, anchor); // re-creates an empty chain
    expect(await fresh.seal()).toEqual({ sealed: 3, anchorMismatch: true });
    const v = await fresh.verify();
    expect(v.ok).toBe(false);
    expect(v.problems[0]?.problem).toMatch(/different audit chain/);
  });

  it('audit:verify CLI exits 0 when clean and 1 after tampering', async () => {
    const chain = await AuditChain.open(h.raw, KEY, anchorPathFor(dbPath));
    await write(2);
    await chain.seal();
    const out: string[] = [];
    expect(await verifyAuditCli({ dbPath, key: KEY, print: (l) => out.push(l) })).toBe(0);
    expect(out.join('\n')).toMatch(/OK/);
    await dropGuards();
    await h.raw.run("UPDATE audit_log SET actor = 'officer:someone-else' WHERE id = 1");
    out.length = 0;
    expect(await verifyAuditCli({ dbPath, key: KEY, print: (l) => out.push(l) })).toBe(1);
    expect(out.join('\n')).toMatch(/TAMPERING DETECTED[\s\S]*#1: audit entry modified/);
  });
});
