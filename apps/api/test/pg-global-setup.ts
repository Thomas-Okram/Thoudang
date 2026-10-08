import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

/**
 * Vitest globalSetup. Only active with DB_DRIVER=postgres (`npm run test:pg`):
 * TEST_DATABASE_URL if set, else a throwaway embedded PostgreSQL (no Docker, no manual setup).
 * DATABASE_URL is set here, before the workers start, so every worker inherits it; each test's
 * openDb(path) then gets its own database on that server (src/db/pg.ts).
 */

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

export default async function setup(): Promise<(() => Promise<void>) | void> {
  if (process.env.DB_DRIVER !== 'postgres') return;
  if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    return;
  }
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thoudang-pg-'));
  const port = await freePort();
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'postgres',
    password: 'thoudang-test',
    port,
    persistent: false,
    onLog: () => undefined,
    onError: () => undefined,
  });
  await pg.initialise();
  await pg.start();
  process.env.DATABASE_URL = `postgres://postgres:thoudang-test@127.0.0.1:${port}/postgres`;
  process.env.DATABASE_SSL = 'disable';
  return async () => {
    await pg.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  };
}
