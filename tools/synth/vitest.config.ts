import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Image rendering (sharp/librsvg) takes a few seconds per packet.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
