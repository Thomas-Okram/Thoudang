import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Hermetic: a developer's apps/api/.env (loaded by dotenv, which never overrides set vars) must
    // not change test behaviour. Tests that need sign-in pass it explicitly via testSecurity().
    env: { AUTH_MODE: 'session', REQUIRE_SIGN_IN: '0' },
  },
});
