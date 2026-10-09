import { configDefaults, defineConfig } from 'vitest/config';

/** Unit tests: fast and database-free. Integration and performance tests have their own configs (vitest.integration.config.mts, vitest.performance.config.mts). */
export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    exclude: [...configDefaults.exclude, 'test/integration/**', 'test/performance/**'],
  },
});
