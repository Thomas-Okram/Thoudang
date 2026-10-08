import crypto from 'node:crypto';
import fs from 'node:fs';
import type { RawDb } from '../db/client.js';

/**
 * Tamper-evident audit log. audit_log is already append-only (database triggers, migration 0001 —
 * SQLite RAISE(ABORT) / PostgreSQL plpgsql);
 * this adds a hash chain so that even someone who drops those triggers and edits, deletes or
 * back-dates a row is caught by `npm run audit:verify`.
 *
 *   hash_n = HMAC-SHA256(AUDIT_CHAIN_KEY, hash_{n-1} + "\n" + canonical(row_n))
 *
 * The chain lives in its own table (audit_chain, one row per audit_log id) so the existing schema
 * and migrations stay untouched. Rows are sealed shortly after they are written (after every API
 * response, on pipeline events and on a timer). The latest head is also written to an anchor file
 * next to the database, so wiping the chain table itself is detected too.
 *
 * Hashes are base64url, never hex: hex hashes contain 12-digit runs that look like Aadhaar numbers
 * to the leak scanner.
 */

export const GENESIS = 'genesis';

/** Fixed column list: a column added to audit_log later must not change old rows' hashes. */
const COLUMNS = [
  'id',
  'case_id',
  'actor',
  'action',
  'entity_type',
  'entity_id',
  'before_json',
  'after_json',
  'reason',
  'created_at',
] as const;

type RawRow = Record<(typeof COLUMNS)[number], string | number | null>;

interface ChainRow {
  audit_id: number;
  prev_hash: string;
  hash: string;
}

export interface Anchor {
  chainId: string;
  lastId: number;
  head: string;
  sealedAt: string;
}

export interface VerifyResult {
  ok: boolean;
  /** audit rows covered by the chain and re-verified */
  verified: number;
  /** audit rows written after the last seal (not yet covered) */
  unsealed: number;
  head: string;
  lastSealedId: number;
  problems: { auditId: number | null; problem: string }[];
}

const SQLITE_DDL = `
  CREATE TABLE IF NOT EXISTS audit_chain (
    audit_id INTEGER PRIMARY KEY,
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL,
    sealed_at INTEGER NOT NULL
  );
  CREATE TRIGGER IF NOT EXISTS audit_chain_no_update BEFORE UPDATE ON audit_chain
  BEGIN SELECT RAISE(ABORT, 'audit_chain is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS audit_chain_no_delete BEFORE DELETE ON audit_chain
  BEGIN SELECT RAISE(ABORT, 'audit_chain is append-only'); END;
  CREATE TABLE IF NOT EXISTS audit_chain_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

// thoudang_append_only() comes from drizzle/pg/0001_audit_log_append_only.sql.
const PG_DDL = `
  CREATE TABLE IF NOT EXISTS audit_chain (
    audit_id INTEGER PRIMARY KEY,
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL,
    sealed_at BIGINT NOT NULL
  );
  CREATE OR REPLACE TRIGGER audit_chain_no_update BEFORE UPDATE ON audit_chain
    FOR EACH ROW EXECUTE FUNCTION thoudang_append_only();
  CREATE OR REPLACE TRIGGER audit_chain_no_delete BEFORE DELETE ON audit_chain
    FOR EACH ROW EXECUTE FUNCTION thoudang_append_only();
  CREATE TABLE IF NOT EXISTS audit_chain_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

export async function ensureAuditChain(raw: RawDb): Promise<void> {
  if (raw.driver === 'postgres') {
    // CREATE OR REPLACE TRIGGER is not concurrency-safe across processes; serialise it.
    await raw.transaction(async (tx) => {
      await tx.all('SELECT pg_advisory_xact_lock(4242003)');
      await tx.exec(PG_DDL);
    });
  } else {
    await raw.exec(SQLITE_DDL);
  }
  const chainId = crypto.randomBytes(12).toString('base64url'); // not a UUID: no digit runs
  await raw.run(
    raw.driver === 'postgres'
      ? "INSERT INTO audit_chain_meta (key, value) VALUES ('chain_id', ?) ON CONFLICT DO NOTHING"
      : "INSERT OR IGNORE INTO audit_chain_meta (key, value) VALUES ('chain_id', ?)",
    [chainId],
  );
}

export function hashEntry(key: string, prevHash: string, row: RawRow): string {
  const canonical = JSON.stringify(COLUMNS.map((c) => row[c] ?? null));
  return crypto.createHmac('sha256', key).update(`${prevHash}\n${canonical}`).digest('base64url');
}

/**
 * JSON columns are hashed as their stored text on both drivers (jsonb::text is deterministic), so a
 * row hashes the same way whichever driver reads it back.
 */
const selectRowsFor = (raw: RawDb) =>
  `SELECT ${COLUMNS.map((c) =>
    raw.driver === 'postgres' && c.endsWith('_json') ? `${c}::text AS ${c}` : c,
  ).join(', ')} FROM audit_log`;

/** Default anchor location: next to the database file (none for in-memory databases). */
export function anchorPathFor(dbPath: string): string | null {
  return dbPath === ':memory:' ? null : `${dbPath}.audit-anchor.json`;
}

export function readAnchor(anchorPath: string | null): Anchor | null {
  if (!anchorPath || !fs.existsSync(anchorPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(anchorPath, 'utf8')) as Anchor;
  } catch {
    return null;
  }
}

export class AuditChain {
  private constructor(
    private raw: RawDb,
    private key: string,
    private anchorPath: string | null,
    readonly chainId: string,
  ) {}

  /** Creates the chain tables if needed and loads the chain id. */
  static async open(
    raw: RawDb,
    key: string,
    anchorPath: string | null = null,
  ): Promise<AuditChain> {
    await ensureAuditChain(raw);
    const [meta] = await raw.all<{ value: string }>(
      "SELECT value FROM audit_chain_meta WHERE key = 'chain_id'",
    );
    return new AuditChain(raw, key, anchorPath, meta!.value);
  }

  private get selectRows(): string {
    return selectRowsFor(this.raw);
  }

  /** One seal at a time per process (the chain head is read, then extended). */
  private sealing: Promise<unknown> = Promise.resolve();

  /** Problems with the anchor file (empty when it is absent or consistent with the chain). */
  private async anchorProblems(): Promise<VerifyResult['problems']> {
    const anchor = readAnchor(this.anchorPath);
    if (!anchor) return [];
    if (anchor.chainId !== this.chainId)
      return [
        {
          auditId: null,
          problem: `anchor belongs to a different audit chain (database recreated or chain wiped). If the database was deliberately deleted, delete ${this.anchorPath ?? 'the anchor file'} too`,
        },
      ];
    const [at] = await this.raw.all<{ hash: string }>(
      'SELECT hash FROM audit_chain WHERE audit_id = ?',
      [anchor.lastId],
    );
    if (!at)
      return [
        {
          auditId: anchor.lastId,
          problem: 'chain is shorter than the last recorded anchor (chain truncated or wiped)',
        },
      ];
    if (at.hash !== anchor.head)
      return [{ auditId: anchor.lastId, problem: 'chain does not match the anchor head' }];
    return [];
  }

  private async last(raw: RawDb): Promise<ChainRow | undefined> {
    const [row] = await raw.all<ChainRow>(
      'SELECT audit_id, prev_hash, hash FROM audit_chain ORDER BY audit_id DESC LIMIT 1',
    );
    return row;
  }

  /**
   * Chains every audit row written since the last seal. The anchor is only moved forward when it
   * still matches the chain — a wiped chain can never silently re-anchor itself.
   */
  seal(now = Date.now()): Promise<{ sealed: number; anchorMismatch: boolean }> {
    const next = this.sealing.then(() => this.sealOnce(now));
    this.sealing = next.catch(() => undefined);
    return next;
  }

  private async sealOnce(now: number): Promise<{ sealed: number; anchorMismatch: boolean }> {
    const { count, lastId, prev } = await this.raw.transaction(async (tx) => {
      // Another process (second replica, CLI) may be sealing too: one writer at a time.
      if (tx.driver === 'postgres') await tx.exec('LOCK TABLE audit_chain IN EXCLUSIVE MODE');
      const last = await this.last(tx);
      let prev = last?.hash ?? GENESIS;
      const rows = await tx.all<RawRow>(`${this.selectRows} WHERE id > ? ORDER BY id`, [
        last?.audit_id ?? 0,
      ]);
      for (const row of rows) {
        const hash = hashEntry(this.key, prev, row);
        await tx.run(
          'INSERT INTO audit_chain (audit_id, prev_hash, hash, sealed_at) VALUES (?, ?, ?, ?)',
          [row.id, prev, hash, now],
        );
        prev = hash;
      }
      return { count: rows.length, lastId: Number(rows.at(-1)?.id ?? last?.audit_id ?? 0), prev };
    });
    const anchorMismatch = (await this.anchorProblems()).length > 0;
    if (count && this.anchorPath && !anchorMismatch) {
      const anchor: Anchor = {
        chainId: this.chainId,
        lastId,
        head: prev,
        sealedAt: new Date(now).toISOString(),
      };
      fs.writeFileSync(this.anchorPath, JSON.stringify(anchor, null, 2));
    }
    return { sealed: count, anchorMismatch };
  }

  /** Recomputes the whole chain. Read-only: never seals, so it cannot bless a tampered row. */
  async verify(): Promise<VerifyResult> {
    const problems: VerifyResult['problems'] = [];
    const rows = new Map<number, RawRow>();
    for (const r of await this.raw.all<RawRow>(`${this.selectRows} ORDER BY id`))
      rows.set(Number(r.id), r);
    const chain = await this.raw.all<ChainRow>(
      'SELECT audit_id, prev_hash, hash FROM audit_chain ORDER BY audit_id',
    );

    let prev = GENESIS;
    let verified = 0;
    const sealedIds = new Set<number>();
    for (const c of chain) {
      sealedIds.add(c.audit_id);
      if (c.prev_hash !== prev)
        problems.push({
          auditId: c.audit_id,
          problem: 'chain link broken (entry removed or reordered)',
        });
      const row = rows.get(c.audit_id);
      if (!row) {
        problems.push({ auditId: c.audit_id, problem: 'audit entry deleted' });
      } else if (hashEntry(this.key, c.prev_hash, row) !== c.hash) {
        problems.push({ auditId: c.audit_id, problem: 'audit entry modified' });
      } else {
        verified += 1;
      }
      prev = c.hash;
    }
    const lastSealedId = chain.at(-1)?.audit_id ?? 0;
    let unsealed = 0;
    for (const id of rows.keys()) {
      if (sealedIds.has(id)) continue;
      if (id < lastSealedId)
        problems.push({ auditId: id, problem: 'entry inserted inside the sealed range' });
      else unsealed += 1;
    }

    problems.push(...(await this.anchorProblems()));

    return { ok: problems.length === 0, verified, unsealed, head: prev, lastSealedId, problems };
  }
}
