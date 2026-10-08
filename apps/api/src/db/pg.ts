import crypto from 'node:crypto';
import path from 'node:path';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as pgSchema from './schema.pg.js';
import type { Db, DbHandle, RawDb } from './client.js';
import { env } from '../env.js';

/**
 * PostgreSQL driver (DB_DRIVER=postgres, e.g. the Railway Postgres plugin via DATABASE_URL).
 * Small pool (PG_POOL_MAX, default 5), SSL as the host requires (see sslFor), int8 → Number so
 * epoch-millisecond columns and counts are plain numbers exactly as on SQLite.
 */

const INT8_OID = 20;
const types = {
  getTypeParser: ((oid: number, format?: string) =>
    oid === INT8_OID && format !== 'binary'
      ? (v: string) => Number(v)
      : pg.types.getTypeParser(oid, format as 'text')) as typeof pg.types.getTypeParser,
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '']);

/**
 * DATABASE_SSL=disable | require (encrypted, certificate not verified — Railway's public proxy
 * uses a self-signed certificate) | verify. Default: off for localhost, unix sockets and Railway's
 * private network (*.railway.internal), `require` for everything else.
 */
export function sslFor(url: URL, mode = process.env.DATABASE_SSL): pg.PoolConfig['ssl'] {
  const m = (mode ?? 'auto').toLowerCase();
  if (m === 'disable' || m === 'off' || m === 'false') return false;
  if (m === 'verify') return { rejectUnauthorized: true };
  if (m === 'require' || m === 'on' || m === 'true') return { rejectUnauthorized: false };
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (LOCAL_HOSTS.has(host) || host.startsWith('/') || host.endsWith('.railway.internal'))
    return false;
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode === 'disable') return false;
  return { rejectUnauthorized: sslmode === 'verify-full' };
}

function baseUrl(databaseUrl?: string): URL {
  const raw = databaseUrl ?? process.env.DATABASE_URL;
  if (!raw)
    throw new Error('DB_DRIVER=postgres needs DATABASE_URL (e.g. postgres://user:pw@host:5432/db)');
  return new URL(raw);
}

/** Pool config without sslmode in the URL (pg would let it override our ssl object). */
function poolConfig(url: URL, max: number): pg.PoolConfig {
  const u = new URL(url);
  const ssl = sslFor(u);
  u.searchParams.delete('sslmode');
  return {
    connectionString: u.toString(),
    ssl,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    types,
  };
}

const poolMax = () => Math.max(1, Number(process.env.PG_POOL_MAX ?? 5) || 5);

/** Database name for a non-default target (eval DB, test temp file, ':memory:'). */
export function databaseNameFor(target: string): string {
  if (target === ':memory:') return `thoudang_mem_${crypto.randomBytes(6).toString('hex')}`;
  const slug = path
    .basename(target)
    .replace(/\.[a-z0-9]+$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .slice(0, 20);
  const hash = crypto.createHash('sha1').update(path.resolve(target)).digest('hex').slice(0, 10);
  return `thoudang_${slug}_${hash}`;
}

const withDb = (url: URL, database: string) => {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u;
};

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** Short-lived admin connection to the DATABASE_URL database (CREATE / DROP DATABASE). */
async function withAdmin<T>(url: URL, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const cfg = poolConfig(url, 1);
  const client = new pg.Client({ connectionString: cfg.connectionString, ssl: cfg.ssl, types });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

// CREATE DATABASE copies template1 and fails if another session is copying it at the same time.
const CREATE_LOCK = 4_242_001;

async function ensureDatabase(url: URL, name: string): Promise<void> {
  await withAdmin(url, async (c) => {
    await c.query('SELECT pg_advisory_lock($1)', [CREATE_LOCK]);
    try {
      const { rowCount } = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
      if (!rowCount) await c.query(`CREATE DATABASE ${quoteIdent(name)}`);
    } finally {
      await c.query('SELECT pg_advisory_unlock($1)', [CREATE_LOCK]);
    }
  });
}

export async function pgDatabaseExists(target: string, databaseUrl?: string): Promise<boolean> {
  const url = baseUrl(databaseUrl);
  if (target === env.dbPath) return true;
  const name = databaseNameFor(target);
  return withAdmin(url, async (c) => {
    const { rowCount } = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    return Boolean(rowCount);
  });
}

export async function dropPgDatabaseFor(target: string, databaseUrl?: string): Promise<void> {
  if (target === env.dbPath) throw new Error('Refusing to drop the main database');
  const url = baseUrl(databaseUrl);
  await withAdmin(url, (c) =>
    c.query(`DROP DATABASE IF EXISTS ${quoteIdent(databaseNameFor(target))} WITH (FORCE)`),
  );
}

/** `?` → `$1, $2, …` (raw SQL in this codebase never has `?` inside string literals). */
export const toPgParams = (q: string) => {
  let i = 0;
  return q.replace(/\?/g, () => `$${++i}`);
};

type Queryable = Pick<pg.Pool, 'query'>;

function rawFor(pool: pg.Pool, conn: Queryable = pool): RawDb {
  const raw: RawDb = {
    driver: 'postgres',
    all: async <T>(q: string, params: unknown[] = []) =>
      (await conn.query(toPgParams(q), params)).rows as T[],
    run: async (q, params = []) => ({
      changes: (await conn.query(toPgParams(q), params)).rowCount ?? 0,
    }),
    exec: async (q) => void (await conn.query(q)),
    transaction: async (fn) => {
      if (conn !== pool) return fn(raw); // already inside one
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(rawFor(pool, client));
        await client.query('COMMIT');
        return out;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  };
  return raw;
}

// Serialises migrations when several processes (replicas, test workers) boot at once.
const MIGRATE_LOCK = 4_242_002;

/** target null → the DATABASE_URL database itself; otherwise an isolated database for the path. */
export async function openPg(target: string | null, databaseUrl?: string): Promise<DbHandle> {
  let url = baseUrl(databaseUrl);
  const ephemeral = target === ':memory:';
  let dbName: string | null = null;
  if (target !== null) {
    dbName = databaseNameFor(target);
    await ensureDatabase(url, dbName);
    url = withDb(url, dbName);
  }
  const pool = new pg.Pool(poolConfig(url, poolMax()));
  pool.on('error', () => undefined); // an idle client dropped by the server; the next query reconnects
  const db = drizzle(pool, { schema: pgSchema });
  const lock = await pool.connect();
  try {
    await lock.query('SELECT pg_advisory_lock($1)', [MIGRATE_LOCK]);
    await migrate(db, { migrationsFolder: path.join(env.migrationsDir, 'pg') });
  } catch (err) {
    await pool.end().catch(() => undefined);
    throw err;
  } finally {
    await lock.query('SELECT pg_advisory_unlock($1)', [MIGRATE_LOCK]).catch(() => undefined);
    lock.release();
  }

  const safe = new URL(url);
  safe.password = '';
  safe.username = '';
  const handle: DbHandle & { closed: boolean } = {
    db: db as unknown as Db,
    driver: 'postgres',
    raw: rawFor(pool),
    sqlite: null,
    location: `postgres ${safe.host}${safe.pathname}`,
    closed: false,
    close: async () => {
      if (handle.closed) return;
      handle.closed = true;
      await pool.end();
      if (ephemeral && dbName) {
        const name = dbName;
        await withAdmin(baseUrl(databaseUrl), (c) =>
          c.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`),
        ).catch(() => undefined);
      }
    },
  };
  return handle;
}
