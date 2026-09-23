import { defineConfig } from 'vitest/config';

/**
 * Integration tests: the built API (dist/main.js) against a real, migrated PostgreSQL. The API
 * connects as the non-owner runtime role, so row-level security applies. Run with
 * `npm run test:integration` (see "Tests" in the top-level README).
 */
export default defineConfig({
  test: {
    include: ['test/integration/**/*.spec.ts'],
    globalSetup: ['test/integration/global-setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
