import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle as drizzleSqlite, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate as migrateSqlite } from 'drizzle-orm/better-sqlite3/migrator';
import * as sqliteSchema from './schema.sqlite.js';
import { DB_DRIVER, type DbDriver } from './driver.js';
import { env } from '../env.js';

/**
 * The app's database type. Typed against the SQLite schema; on DB_DRIVER=postgres the same
 * object is a node-postgres drizzle instance over the mirrored pg tables (schema.pg.ts).
 *
 * Portable usage only: `await` query builders (never `.all()`, `.get()`, `.run()` — SQLite-only),
 * `.limit(1)` + `[0]` instead of `.get()`, and `transaction(db, async (tx) => …)` from this module
 * instead of `db.transaction`.
 */
export type Db = BetterSQLite3Database<typeof sqliteSchema>;

/** Minimal driver-neutral raw SQL (audit chain, leak scan, tests). `?` placeholders. */
export interface RawDb {
  driver: DbDriver;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  /** Several statements, no parameters. */
  exec(sql: string): Promise<void>;
  /** Runs `fn` atomically (BEGIN IMMEDIATE on SQLite; one pooled connection on Postgres). */
  transaction<T>(fn: (raw: RawDb) => Promise<T>): Promise<T>;
}

export interface DbHandle {
  db: Db;
  driver: DbDriver;
  raw: RawDb;
  /** The better-sqlite3 handle (SQLite only; null on Postgres). */
  sqlite: Database.Database | null;
  /** Human-readable location for logs (file path, or the Postgres database without credentials). */
  location: string;
  close: () => Promise<void>;
}

const handles = new WeakMap<object, DbHandle>();

/** The handle a Db belongs to (raw SQL, driver, liveness). */
export function handleOf(db: Db): DbHandle {
  const h = handles.get(db);
  if (!h) throw new Error('Database handle not registered (open it with openDb)');
  return h;
}
export const rawOf = (db: Db): RawDb => handleOf(db).raw;

/**
 * Runs `fn` in a transaction on either driver. On SQLite the callback must only await database
 * calls (better-sqlite3 is synchronous, so nothing else can interleave); nested calls join the
 * outer transaction.
 */
export async function transaction<T>(db: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  const h = handleOf(db);
  if (h.driver === 'postgres') {
    const pgDb = db as unknown as { transaction: (cb: (tx: unknown) => Promise<T>) => Promise<T> };
    return pgDb.transaction((tx) => fn(tx as Db));
  }
  const sqlite = h.sqlite!;
  if (sqlite.inTransaction) return fn(db);
  sqlite.exec('BEGIN IMMEDIATE');
  try {
    const out = await fn(db);
    sqlite.exec('COMMIT');
    return out;
  } catch (err) {
    if (sqlite.inTransaction) sqlite.exec('ROLLBACK');
    throw err;
  }
}

export interface OpenOptions {
  driver?: DbDriver;
  /** Postgres connection string (default DATABASE_URL). */
  databaseUrl?: string;
}

/**
 * Opens the database and applies all pending migrations.
 *
 * SQLite: `target` is the file path (or ':memory:').
 * Postgres: the default target is DATABASE_URL itself. Any OTHER target (the eval DB, a test's
 * temp file, ':memory:') gets its own database on the same server, named after the path — so
 * "open this path" keeps the same isolation semantics on both drivers.
 */
export async function openDb(
  target: string = env.dbPath,
  opts: OpenOptions = {},
): Promise<DbHandle> {
  const driver = opts.driver ?? DB_DRIVER;
  if (driver === 'postgres') {
    const pg = await import('./pg.js');
    const h = await pg.openPg(target === env.dbPath ? null : target, opts.databaseUrl);
    handles.set(h.db, h);
    return h;
  }
  return openSqlite(target);
}

/** Deletes the database a path maps to (SQLite file + WAL/anchor siblings; Postgres database). */
export async function dropDb(target: string, opts: OpenOptions = {}): Promise<void> {
  const driver = opts.driver ?? DB_DRIVER;
  if (driver === 'postgres') {
    const pg = await import('./pg.js');
    await pg.dropPgDatabaseFor(target, opts.databaseUrl);
    fs.rmSync(`${target}.audit-anchor.json`, { force: true });
    return;
  }
  const dir = path.dirname(target);
  const base = path.basename(target);
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    // eval.db, eval.db-wal, eval.db-shm, eval.db.audit-anchor.json
    if (f === base || f.startsWith(`${base}-`) || f.startsWith(`${base}.`))
      fs.rmSync(path.join(dir, f), { force: true });
  }
}

/** True when the database for `target` already exists (file / Postgres database). */
export async function dbExists(target: string, opts: OpenOptions = {}): Promise<boolean> {
  const driver = opts.driver ?? DB_DRIVER;
  if (driver === 'postgres') {
    const pg = await import('./pg.js');
    return pg.pgDatabaseExists(target, opts.databaseUrl);
  }
  return fs.existsSync(target);
}

function openSqlite(dbPath: string): DbHandle {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzleSqlite(sqlite, { schema: sqliteSchema });
  migrateSqlite(db, { migrationsFolder: path.join(env.migrationsDir, 'sqlite') });
  const raw: RawDb = {
    driver: 'sqlite',
    all: async <T>(q: string, params: unknown[] = []) => sqlite.prepare(q).all(...params) as T[],
    run: async (q, params = []) => ({ changes: sqlite.prepare(q).run(...params).changes }),
    exec: async (q) => void sqlite.exec(q),
    transaction: async (fn) => {
      if (sqlite.inTransaction) return fn(raw);
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const out = await fn(raw);
        sqlite.exec('COMMIT');
        return out;
      } catch (err) {
        if (sqlite.inTransaction) sqlite.exec('ROLLBACK');
        throw err;
      }
    },
  };
  const handle: DbHandle = {
    db,
    driver: 'sqlite',
    raw,
    sqlite,
    location: dbPath,
    close: async () => {
      if (sqlite.open) sqlite.close();
    },
  };
  handles.set(db, handle);
  return handle;
}

/** Whether the handle is still open (shutdown guard for timers). */
export const isOpen = (h: DbHandle): boolean =>
  h.sqlite ? h.sqlite.open : !(h as DbHandle & { closed?: boolean }).closed;
