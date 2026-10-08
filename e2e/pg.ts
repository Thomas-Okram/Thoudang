/**
 * `npm run e2e:pg` — the same Playwright suite against PostgreSQL. Starts a throw-away embedded
 * Postgres (no Docker, no manual setup), then runs `playwright test` with DB_DRIVER=postgres; the
 * hermetic server (e2e/server.ts) creates a fresh `thoudang_e2e` database on it.
 *
 * Already have a server? `E2E_DATABASE_URL=postgres://… npm run e2e:pg` skips the embedded one.
 * Extra arguments are passed to Playwright.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.E2E_PG_PORT ?? 54398);

let embedded: EmbeddedPostgres | null = null;
let databaseUrl = process.env.E2E_DATABASE_URL;
if (!databaseUrl) {
  const dir = path.join(root, 'e2e/.pgdata');
  fs.rmSync(dir, { recursive: true, force: true });
  embedded = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
    onLog: () => undefined,
  });
  await embedded.initialise();
  await embedded.start();
  databaseUrl = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
}

let status: number;
try {
  const r = spawnSync(
    path.join(root, 'node_modules/.bin/playwright'),
    ['test', ...process.argv.slice(2)],
    {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        DB_DRIVER: 'postgres',
        DATABASE_URL: databaseUrl,
        DATABASE_SSL: 'disable',
      },
    },
  );
  status = r.status ?? 1;
} finally {
  await embedded?.stop();
}
process.exit(status);
