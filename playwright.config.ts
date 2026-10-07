import { defineConfig, devices } from '@playwright/test';

/**
 * E2E (npm run e2e) and the demo recording (npm run demo:record) share one hermetic server:
 * fixtures mode, no API keys, PIN sign-in required — see e2e/server.ts.
 */
const port = Number(process.env.E2E_PORT ?? 5199);
const recording = process.env.DEMO_RECORD === '1';

export default defineConfig({
  testDir: 'e2e',
  testMatch: recording ? 'record.demo.ts' : '*.spec.ts',
  // One server, one database: the demo path is a story, run it in order.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: recording ? 15 * 60_000 : 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e/.report' }]],
  outputDir: 'e2e/.results',
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: recording ? { mode: 'on', size: { width: 1440, height: 900 } } : 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: 'node_modules/.bin/tsx e2e/server.ts',
    url: `http://localhost:${port}/api/health`,
    timeout: 180_000,
    reuseExistingServer: process.env.E2E_REUSE === '1',
    stdout: 'ignore',
    stderr: 'pipe',
    env: { E2E_PORT: String(port) },
  },
});
