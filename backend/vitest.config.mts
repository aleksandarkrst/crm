import { configDefaults, defineConfig } from 'vitest/config';

/** Unit tests: fast and database-free. Integration tests have their own config (vitest.integration.config.mts). */
export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    exclude: [...configDefaults.exclude, 'test/integration/**'],
  },
});
