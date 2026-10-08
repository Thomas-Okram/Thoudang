/**
 * Hermetic server for the E2E suite and the demo recording — NO API keys, nothing from apps/api/.env.
 *
 *   fresh temp DB + uploads (e2e/.data) → migrate + gazetteer → fixture extractions from
 *   demo-packets/ (truth.json, labelled "Fixture data (no AI)") → synthetic dashboard history →
 *   build the web app → API serves web + API on one port, DEMO_MODE=cache_only, PIN sign-in
 *   required (AUTH_MODE=session, REQUIRE_SIGN_IN=1).
 *
 *   tsx e2e/server.ts            (Playwright's webServer runs this; E2E_PORT, default 5199)
 *
 * DB_DRIVER=postgres (npm run e2e:pg, see e2e/pg.ts): DATABASE_URL points at a server; a fresh
 * `thoudang_e2e` database is dropped + re-created on it, so the run is just as hermetic.
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = path.join(root, 'e2e/.data');
const port = process.env.E2E_PORT ?? '5199';

fs.rmSync(data, { recursive: true, force: true });
fs.mkdirSync(data, { recursive: true });

const postgres = process.env.DB_DRIVER === 'postgres';

/** Drops + re-creates `thoudang_e2e` on the DATABASE_URL server; returns its URL. */
async function freshPgDatabase(): Promise<string> {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DB_DRIVER=postgres needs DATABASE_URL (npm run e2e:pg sets it)');
  const admin = new pg.Client({ connectionString: raw });
  await admin.connect();
  try {
    await admin.query('DROP DATABASE IF EXISTS thoudang_e2e WITH (FORCE)');
    await admin.query('CREATE DATABASE thoudang_e2e');
  } finally {
    await admin.end();
  }
  // Same name as e2ePgUrl() in helpers.ts (not imported: that file loads @playwright/test).
  const url = new URL(raw);
  url.pathname = '/thoudang_e2e';
  return url.toString();
}
const databaseUrl = postgres ? await freshPgDatabase() : '';

// Keys are set to '' so dotenv (apps/api/.env) can never fill them in.
const env: NodeJS.ProcessEnv = {
  ...process.env,
  ANTHROPIC_API_KEY: '',
  GEMINI_API_KEY: '',
  AI_PROVIDER: 'anthropic',
  // Explicit, so a developer's apps/api/.env (DB_DRIVER / DATABASE_URL) can never leak in.
  DB_DRIVER: postgres ? 'postgres' : 'sqlite',
  DATABASE_URL: databaseUrl,
  DB_PATH: path.join(data, 'e2e.db'),
  UPLOADS_DIR: path.join(data, 'uploads'),
  LOG_FILE: path.join(data, 'api.log'),
  AUDIO_DIR: path.join(data, 'audio'),
  EVAL_REPORT: path.join(data, 'eval-report.json'),
  TEMPLATES_PATH: path.join(data, 'templates.json'),
  DEMO_MODE: 'cache_only',
  PORT: port,
  WEB_PORT: port,
  SERVE_WEB: '1',
  AUTH_MODE: 'session',
  REQUIRE_SIGN_IN: '1',
  OFFICER_PINS: 'dswo-imphal-west:2468,da-imphal-west:1357',
  SESSION_SECRET: 'e2e-session-secret-not-for-production',
  AUDIT_CHAIN_KEY: 'e2e-audit-chain-key',
  STATUS_LINK_SECRET: 'e2e-status-secret',
  RETENTION_DAYS: '0',
  // Playwright drives everything from one IP; the default login limit is per 5 min.
  RATE_LIMIT_LOGIN_PER_5MIN: '200',
  PUBLIC_BASE_URL: '',
};
fs.copyFileSync(path.join(root, 'packages/core/notices/templates.json'), env.TEMPLATES_PATH!);

const tsx = path.join(root, 'node_modules/.bin/tsx');
const api = (script: string, ...args: string[]) =>
  execFileSync(tsx, [path.join(root, 'apps/api/src', script), ...args], {
    cwd: path.join(root, 'apps/api'),
    env,
    stdio: 'inherit',
  });

api('seed.ts');
api('demo/fixtures.ts', '--dir', path.join(root, 'demo-packets'));
api('demo/seed-dashboard.ts');
if (process.env.E2E_SKIP_BUILD !== '1') {
  execFileSync('npm', ['run', 'build', '-w', '@thoudang/web'], {
    cwd: root,
    env,
    stdio: 'inherit',
  });
}

const server = spawn(tsx, [path.join(root, 'apps/api/src/server.ts')], {
  cwd: path.join(root, 'apps/api'),
  env,
  stdio: 'inherit',
});
const stop = () => server.kill('SIGTERM');
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', (code) => process.exit(code ?? 0));
