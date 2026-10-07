/**
 * Hermetic server for the E2E suite and the demo recording — NO API keys, nothing from apps/api/.env.
 *
 *   fresh temp DB + uploads (e2e/.data) → migrate + gazetteer → fixture extractions from
 *   demo-packets/ (truth.json, labelled "Fixture data (no AI)") → synthetic dashboard history →
 *   build the web app → API serves web + API on one port, DEMO_MODE=cache_only, PIN sign-in
 *   required (AUTH_MODE=session, REQUIRE_SIGN_IN=1).
 *
 *   tsx e2e/server.ts            (Playwright's webServer runs this; E2E_PORT, default 5199)
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = path.join(root, 'e2e/.data');
const port = process.env.E2E_PORT ?? '5199';

fs.rmSync(data, { recursive: true, force: true });
fs.mkdirSync(data, { recursive: true });

// Keys are set to '' so dotenv (apps/api/.env) can never fill them in.
const env: NodeJS.ProcessEnv = {
  ...process.env,
  ANTHROPIC_API_KEY: '',
  GEMINI_API_KEY: '',
  AI_PROVIDER: 'anthropic',
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
