import crypto from 'node:crypto';
import fs from 'node:fs';
import type Database from 'better-sqlite3';

/**
 * Tamper-evident audit log. audit_log is already append-only (SQLite triggers, migration 0001);
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

export function ensureAuditChain(sqlite: Database.Database): void {
  sqlite.exec(`
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
  `);
  sqlite
    .prepare("INSERT OR IGNORE INTO audit_chain_meta (key, value) VALUES ('chain_id', ?)")
    .run(crypto.randomUUID());
}

export function hashEntry(key: string, prevHash: string, row: RawRow): string {
  const canonical = JSON.stringify(COLUMNS.map((c) => row[c] ?? null));
  return crypto.createHmac('sha256', key).update(`${prevHash}\n${canonical}`).digest('base64url');
}

const selectRows = `SELECT ${COLUMNS.join(', ')} FROM audit_log`;

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
  constructor(
    private sqlite: Database.Database,
    private key: string,
    private anchorPath: string | null = null,
  ) {
    ensureAuditChain(sqlite);
    this.chainId = (
      sqlite.prepare("SELECT value FROM audit_chain_meta WHERE key = 'chain_id'").get() as {
        value: string;
      }
    ).value;
  }

  /** Problems with the anchor file (empty when it is absent or consistent with the chain). */
  private anchorProblems(): VerifyResult['problems'] {
    const anchor = readAnchor(this.anchorPath);
    if (!anchor) return [];
    if (anchor.chainId !== this.chainId)
      return [
        {
          auditId: null,
          problem: `anchor belongs to a different audit chain (database recreated or chain wiped). If the database was deliberately deleted, delete ${this.anchorPath ?? 'the anchor file'} too`,
        },
      ];
    const at = this.sqlite
      .prepare('SELECT hash FROM audit_chain WHERE audit_id = ?')
      .get(anchor.lastId) as { hash: string } | undefined;
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

  readonly chainId: string;

  private last(): ChainRow | undefined {
    return this.sqlite
      .prepare('SELECT audit_id, prev_hash, hash FROM audit_chain ORDER BY audit_id DESC LIMIT 1')
      .get() as ChainRow | undefined;
  }

  /**
   * Chains every audit row written since the last seal. The anchor is only moved forward when it
   * still matches the chain — a wiped chain can never silently re-anchor itself.
   */
  seal(now = Date.now()): { sealed: number; anchorMismatch: boolean } {
    const insert = this.sqlite.prepare(
      'INSERT INTO audit_chain (audit_id, prev_hash, hash, sealed_at) VALUES (?, ?, ?, ?)',
    );
    const run = this.sqlite.transaction(() => {
      const last = this.last();
      let prev = last?.hash ?? GENESIS;
      const rows = this.sqlite
        .prepare(`${selectRows} WHERE id > ? ORDER BY id`)
        .all(last?.audit_id ?? 0) as RawRow[];
      for (const row of rows) {
        const hash = hashEntry(this.key, prev, row);
        insert.run(row.id, prev, hash, now);
        prev = hash;
      }
      return { count: rows.length, lastId: Number(rows.at(-1)?.id ?? last?.audit_id ?? 0), prev };
    });
    const { count, lastId, prev } = run.immediate();
    const anchorMismatch = this.anchorProblems().length > 0;
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
  verify(): VerifyResult {
    const problems: VerifyResult['problems'] = [];
    const rows = new Map<number, RawRow>();
    for (const r of this.sqlite.prepare(`${selectRows} ORDER BY id`).all() as RawRow[])
      rows.set(Number(r.id), r);
    const chain = this.sqlite
      .prepare('SELECT audit_id, prev_hash, hash FROM audit_chain ORDER BY audit_id')
      .all() as ChainRow[];

    let prev = GENESIS;
    let verified = 0;
    const sealedIds = new Set<number>();
    for (const c of chain) {
      sealedIds.add(c.audit_id);
      if (c.prev_hash !== prev)
        problems.push({ auditId: c.audit_id, problem: 'chain link broken (entry removed or reordered)' });
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

    problems.push(...this.anchorProblems());

    return { ok: problems.length === 0, verified, unsealed, head: prev, lastSealedId, problems };
  }
}

/** The better-sqlite3 handle behind a drizzle Db (drizzle sets $client; the app's Db type omits it). */
export const sqliteOf = (db: object): Database.Database =>
  (db as { $client: Database.Database }).$client;
