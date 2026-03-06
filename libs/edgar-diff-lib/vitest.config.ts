import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.{test,spec}.ts'],
    exclude: ['tests/e2e-live/**'],
    passWithNoTests: true,
    coverage: {
      reportsDirectory: '../../coverage/libs/edgar-diff-lib',
      provider: 'v8',
    },
  },
});
