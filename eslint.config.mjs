import nxPlugin from '@nx/eslint-plugin';
import importXPlugin, { createNodeResolver } from 'eslint-plugin-import-x';

/**
 * Custom node resolver that handles TypeScript ESM extension mapping
 * (e.g., import './foo.js' resolves to './foo.ts').
 */
const tsNodeResolver = createNodeResolver({
  extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.node'],
  extensionAlias: {
    '.js': ['.ts', '.tsx', '.js'],
    '.mjs': ['.mts', '.mjs'],
    '.cjs': ['.cts', '.cjs'],
  },
});

export default [
  // Global ignores — build output, generated files
  {
    ignores: ['**/dist/**'],
  },

  ...nxPlugin.configs['flat/base'],
  ...nxPlugin.configs['flat/typescript'],
  ...nxPlugin.configs['flat/javascript'],

  // Nx module boundary enforcement (cross-project)
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          allow: [],
          depConstraints: [
            {
              sourceTag: '*',
              onlyDependOnLibsWithTags: ['*'],
            },
          ],
        },
      ],
    },
  },

  // Register eslint-plugin-import-x with TypeScript-aware resolver for library files
  {
    files: ['libs/edgar-diff-lib/src/**/*.ts'],
    plugins: {
      'import-x': importXPlugin,
    },
    settings: {
      'import-x/resolver-next': [tsNodeResolver],
    },
  },

  // Register eslint-plugin-import-x with TypeScript-aware resolver for web app files
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: {
      'import-x': importXPlugin,
    },
    settings: {
      'import-x/resolver-next': [tsNodeResolver],
    },
  },

  // Intra-library boundary: client/ cannot import from parser/ or diff/
  {
    files: ['libs/edgar-diff-lib/src/client/**/*.ts'],
    rules: {
      'import-x/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './libs/edgar-diff-lib/src/client',
              from: './libs/edgar-diff-lib/src/parser',
            },
            {
              target: './libs/edgar-diff-lib/src/client',
              from: './libs/edgar-diff-lib/src/diff',
            },
          ],
        },
      ],
    },
  },

  // Intra-library boundary: parser/ cannot import from diff/
  {
    files: ['libs/edgar-diff-lib/src/parser/**/*.ts'],
    rules: {
      'import-x/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './libs/edgar-diff-lib/src/parser',
              from: './libs/edgar-diff-lib/src/diff',
            },
          ],
        },
      ],
    },
  },

  // Intra-library boundary: diff/ cannot import from client/
  {
    files: ['libs/edgar-diff-lib/src/diff/**/*.ts'],
    rules: {
      'import-x/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './libs/edgar-diff-lib/src/diff',
              from: './libs/edgar-diff-lib/src/client',
            },
          ],
        },
      ],
    },
  },
];
