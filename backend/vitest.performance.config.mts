import { defineConfig } from 'vitest/config';

/**
 * Performance tests (CD-250): the built API against a real, migrated PostgreSQL with generated data
 * (100,000 time entries, 2,000 tasks, 200 people), kept out of the integration run so pull requests
 * stay fast. Run with `npm run test:performance`; the "Nightly" workflow runs it every night.
 */
export default defineConfig({
  test: {
    include: ['test/performance/**/*.spec.ts'],
    globalSetup: ['test/integration/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 600_000,
  },
});
