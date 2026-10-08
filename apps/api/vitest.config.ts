import { defineConfig } from 'vitest/config';

const postgres = process.env.DB_DRIVER === 'postgres';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // DB_DRIVER=postgres (npm run test:pg): embedded PostgreSQL (or TEST_DATABASE_URL), see
    // test/pg-global-setup.ts. Default: SQLite.
    globalSetup: ['test/pg-global-setup.ts'],
    // Each test file opens several databases; CREATE DATABASE is slower than a SQLite file.
    ...(postgres ? { testTimeout: 30_000, hookTimeout: 60_000 } : {}),
    // Hermetic: a developer's apps/api/.env (loaded by dotenv, which never overrides set vars) must
    // not change test behaviour. Tests that need sign-in pass it explicitly via testSecurity().
    env: {
      AUTH_MODE: 'session',
      REQUIRE_SIGN_IN: '0',
      DB_DRIVER: postgres ? 'postgres' : 'sqlite',
    },
  },
});
