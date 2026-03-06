import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * Config for live e2e tests that hit real SEC EDGAR APIs.
 *
 * Run with: npx vitest run --config vitest.live.config.ts
 *
 * These tests require network access and should NOT run in CI
 * or during the normal dev/test loop. Run them when:
 *   - Claiming a story is complete
 *   - Verifying integration with EDGAR before a release
 *   - Debugging network-related issues
 */
export default defineConfig({
  root: import.meta.dirname,
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/e2e-live/**/*.{test,spec}.ts'],
    testTimeout: 30_000,
    passWithNoTests: true,
  },
});
