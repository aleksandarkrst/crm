import { defineConfig } from 'vitest/config';

/**
 * Performance tests (CD-250): the built API against a real, migrated PostgreSQL with generated data
 * (100,000 time entries, 2,000 tasks, 200 people), kept out of the integration run so pull requests
 * stay fast. Run with `npm run test:performance`; the "Nightly" workflow runs it every night.
 */
// Its own API port, so it can run beside the integration suite (which takes 3101).
process.env.INTEGRATION_API_PORT ??= '3102';

export default defineConfig({
  test: {
    include: ['test/performance/**/*.spec.ts'],
    globalSetup: ['test/integration/global-setup.ts'],
    testTimeout: 60_000,
    /** The data generation in the spec's beforeAll. */
    hookTimeout: 600_000,
  },
});
